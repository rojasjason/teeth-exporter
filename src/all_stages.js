/*
 * all_stages.js — export EVERY aligner stage with its REAL gums, one folder per stage.
 *
 * The viewer generates a different gum for each step and only draws the step on screen, so each
 * step's gum has to be ripped while that step is shown. This drives the viewer through its own
 * stage range (viewer_bridge.js: firstStage..lastStage, however long the plan is):
 *   mark the ripper (gl-mark) -> set the stage -> wait until drawing settles (gl-stats)
 *   -> snapshot only what was drawn since the mark -> register gums on that stage's teeth
 *   -> lay the files out (engine.layoutStage) -> stream them into the zip -> next stage.
 * The zip is built with fflate's streaming Zip, so each stage is compressed and dropped as it goes
 * (a long plan never holds every stage's raw STLs at once). The viewer is put back on the stage
 * the user was on.
 *
 * Shared by content.js (extension, ISOLATED world) and userscript_orchestrator.js (one context).
 * Exposes globalThis.TeethAllStages(opts) -> Promise<{ chunks, stageCount, firstStage, lastStage,
 *   steps:[{stage, arches}], missing:[stage], restored }>
 *   opts: { tag, origin, tokens, engine, fflate, bytes, onProgress({done,total,stage}) }
 */
(function (root) {
  "use strict";

  var MAX_ZIP = 2 * 1024 * 1024 * 1024;    // refuse to build more than 2 GB of compressed output

  function TeethAllStages(opts) {
    var TAG = opts.tag, ORIGIN = opts.origin, tokens = opts.tokens, engine = opts.engine, ff = opts.fflate;
    var onProgress = opts.onProgress || function () {};
    var isCancelled = opts.isCancelled || function () { return false; };
    var seq = 0;

    function sleep(ms) { return new Promise(function (r) { root.setTimeout(r, ms); }); }

    // one request/reply round trip over postMessage, matched by reqId and an announced token
    function request(msg, replyKind, timeoutMs) {
      return new Promise(function (resolve) {
        var id = "all-" + Date.now().toString(36) + "-" + (++seq), done = false;
        function finish(v) { if (done) return; done = true; root.removeEventListener("message", onMsg); resolve(v); }
        function onMsg(ev) {
          if (ev.source !== root) return;
          var d = ev.data;
          if (!d || d.source !== TAG || d.kind !== replyKind || d.reqId !== id) return;
          if (!d.token || !tokens[d.token]) return;
          finish(d);
        }
        root.addEventListener("message", onMsg);
        msg.source = TAG; msg.reqId = id;
        try { root.postMessage(msg, ORIGIN); } catch (e) {}
        root.setTimeout(function () { finish(null); }, timeoutMs);
      });
    }
    function viewer(op, stage) { return request({ kind: "viewer-request", op: op, stage: stage }, "viewer-reply", 6000); }

    // wait until the set of draws seen since `epoch` stops growing (the new gum is drawn a frame
    // or two after the stage change). Returns the count seen.
    async function settle(epoch) {
      var t0 = Date.now(), lastN = -1, same = 0, n = 0;
      await sleep(350);
      while (Date.now() - t0 < 7000) {
        var st = await request({ kind: "gl-stats-request", sinceEpoch: epoch }, "gl-stats", 1500);
        n = st ? st.recent : 0;
        if (n > 0 && n === lastN) { if (++same >= 2 && Date.now() - t0 >= 800) return n; }
        else same = 0;
        lastN = n;
        await sleep(250);
      }
      return n;
    }

    async function ripStage(s) {
      var mk = await request({ kind: "gl-mark" }, "gl-mark-ack", 2000);
      if (!mk) throw new Error("the 3D capture is not responding; reload the viewer page");
      var r = await viewer("setStage", s);
      if (!r || !r.ok) throw new Error("could not move the viewer to stage " + s + (r && r.error ? ": " + r.error : ""));
      var n = await settle(mk.epoch);
      if (!n) return [];
      var snap = await request({ kind: "gl-snapshot-request", sinceEpoch: mk.epoch }, "gl-snapshot", 15000);
      return (snap && snap.meshes) || [];
    }

    return (async function () {
      var info = await viewer("info");
      if (!info || !info.ok || !info.info) throw new Error("can't reach the viewer's step controls on this page");
      // Match the viewer's "Aligner Number N / T" slider one to one. Verified live 2026-10-19:
      // aligner N = stage firstStage + N - 1, T = lastStage, and the slider stops at stage lastStage - 1
      // (the final stage in the data is never shown). So export aligners 1..T, named by aligner number.
      var first = info.info.firstStage, last = info.info.lastStage, original = info.info.currentStage;
      var total = Math.max(1, last - first);                 // aligner count = the slider's "/ T"
      var lastShown = first + total - 1;

      var chunks = [], zipBytes = 0, zipErr = null;
      var zip = new ff.Zip(function (err, data) {
        if (err) { zipErr = err; return; }
        chunks.push(data); zipBytes += data.byteLength;
      });
      function addFile(path, bytes) {
        if (zipErr) throw zipErr;
        var f = new ff.ZipDeflate(path, { level: 6 });
        zip.add(f); f.push(bytes, true);
        if (zipBytes > MAX_ZIP) throw new Error("export too large");
      }

      var steps = [], missing = [], manifest = null, restored = false;
      try {
        // the viewer only redraws on a change: if it already shows the first stage, step away first
        if (original === first && lastShown > first) await viewer("setStage", first + 1);
        for (var s = first; s <= lastShown; s++) {
          var aligner = s - first + 1;
          if (isCancelled()) throw new Error("Export cancelled.");
          onProgress({ done: aligner - 1, total: total, stage: s, aligner: aligner });
          var meshes = await ripStage(s);
          var res = engine.exportFromBundle(opts.bytes, { stage: s, glb: true, glMeshes: meshes });
          var arches = ((res.gumInfo && res.gumInfo.gums) || []).map(function (g) { return g.arch; });
          if (arches.length < 2) missing.push(aligner);
          steps.push({ aligner: aligner, stage: s, arches: arches });
          if (!manifest) manifest = res.manifest;
          var laid = engine.layoutStage(res.outputs, engine.stageDirName(aligner, total));
          for (var path in laid) addFile(path, laid[path]);
          res = null; laid = null; meshes = null;     // let this stage's raw files go
        }
        onProgress({ done: total, total: total, stage: lastShown, aligner: total });
      } finally {
        try { var back = await viewer("setStage", original); restored = !!(back && back.ok); } catch (e) {}
      }

      var readme = [
        "Teeth Exporter (unofficial)",
        "Every aligner with its real gums: " + total + " stages, numbered like the viewer's \"Aligner Number\" slider.",
        "stage_01 = Aligner Number 1 (start of the plan) ... stage_" + String(total).padStart(2, "0") + " = Aligner Number " + total + ".",
        "units: millimeters, true scale", "",
        "One folder per stage. In each stage folder:",
        "  full_mouth_with_gums.stl   both arches, teeth + real gums",
        "  upper_with_gums.stl        upper teeth + gum",
        "  lower_with_gums.stl        lower teeth + gum",
        "  full_mouth.glb             colored, separate meshes, opens in any 3D viewer",
        "  Advanced/                  teeth only, gums only, and per-arch versions of each", "",
        missing.length
          ? "Gum not captured for aligner(s) " + missing.join(", ") + ": those folders use teeth-only files at the top for the missing arch."
          : "Both gums captured for every aligner.",
        "",
        "manifest.json              per-tooth arch / UNS number / width (mm)",
        "Teeth are an exact extraction. Gums are the viewer's own generated surface for each stage."
      ];
      addFile("README.txt", new TextEncoder().encode(readme.join("\n")));
      addFile("manifest.json", new TextEncoder().encode(JSON.stringify({ alignerCount: total, stages: steps, teeth: manifest }, null, 2)));
      zip.end();
      if (zipErr) throw zipErr;
      return { chunks: chunks, bytes: zipBytes, stageCount: total, firstStage: first, lastStage: last, steps: steps, missing: missing, restored: restored };
    })();
  }

  root.TeethAllStages = TeethAllStages;
})(typeof globalThis !== "undefined" ? globalThis : this);
