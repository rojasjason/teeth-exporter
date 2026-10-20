/*
 * controller.js — everything the tool DOES, shared by both builds.
 *
 * The extension (content.js, ISOLATED world) and the userscript (userscript_orchestrator.js, one
 * page context) both create one controller, so a button behaves identically in either. It:
 *   - collects the token handshake, the WCC bundle, viewer stage pushes and WebGL snapshots from
 *     capture.js / webgl_capture.js / viewer_bridge.js (same-window postMessage, token-checked),
 *   - tracks the current aligner (viewer state first, DOM label probe as fallback),
 *   - runs the commands the panel offers: fullMouth, allStages, raw, diag, glCapture.
 * Everything stays in the tab; downloads are local blob links.
 *
 * Exposes globalThis.TeethController(hooks) -> { state, status(), run(name, args) -> Promise<result> }
 *   hooks.onCapture(state)      the scan arrived
 *   hooks.onStep(info)          current aligner changed: {aligner, total}
 *   hooks.onProgress(p)         every-aligner export progress: {aligner, total}
 *   hooks.onRunStart(name)      a command started
 *   hooks.onRunEnd(name, r)     a command finished with result r
 * cancel() stops an every-aligner export after the aligner in progress (the viewer is put back).
 */
(function (root) {
  "use strict";

  var TAG = "CLINCHECK_WCC_CAPTURE";
  var MAX_BYTES = 96 * 1024 * 1024;    // reject any single payload bigger than this
  var MAX_TOTAL = 160 * 1024 * 1024;   // total retained mesh bytes across the session
  var MAX_FILES = 64;                  // max distinct mesh payloads kept for diagnostics

  function TeethController(hooks) {
    hooks = hooks || {};
    var engine = root.ClinCheckEngine;
    var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
    function emit(name, arg) { try { if (hooks[name]) hooks[name](arg); } catch (e) {} }

    var state = {
      bytes: null, url: "", size: 0, capturedAt: 0,      // the WCC bundle
      resources: [], payloads: {}, seen: {}, keptBytes: 0, // diagnostics: every recorded response
      tokens: {},                                         // tokens announced by our MAIN-world scripts
      glReqId: 0, glPending: null,                        // WebGL snapshot round trip
      maxStage: null, currentStep: null, stepTotal: null, stepSource: null,
      busy: null, progress: null, cancelled: false        // command in flight + every-aligner progress
    };

    // ---- current aligner: the viewer's own state wins; the DOM label probe is the fallback ----
    var probe = null;
    function ensureProbe() {
      if (probe || !root.TeethStageProbe) return;
      probe = root.TeethStageProbe({
        getMaxStage: function () { return state.maxStage; },
        onChange: function (info) {
          if (state.stepSource === "viewer") return;
          state.currentStep = info.stage; state.stepTotal = info.total; state.stepSource = info.source;
          emit("onStep", { aligner: info.stage + 1, total: info.total });
        }
      });
      probe.start();
    }
    // which stage to export: the Advanced override (typed as the viewer's aligner number) wins
    function resolveStage(override) {
      if (override != null && override !== "") {
        var s = Math.max(0, (override | 0) - 1);
        return state.maxStage != null ? Math.min(state.maxStage, s) : s;
      }
      return state.currentStep != null ? state.currentStep : 0;
    }

    // ---- diagnostics helpers ----
    var MAGIC = {                                         // re-verify the claimed format from the bytes
      zip: function (u) { return u[0] === 0x50 && u[1] === 0x4b; },
      ctm: function (u) { return u[0] === 0x4f && u[1] === 0x43 && u[2] === 0x54 && u[3] === 0x4d; },
      glb: function (u) { return u[0] === 0x67 && u[1] === 0x6c && u[2] === 0x54 && u[3] === 0x46; },
      draco: function (u) { return u[0] === 0x44 && u[1] === 0x52 && u[2] === 0x41 && u[3] === 0x43; },
      ply: function (u) { return u[0] === 0x70 && u[1] === 0x6c && u[2] === 0x79; },
      stl: function (u) { return u[0] === 0x73 && u[1] === 0x6f && u[2] === 0x6c; }
    };
    // diagnostics get emailed around: origin + path only (no query string with signed tokens),
    // ID-like path segments (case / patient IDs) replaced, truncated
    function redactId(seg) { return /\d{5,}|[0-9a-f]{16,}|[0-9a-f-]{32,}/i.test(seg) ? ":id" : seg; }
    function safeUrl(url) {
      var s;
      try { var u = new URL(url, location.href); s = u.origin + u.pathname.split("/").map(redactId).join("/"); }
      catch (e) { s = String(url || "").split(/[?#]/)[0].split("/").map(redactId).join("/"); }
      return s.slice(0, 120);
    }
    function basename(url) {
      var b;
      try { var u = new URL(url, location.href); b = u.pathname.split("/").pop() || "resource"; }
      catch (e) { b = String(url).split(/[?#]/)[0].split("/").pop() || "resource"; }
      b = redactId(b); return (b === ":id" ? "resource" : b).slice(0, 60);
    }
    function uniqueName(name) {
      var n = name || "resource", i = 1;
      while (state.payloads[n]) { n = name.replace(/(\.[^.]*)?$/, "_" + (i++) + "$1"); }
      return n;
    }

    // ---- messages from our MAIN-world scripts ----
    root.addEventListener("message", function (ev) {
      if (ev.source !== root) return;
      if (ev.origin !== location.origin && ev.origin !== "null") return;
      var d = ev.data;
      if (!d || d.source !== TAG) return;
      if (d.kind === "hello") { if (typeof d.token === "string") state.tokens[d.token] = true; return; }
      if (!d.token || !state.tokens[d.token]) return;            // reject forged / pre-token messages

      if (d.kind === "gl-snapshot") {
        var p = state.glPending;
        if (!p || d.reqId !== p.id) return;                      // a late reply to an older request
        state.glPending = null;
        p.resolve({ meshes: Array.isArray(d.meshes) ? d.meshes : [], summary: d.summary || { error: d.error || null } });
        return;
      }
      if (d.kind === "viewer-stage" && d.info) {
        state.currentStep = d.info.currentStage; state.stepTotal = d.info.lastStage; state.stepSource = "viewer";
        if (state.busy !== "allStages") emit("onStep", { aligner: d.info.currentStage - d.info.firstStage + 1, total: d.info.lastStage });
        return;
      }
      if (d.kind === "wcc" && d.bytes) {
        if (d.bytes.byteLength > MAX_BYTES) return;
        var wb = new Uint8Array(d.bytes);
        if (!MAGIC.zip(wb)) return;                              // must really be a ZIP
        state.bytes = wb; state.url = d.url || ""; state.size = wb.length; state.capturedAt = Date.now();
        try { state.maxStage = engine.stageRange(wb).max; } catch (e) {}
        ensureProbe();
        emit("onCapture", state);
        return;
      }
      if (d.kind === "resource") {
        var key = (d.url || "") + "|" + d.size;
        if (state.seen[key]) return;
        state.seen[key] = true;
        var rec = { url: d.url || "", ct: d.ct || "", size: d.size || 0, fmt: d.fmt || null, file: null };
        if (d.bytes && d.fmt && d.bytes.byteLength <= MAX_BYTES &&
            Object.keys(state.payloads).length < MAX_FILES && state.keptBytes + d.bytes.byteLength <= MAX_TOTAL) {
          var u8 = new Uint8Array(d.bytes);
          if (MAGIC[d.fmt] && MAGIC[d.fmt](u8)) {
            var ext = { zip: ".zip", ctm: ".ctm", glb: ".glb", draco: ".drc", ply: ".ply", stl: ".stl" }[d.fmt] || "";
            var name = basename(d.url); if (ext && !name.toLowerCase().endsWith(ext)) name += ext;
            name = uniqueName(name);
            state.payloads[name] = u8; state.keptBytes += u8.length; rec.file = name;
          }
        }
        state.resources.push(rec);
      }
    });

    // ---- helpers ----
    function download(bytes, filename) {
      var blob = new Blob(Array.isArray(bytes) ? bytes : [bytes], { type: "application/zip" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename; a.style.display = "none";
      (document.body || document.documentElement).appendChild(a); a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 60000);   // big zips need time to hand off
    }
    function ts() {
      var d = new Date(); function p(n) { return String(n).padStart(2, "0"); }
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    }
    function text(s) { return new TextEncoder().encode(s); }
    // a fresh WebGL rip; each request gets a new id so a slow reply can't hand over an old stage's meshes
    function snapshot(latestFrame) {
      return new Promise(function (resolve) {
        var id = ++state.glReqId;
        state.glPending = { id: id, resolve: resolve };
        try { root.postMessage({ source: TAG, kind: "gl-snapshot-request", reqId: id, latestFrame: !!latestFrame }, ORIGIN); } catch (e) {}
        setTimeout(function () {
          if (state.glPending && state.glPending.id === id) { state.glPending = null; resolve({ meshes: null, summary: null, timedOut: true }); }
        }, 6000);
      });
    }
    // ---- commands ----
    var commands = {
      // the aligner on screen: exact teeth + the real gums ripped from WebGL
      fullMouth: function (args) {
        var stage = resolveStage(args && args.override);
        return snapshot().then(function (snap) {
          var res = engine.exportFromBundle(state.bytes, { stage: stage, glb: true, glMeshes: snap.meshes || [] });
          var gums = (res.gumInfo && res.gumInfo.gums) || [];
          var arches = gums.map(function (g) { return g.arch; });
          var lines = [
            "Teeth Exporter (unofficial)",
            "Aligner Number " + (stage + 1) + "  |  units: millimeters, true scale", "",
            gums.length
              ? "Real gums included: " + arches.join(" + ") + "   (fit: " + gums.map(function (g) { return g.arch + " " + g.cost + "mm"; }).join(", ") + ")"
              : (snap.timedOut
                  ? "NO GUMS THIS PASS: the 3D capture did not answer in time. Export again."
                  : "NO GUMS THIS PASS: orbit the model so both pink gums are drawn, then export again."),
            (snap.summary && snap.summary.budgetExceeded)
              ? "NOTE: the capture memory limit was hit, so the gum may be from an earlier aligner. Reload the page, go to the aligner you want, then export."
              : "",
            "",
            "Top level (the everyday files):",
            "  full_mouth_with_gums.stl   both arches: teeth + real gums",
            "  upper_with_gums.stl        upper: teeth + gum",
            "  lower_with_gums.stl        lower: teeth + gum",
            "  full_mouth.glb             colored, separate meshes, opens in any 3D viewer",
            "  (an arch whose gum wasn't captured shows its teeth-only file here instead)",
            "",
            "Advanced/ (everything else):",
            "  full_mouth_teeth.stl / upper_teeth.stl / lower_teeth.stl   teeth only",
            "  full_mouth_gums.stl / gum_U.stl / gum_L.stl                 gums only",
            "",
            "  manifest.json                                              per-tooth arch / UNS number / width (mm)",
            "  README.txt                                                 this file", "",
            "Teeth are an exact extraction. Gums are the viewer's own generated surface, ripped from WebGL."
          ];
          // same layout as each folder of the every-aligner export: everyday files on top, rest in Advanced/
          download(engine.zipOutputs(engine.layoutStage(res.outputs, ""), { "Advanced/manifest.json": text(JSON.stringify(res.manifest, null, 2)), "Advanced/README.txt": text(lines.join("\n")) }),
            "teeth_exporter_full_mouth_" + ts() + ".zip");
          return { ok: true, aligner: stage + 1, teeth: res.stats.teeth, arches: arches, timedOut: !!snap.timedOut };
        });
      },
      // every aligner with its real gums, one folder each (all_stages.js steps the viewer)
      allStages: function () {
        state.progress = { aligner: null, total: null };
        return root.TeethAllStages({
          tag: TAG, origin: ORIGIN, tokens: state.tokens, engine: engine, fflate: root.fflate, bytes: state.bytes,
          onProgress: function (p) { state.progress = { aligner: p.aligner, total: p.total }; emit("onProgress", state.progress); },
          isCancelled: function () { return state.cancelled; }
        }).then(function (res) {
          download(res.chunks, "teeth_exporter_all_aligners_" + ts() + ".zip");
          return { ok: true, count: res.stageCount, missing: res.missing, bytes: res.bytes };
        });
      },
      // the untouched scan file the viewer loaded (backup, offline tools, bug reports)
      raw: function () {
        download(state.bytes, "teeth_exporter_raw_scan_" + ts() + ".zip");
        return Promise.resolve({ ok: true, bytes: state.size });
      },
      // every mesh/archive the viewer downloaded + a redacted index of all responses
      diag: function () {
        var entries = {};
        for (var name in state.payloads) entries[name] = state.payloads[name];
        entries["index.json"] = text(JSON.stringify({
          capturedAt: new Date().toISOString(),
          wccBundle: state.bytes ? { size: state.size, url: safeUrl(state.url) } : null,
          meshFilesKept: Object.keys(state.payloads),
          allResponses: state.resources.map(function (r) { return { url: safeUrl(r.url), ct: r.ct, size: r.size, fmt: r.fmt, file: r.file }; })
        }, null, 2));
        download(engine.zipOutputs({}, entries), "teeth_exporter_diagnostics_" + ts() + ".zip");
        return Promise.resolve({ ok: true, files: Object.keys(state.payloads).length, responses: state.resources.length });
      },
      // what's on screen right now as a clean GLB: the latest frame's 3D meshes in the viewer's own
      // frame, unregistered (troubleshooting). Teeth white, gums pink.
      glCapture: function () {
        return snapshot(true).then(function (snap) {
          var all = snap.meshes || [];
          if (!all.length) return { ok: false, error: "No rendered 3D captured yet. Rotate the model once, then try again." };
          // the viewer draws some helper geometry whose bytes decode to Infinity/NaN; a GLB can't hold
          // those (Blender rejects the whole file), so leave them out and list them in the manifest
          // ...and leave out the viewer's helper draws: full-screen passes and UI quads (a handful of
          // vertices, often in pixel or -1..1 screen units) that would dwarf a 7 cm jaw
          var meshes = [], skipped = [], helpers = 0;
          all.forEach(function (m) {
            var ok = m.positions && m.positions.length && engine.allFinite(m.positions) && m.indices && m.indices.length % 3 === 0;
            if (ok) for (var k = 0, nv = m.positions.length / 3; k < m.indices.length; k++) if (m.indices[k] >= nv) { ok = false; break; }
            if (!ok) { skipped.push(m); return; }
            var p = m.positions, big = 0;
            for (var q = 0; q < p.length; q++) { var a = Math.abs(p[q]); if (a > big) big = a; }
            if (p.length / 3 <= 8 || big > 0.5) { helpers++; return; }       // model is meters, a jaw is < 0.1 m
            meshes.push(m);
          });
          if (!meshes.length) return { ok: false, error: "The captured 3D had no usable meshes. Rotate the model once, then try again." };
          var WHITE = [0.925, 0.914, 0.878, 1], PINK = [0.86, 0.42, 0.44, 1];
          var objs = meshes.map(function (m, i) {
            var gumLike = m.positions.length / 3 >= 3000;                     // gums are the big shells
            return { name: m.name || ("draw" + i), verts: m.positions, faces: m.indices, color: gumLike ? PINK : WHITE };
          });
          var manifest = { summary: snap.summary, drawCount: meshes.length, draws: meshes.map(function (m) { return m.meta; }),
            skipped: skipped.map(function (m) { return { name: m.name, meta: m.meta, reason: "invalid vertex or index data" }; }),
            helperDrawsLeftOut: helpers };
          download(engine.zipOutputs({ "rendered_meshes.glb": engine.buildGLB(objs) }, { "manifest.json": text(JSON.stringify(manifest, null, 2)) }),
            "teeth_exporter_rendered_3d_" + ts() + ".zip");
          return { ok: true, count: meshes.length, skipped: skipped.length };
        });
      }
    };

    function status() {
      return {
        captured: !!state.bytes, size: state.size,
        aligner: state.currentStep != null ? state.currentStep + 1 : null, total: state.stepTotal,
        busy: state.busy, progress: state.busy === "allStages" ? state.progress : null,
        files: Object.keys(state.payloads).length
      };
    }
    function run(name, args) {
      var cmd = commands[name];
      if (!cmd) return Promise.resolve({ ok: false, error: "unknown command" });
      if (!state.bytes) return Promise.resolve({ ok: false, error: "No scan yet. Open your 3D treatment plan and let it load." });
      if (state.busy) return Promise.resolve({ ok: false, error: "Still working on the last export." });
      state.busy = name; state.cancelled = false;
      emit("onRunStart", name);
      var p;
      try { p = cmd(args); } catch (e) { p = Promise.reject(e); }
      return p.then(function (r) { return r; }, function (e) { return { ok: false, error: String(e && e.message || e) }; })
        .then(function (r) { state.busy = null; state.progress = null; emit("onRunEnd", { name: name, result: r }); return r; });
    }
    function cancel() { if (state.busy === "allStages") state.cancelled = true; }

    return { state: state, status: status, run: run, cancel: cancel };
  }

  root.TeethController = TeethController;
})(typeof globalThis !== "undefined" ? globalThis : this);
