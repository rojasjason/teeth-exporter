/*
 * webgl_capture.js — MAIN-world WebGL geometry ripper (experimental, document_start).
 *
 * The ClinCheck WASM engine GENERATES the gum at runtime and hands the finished vertices to
 * WebGL to draw. We can't read the WASM, but we CAN intercept that GPU-upload boundary: hook
 * getContext + the GL buffer/draw calls, and reconstruct every distinct mesh the engine draws
 * (positions + indices), plus a diagnostic manifest (attribute layouts, index type, candidate
 * color uniforms, VAO usage, coordinate ranges).
 *
 * This is step 1 — a DUMP of everything drawn — so we can identify which draw is the gum and
 * learn the engine's coordinate space. Nothing leaves the device; results go (token-authed) to
 * our isolated content script, which packages them into a downloadable GLB + manifest.
 *
 * Known v1 limits: best-effort for FLOAT positions (also HALF_FLOAT / normalized SHORT); tracks
 * attrib state globally + per-VAO when bindVertexArray is used; positions assumed to be the
 * lowest-location enabled FLOAT vec3/vec4 attribute (the manifest lists all so we can correct).
 */
(function () {
  "use strict";
  var TAG = "CLINCHECK_WCC_CAPTURE";
  if (window.__clincheckGLInstalled) return;
  window.__clincheckGLInstalled = true;

  // own per-load token, announced to content.js at document_start (before page code runs)
  var TOKEN = (function () {
    try { var a = new Uint8Array(16); (self.crypto || window.crypto).getRandomValues(a); return Array.prototype.map.call(a, function (x) { return (x + 256).toString(16).slice(1); }).join(""); }
    catch (e) { return "g" + (Math.random ? Math.random().toString(36).slice(2) : "x"); }
  })();
  var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
  try { window.postMessage({ source: TAG, kind: "hello", token: TOKEN }, ORIGIN); } catch (e) {}
  var MAX_DRAWS = 4000;        // distinct draw signatures to remember
  var MAX_BUF = 64 * 1024 * 1024;
  var MAX_SNAP_TOTAL = 192 * 1024 * 1024;  // total bytes of draw-time snapshots kept per context
  var MAX_BUF_TOTAL = 256 * 1024 * 1024;   // total bytes of live upload copies kept per context

  // ---- GL constant byte sizes ----
  function compBytes(type) {
    switch (type) {
      case 0x1400: case 0x1401: return 1; // BYTE / UNSIGNED_BYTE
      case 0x1402: case 0x1403: return 2; // SHORT / UNSIGNED_SHORT
      case 0x1404: case 0x1405: return 4; // INT / UNSIGNED_INT
      case 0x140B: return 2;              // HALF_FLOAT
      case 0x1406: return 4;              // FLOAT
      default: return 4;
    }
  }
  function halfToFloat(h) {
    var s = (h & 0x8000) >> 15, e = (h & 0x7C00) >> 10, f = h & 0x03FF;
    if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    if (e === 0x1F) return f ? NaN : (s ? -Infinity : Infinity);
    return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  var contexts = [];
  // Epochs let a caller ask "what was drawn since X": gl-mark bumps EPOCH, every draw (new or a
  // repeat of a known one) stamps its record with the current EPOCH, and a snapshot can be limited
  // to draws stamped at or after a given epoch. Used to rip exactly one aligner step's gums.
  var EPOCH = 0;

  function instrument(gl, kind) {
    var S = {
      kind: kind, gl: gl,
      buffers: new Map(),                 // WebGLBuffer -> Uint8Array (last uploaded bytes)
      boundArray: null, boundElement: null,
      program: null,
      vaos: new Map(),                    // vao -> { attribs:{loc:layout}, element:buffer }
      curVAO: null,
      globalAttribs: {}, globalElement: null,
      draws: [], seen: {}, drawBySig: {},
      colorByProgram: new Map(),          // program -> last vec4-ish uniform seen (color guess)
      snapCache: new Map(), snapBytes: 0, // fingerprint -> shared byte copy; total kept bytes
      fps: new Map(),                     // WebGLBuffer -> content hash of its current bytes
      bufBytes: 0,                        // running total of S.buffers
      overBudget: false,                  // a draw was dropped because MAX_SNAP_TOTAL was hit
      capHit: false                       // a new draw was dropped because MAX_DRAWS was hit
    };
    contexts.push(S);

    function attribTable() { return S.curVAO ? (S.vaos.get(S.curVAO) || setVAO(S.curVAO)).attribs : S.globalAttribs; }
    function setVAO(v) { if (!S.vaos.has(v)) S.vaos.set(v, { attribs: {}, element: null }); return S.vaos.get(v); }
    function elementBuf() { return S.curVAO ? (S.vaos.get(S.curVAO) || setVAO(S.curVAO)).element : S.globalElement; }

    function wrap(name, fn) { var orig = gl[name]; if (typeof orig !== "function") return; gl[name] = function () { try { fn.apply(null, arguments); } catch (e) {} return orig.apply(gl, arguments); }; }

    wrap("bindBuffer", function (target, buffer) {
      if (target === gl.ARRAY_BUFFER) S.boundArray = buffer;
      else if (target === gl.ELEMENT_ARRAY_BUFFER) {
        S.boundElement = buffer;
        if (S.curVAO) setVAO(S.curVAO).element = buffer; else S.globalElement = buffer;
      }
    });
    // the buffer an upload lands in: element uploads follow the bound VAO's element binding
    function targetBuf(target) { return (target === gl.ELEMENT_ARRAY_BUFFER) ? elementBuf() : S.boundArray; }
    // copy the uploaded bytes, honoring WebGL2's (srcOffset, length) in elements of a typed view.
    // Always a COPY: a bare ArrayBuffer is often a scratch buffer the viewer reuses for the next mesh.
    function setBuf(buf, bytes) {                    // keep one upload copy, within the aggregate cap
      var old = S.buffers.get(buf);
      if (old) S.bufBytes -= old.byteLength;
      S.buffers.delete(buf);
      if (!bytes || bytes.byteLength > MAX_BUF || S.bufBytes + bytes.byteLength > MAX_BUF_TOTAL) return;
      S.buffers.set(buf, bytes); S.bufBytes += bytes.byteLength;
    }
    function viewLen(data, srcOffset, length) {      // bytes an upload would copy, without copying
      if (data.buffer) { var esz = data.BYTES_PER_ELEMENT || 1; return length ? length * esz : data.byteLength - (srcOffset ? srcOffset * esz : 0); }
      return data.byteLength;
    }
    function srcBytes(data, srcOffset, length) {
      if (data.buffer) {
        var esz = data.BYTES_PER_ELEMENT || 1;
        var start = data.byteOffset + (srcOffset ? srcOffset * esz : 0);
        var end = length ? start + length * esz : data.byteOffset + data.byteLength;
        return new Uint8Array(data.buffer.slice(start, Math.min(end, data.byteOffset + data.byteLength)));
      }
      return new Uint8Array(data.slice(0));
    }
    wrap("bufferData", function (target, data, usage, srcOffset, length) {
      var buf = targetBuf(target);
      if (!buf) return;
      S.fps.delete(buf);
      if (typeof data === "number" || !data || viewLen(data, srcOffset, length) > MAX_BUF) { setBuf(buf, null); return; }
      setBuf(buf, srcBytes(data, srcOffset, length));
    });
    wrap("bufferSubData", function (target, offset, data, srcOffset, length) {
      var buf = targetBuf(target);
      if (!buf || !data || typeof data === "number") return;
      S.fps.delete(buf);
      var need = offset + viewLen(data, srcOffset, length);
      if (need > MAX_BUF) { setBuf(buf, null); return; }                 // never grow past the cap
      var bytes = srcBytes(data, srcOffset, length), cur = S.buffers.get(buf);
      if (!cur || cur.byteLength < need) { var nb = new Uint8Array(Math.max(need, cur ? cur.byteLength : 0)); if (cur) nb.set(cur); cur = nb; }
      cur.set(bytes, offset); setBuf(buf, cur);
    });
    // a deleted GL buffer's copy is dead weight: drop it so long sessions don't grow without bound
    wrap("deleteBuffer", function (buf) { if (buf) { setBuf(buf, null); S.fps.delete(buf); } });
    wrap("vertexAttribPointer", function (loc, size, type, normalized, stride, offset) {
      attribTable()[loc] = { buffer: S.boundArray, size: size, type: type, normalized: !!normalized, stride: stride, offset: offset, enabled: true };
    });
    if (gl.vertexAttribIPointer) wrap("vertexAttribIPointer", function (loc, size, type, stride, offset) {
      attribTable()[loc] = { buffer: S.boundArray, size: size, type: type, normalized: false, stride: stride, offset: offset, enabled: true, integer: true };
    });
    wrap("enableVertexAttribArray", function (loc) { var a = attribTable()[loc]; if (a) a.enabled = true; });
    wrap("disableVertexAttribArray", function (loc) { var a = attribTable()[loc]; if (a) a.enabled = false; });
    wrap("useProgram", function (p) { S.program = p; });
    if (gl.bindVertexArray) wrap("bindVertexArray", function (v) { S.curVAO = v; });
    // crude color guess: remember vec4 uniforms (likely material/base color)
    ["uniform4f", "uniform4fv"].forEach(function (n) {
      if (!gl[n]) return;
      wrap(n, function (loc, a, b, c, d) {
        var col = (n === "uniform4f") ? [a, b, c, d] : (a && a.length >= 4 ? [a[0], a[1], a[2], a[3]] : null);
        if (col && S.program) S.colorByProgram.set(S.program, col);
      });
    });

    function progId(p) { if (!p.__cid) p.__cid = "prog" + (++progId._n); return p.__cid; }
    progId._n = 0;

    // Content fingerprint: byte length + two FNV-1a hashes over EVERY byte. Two draws with
    // identical LAYOUT but different geometry (upper vs lower gum share one template; a new
    // stage's gum differs from the last by a few hundred vertices) always get distinct
    // fingerprints. Sampling missed small contiguous changes, so this hashes everything, but
    // only once per upload: the result is cached per buffer until bufferData/bufferSubData.
    function fingerprint(bytes) {
      var n = bytes.byteLength, h1 = 0x811c9dc5, h2 = 0x01000193 ^ n;
      for (var i = 0; i < n; i++) {
        var b = bytes[i];
        h1 = Math.imul(h1 ^ b, 0x01000193);
        h2 = Math.imul(h2 ^ b, 0x85ebca6b) ^ (h2 >>> 13);
      }
      return n + ":" + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
    }
    function fpFor(buf, bytes) {
      var f = S.fps.get(buf);
      if (f == null) { f = fingerprint(bytes); S.fps.set(buf, f); }
      return f;
    }

    function record(mode, count, indexType, indexOffset, drawType) {
      var attribs = attribTable();
      var locs = Object.keys(attribs).filter(function (l) { return attribs[l].enabled && attribs[l].buffer; });
      if (!locs.length) return;
      var attribList = locs.map(function (l) { var a = attribs[l]; return { loc: +l, size: a.size, type: a.type, stride: a.stride, offset: a.offset, normalized: a.normalized, buffer: a.buffer, integer: !!a.integer }; });
      // pick the position attribute up front so we can fingerprint + snapshot its bytes NOW
      var pos = pickPosition(attribList);
      var posBytes = pos && pos.buffer ? S.buffers.get(pos.buffer) : null;
      if (!posBytes) return;                                   // nothing uploaded yet — skip
      var elemBuf = (drawType === "elements") ? elementBuf() : null;
      var elemBytes = elemBuf ? S.buffers.get(elemBuf) : null;
      // layout signature + content fingerprint => dedupe identical geometry across frames,
      // while keeping distinct geometry that happens to share a layout.
      var vfp = fpFor(pos.buffer, posBytes);
      var ifp = elemBytes ? fpFor(elemBuf, elemBytes) : "-";   // same vertices, new triangles = a new draw
      var sig = drawType + "|" + (S.program ? progId(S.program) : "-") + "|" + mode + "|" + count + "|" + locs.map(function (l) { var a = attribs[l]; return l + ":" + a.size + ":" + a.type + ":" + a.stride + ":" + a.offset; }).join(",") + "|" + indexType + ":" + indexOffset + "|fp:" + vfp + "|ifp:" + ifp;
      var now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      if (S.seen[sig]) { var known = S.drawBySig[sig]; if (known) { known.epoch = EPOCH; known.t = now; } return; }
      // the cap applies to NEW draws only, so known draws above keep getting fresh epochs/timestamps
      if (S.draws.length >= MAX_DRAWS) { S.capHit = true; return; }
      // snapshot the referenced bytes AT DRAW TIME so a later overwrite can't corrupt them.
      // Copies are shared via a content-fingerprint cache (many draws reference the same upload,
      // e.g. one interleaved buffer per model) and bounded by MAX_SNAP_TOTAL so stage-scrubbing /
      // animation can't grow memory without limit.
      function snap(bytes, key) {
        var c = S.snapCache.get(key);
        if (c) return c;
        if (S.snapBytes + bytes.byteLength > MAX_SNAP_TOTAL) return null;
        c = new Uint8Array(bytes); S.snapBytes += c.byteLength; S.snapCache.set(key, c);
        return c;
      }
      var vkey = "v:" + posBytes.byteLength + ":" + vfp, ikey = elemBytes ? "i:" + ifp : null;
      var vcopy = snap(posBytes, vkey);
      var icopy = elemBytes ? snap(elemBytes, ikey) : null;
      // over budget: keep what we have, and say so. The signature is NOT burned, so the draw is
      // retried (and can still be kept) if budget frees up; nothing is silently marked "seen".
      if (!vcopy || (elemBytes && !icopy)) { S.overBudget = true; return; }
      S.seen[sig] = true;
      var rec = {
        epoch: EPOCH, t: now,                                  // t = last time this draw was seen (latest-frame filter)
        created: EPOCH, sig: sig, vkey: vkey, ikey: ikey,      // for gl-stats and pruning
        mode: mode, count: count, drawType: drawType, indexType: indexType, indexOffset: indexOffset,
        program: S.program ? progId(S.program) : null,
        color: S.program ? (S.colorByProgram.get(S.program) || null) : null,
        attribs: attribList,
        posBuffer: pos.buffer,
        vbytes: vcopy,                                         // shared snapshot (read-only)
        ibytes: icopy,
        element: elemBuf
      };
      S.draws.push(rec); S.drawBySig[sig] = rec;
    }
    wrap("drawElements", function (mode, count, type, offset) { record(mode, count, type, offset, "elements"); });
    wrap("drawArrays", function (mode, first, count) { record(mode, count, 0, first, "arrays"); });
    if (gl.drawElementsInstanced) wrap("drawElementsInstanced", function (mode, count, type, offset) { record(mode, count, type, offset, "elements"); });
    if (gl.drawArraysInstanced) wrap("drawArraysInstanced", function (mode, first, count) { record(mode, count, 0, first, "arrays"); });
    if (gl.drawRangeElements) wrap("drawRangeElements", function (mode, start, end, count, type, offset) { record(mode, count, type, offset, "elements"); });
    // ANGLE_instanced_arrays (WebGL1) lives on an extension object, not the context
    var _ext = gl.getExtension;
    if (typeof _ext === "function") gl.getExtension = function (name) {
      var ext = _ext.apply(gl, arguments);
      try {
        if (ext && name === "ANGLE_instanced_arrays" && !ext.__clincheckHooked) {
          ext.__clincheckHooked = true;
          var de = ext.drawElementsInstancedANGLE, da = ext.drawArraysInstancedANGLE;
          if (de) ext.drawElementsInstancedANGLE = function (mode, count, type, offset) { try { record(mode, count, type, offset, "elements"); } catch (e) {} return de.apply(ext, arguments); };
          if (da) ext.drawArraysInstancedANGLE = function (mode, first, count) { try { record(mode, count, 0, first, "arrays"); } catch (e) {} return da.apply(ext, arguments); };
        }
      } catch (e) {}
      return ext;
    };
  }

  // drop draws not seen since minEpoch and rebuild the snapshot cache from what's left, so a long
  // every-aligner run holds about two aligners' worth of geometry instead of all of them
  function prune(minEpoch) {
    contexts.forEach(function (S) {
      var keep = S.draws.filter(function (r) { return r.epoch >= minEpoch; });
      if (keep.length === S.draws.length) return;
      var seen = {}, bySig = {}, cache = new Map(), bytes = 0;
      keep.forEach(function (r) {
        seen[r.sig] = true; bySig[r.sig] = r;
        if (!cache.has(r.vkey)) { cache.set(r.vkey, r.vbytes); bytes += r.vbytes.byteLength; }
        if (r.ikey && !cache.has(r.ikey)) { cache.set(r.ikey, r.ibytes); bytes += r.ibytes.byteLength; }
      });
      S.draws = keep; S.seen = seen; S.drawBySig = bySig; S.snapCache = cache; S.snapBytes = bytes;
      S.overBudget = false; S.capHit = false;
    });
  }

  // ---- decode a recorded draw into positions + indices ----
  function readScalar(dv, off, type, normalized) {
    switch (type) {
      case 0x1406: return dv.getFloat32(off, true);
      case 0x140B: return halfToFloat(dv.getUint16(off, true));
      case 0x1401: { var u = dv.getUint8(off); return normalized ? u / 255 : u; }
      case 0x1400: { var b = dv.getInt8(off); return normalized ? Math.max(b / 127, -1) : b; }
      case 0x1403: { var us = dv.getUint16(off, true); return normalized ? us / 65535 : us; }
      case 0x1402: { var sh = dv.getInt16(off, true); return normalized ? Math.max(sh / 32767, -1) : sh; }
      case 0x1405: return dv.getUint32(off, true);
      case 0x1404: return dv.getInt32(off, true);
      default: return dv.getFloat32(off, true);
    }
  }
  function pickPosition(attribs) {
    // prefer enabled FLOAT/HALF vec3 (then vec4), lowest location
    var cand = attribs.filter(function (a) { return (a.size === 3 || a.size === 4) && (a.type === 0x1406 || a.type === 0x140B); });
    cand.sort(function (x, y) { return (x.size - y.size) || (x.loc - y.loc); });
    return cand[0] || attribs.slice().sort(function (x, y) { return x.loc - y.loc; })[0];
  }
  function decodeDraw(S, d, idx) {
    var pos = pickPosition(d.attribs);
    if (!pos) return null;
    var vbytes = d.vbytes; if (!vbytes) return null;           // bytes snapshotted at draw time
    var vdv = new DataView(vbytes.buffer, vbytes.byteOffset, vbytes.byteLength);
    var cb = compBytes(pos.type), stride = pos.stride || pos.size * cb;
    // vertices available: the last one only needs its own attribute bytes, not a full stride
    var attrBytes = pos.size * cb;
    var nMax = vbytes.byteLength >= pos.offset + attrBytes ? 1 + Math.floor((vbytes.byteLength - pos.offset - attrBytes) / stride) : 0;
    if (nMax <= 0) return null;

    var indices = null;
    if (d.drawType === "elements" && d.element) {
      var ibytes = d.ibytes; if (!ibytes) return null;
      var idv = new DataView(ibytes.buffer, ibytes.byteOffset, ibytes.byteLength);
      var isz = compBytes(d.indexType), get = (d.indexType === 0x1405) ? "getUint32" : (d.indexType === 0x1401 ? "getUint8" : "getUint16");
      if (d.indexOffset < 0 || d.indexOffset + d.count * isz > ibytes.byteLength) return null;   // indices past the upload
      indices = new Uint32Array(d.count);
      for (var i = 0; i < d.count; i++) indices[i] = idv[get](d.indexOffset + i * isz, true);
    }
    // bound vertex count to what's referenced; a draw that references vertices we don't have
    // would export NaN/garbage faces, so drop it instead of clamping
    var nVerts = nMax;
    if (indices) { var mx = 0; for (var k = 0; k < indices.length; k++) if (indices[k] > mx) mx = indices[k]; if (mx + 1 > nMax) return null; nVerts = mx + 1; }
    else { if (d.indexOffset + d.count > nMax) return null; nVerts = d.indexOffset + d.count; }
    if (nVerts > 4000000) return null;

    var positions = new Float32Array(nVerts * 3);
    for (var v = 0; v < nVerts; v++) {
      var base = pos.offset + v * stride;
      positions[3 * v] = readScalar(vdv, base, pos.type, pos.normalized);
      positions[3 * v + 1] = readScalar(vdv, base + cb, pos.type, pos.normalized);
      positions[3 * v + 2] = pos.size >= 3 ? readScalar(vdv, base + 2 * cb, pos.type, pos.normalized) : 0;
    }
    if (!indices) {                      // drawArrays: sequential
      indices = new Uint32Array(d.count);
      for (var a = 0; a < d.count; a++) indices[a] = d.indexOffset + a;
    }
    // bbox + center for the manifest
    var mn = [Infinity, Infinity, Infinity], mx2 = [-Infinity, -Infinity, -Infinity];
    for (var p = 0; p < positions.length; p += 3) for (var c = 0; c < 3; c++) { var val = positions[p + c]; if (val < mn[c]) mn[c] = val; if (val > mx2[c]) mx2[c] = val; }
    return {
      name: "draw" + idx + (d.program ? "_" + d.program : ""),
      positions: positions, indices: indices,
      meta: { drawType: d.drawType, mode: d.mode, glMode: d.mode, vertCount: nVerts, indexCount: indices.length,
        program: d.program, color: d.color, posType: pos.type, posSize: pos.size, stride: stride,
        bboxMin: mn.map(r), bboxMax: mx2.map(r), attribLocs: d.attribs.map(function (a) { return a.loc + ":sz" + a.size + ":ty" + a.type.toString(16); }) }
    };
  }
  function r(x) { return Math.round(x * 1000) / 1000; }

  // latestFrame: only the draws of each canvas's most recent frame (seen within 150 ms of that
  // canvas's newest draw), i.e. what is on screen now rather than every variant drawn this session.
  // Per canvas, so another canvas drawing later can't push the dental canvas's frame out.
  function snapshot(sinceEpoch, latestFrame) {
    var out = [];
    for (var c = 0; c < contexts.length; c++) {
      var S = contexts[c], cutoff = -Infinity;
      if (latestFrame) {
        var newest = -Infinity;
        for (var j = 0; j < S.draws.length; j++) if (S.draws[j].t > newest) newest = S.draws[j].t;
        cutoff = newest - 150;
      }
      for (var i = 0; i < S.draws.length; i++) {
        if (sinceEpoch != null && !(S.draws[i].epoch >= sinceEpoch)) continue;
        if (latestFrame && !(S.draws[i].t >= cutoff)) continue;
        // one malformed draw must not wipe every other mesh (and with it the gums)
        var m = null;
        try { m = decodeDraw(S, S.draws[i], i); } catch (e) { m = null; }
        if (m && m.positions.length) out.push(m);
      }
    }
    return out;
  }

  // ---- bridge: respond to a snapshot request from content.js ----
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== TAG) return;
    if (d.kind === "gl-mark") {
      EPOCH++;
      prune(EPOCH - 1);                  // an every-aligner run: forget aligners older than the last one
      try { window.postMessage({ source: TAG, kind: "gl-mark-ack", token: TOKEN, reqId: d.reqId, epoch: EPOCH }, ORIGIN); } catch (e) {}
      return;
    }
    if (d.kind === "gl-stats-request") {
      // cheap: how many distinct draws were seen since an epoch (no geometry transferred)
      var n = 0, made = 0;
      for (var ci = 0; ci < contexts.length; ci++) for (var di = 0; di < contexts[ci].draws.length; di++) {
        var dr = contexts[ci].draws[di];
        if (dr.epoch >= d.sinceEpoch) n++;
        if (dr.created >= d.sinceEpoch) made++;
      }
      try { window.postMessage({ source: TAG, kind: "gl-stats", token: TOKEN, reqId: d.reqId, recent: n, created: made }, ORIGIN); } catch (e) {}
      return;
    }
    if (d.kind !== "gl-snapshot-request") return;
    var reqId = d.reqId == null ? null : d.reqId;
    var meshes = [];
    try { meshes = snapshot(typeof d.sinceEpoch === "number" ? d.sinceEpoch : null, !!d.latestFrame); } catch (e) {}
    // send light payloads (transfer the buffers)
    var payload = meshes.map(function (m) { return { name: m.name, positions: m.positions, indices: m.indices, meta: m.meta }; });
    try {
      window.postMessage({ source: TAG, kind: "gl-snapshot", token: TOKEN, reqId: reqId, count: payload.length, meshes: payload,
        summary: { contexts: contexts.length, kinds: contexts.map(function (s) { return s.kind; }), totalDraws: contexts.reduce(function (a, s) { return a + s.draws.length; }, 0),
          budgetExceeded: contexts.some(function (s) { return s.overBudget || s.capHit; }) } }, ORIGIN);
    } catch (e) {
      // if structured clone is too big, send just the manifest
      try { window.postMessage({ source: TAG, kind: "gl-snapshot", token: TOKEN, reqId: reqId, count: payload.length, meshes: [], error: "payload too large: " + String(e && e.message || e), manifestOnly: payload.map(function (m) { return m.meta; }) }, ORIGIN); } catch (e2) {}
    }
  });

  // ---- hook context creation ----
  var _get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var ctx = _get.apply(this, arguments);
    try {
      if (ctx && !ctx.__clincheckHooked && (type === "webgl" || type === "webgl2" || type === "experimental-webgl")) {
        ctx.__clincheckHooked = true; instrument(ctx, type);
      }
    } catch (e) {}
    return ctx;
  };
  if (window.OffscreenCanvas && OffscreenCanvas.prototype.getContext) {
    var _oget = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (type) {
      var ctx = _oget.apply(this, arguments);
      try { if (ctx && !ctx.__clincheckHooked && /webgl/.test(type)) { ctx.__clincheckHooked = true; instrument(ctx, type + "(offscreen)"); } } catch (e) {}
      return ctx;
    };
  }
})();
