/*
 * viewer_bridge.js — MAIN-world bridge to the ClinCheck viewer's own state (document_start).
 *
 * The viewer page exposes its 3D editor as `window.editor` with getViewState()/setViewState().
 * Its view state carries the REAL aligner stage: stage.currentStage, stage.firstStage,
 * stage.lastStage. That beats reading the DOM label, which is off by one ("Aligner Number 1"
 * at currentStage 0) and does not follow programmatic changes. The plan length comes from
 * firstStage..lastStage, so nothing assumes a step count.
 *
 * Protocol (same TAG + per-load token handshake as capture.js / webgl_capture.js):
 *   in : { kind:"viewer-request", op:"info" | "setStage", stage, reqId }
 *   out: { kind:"viewer-reply", reqId, token, ok, info:{currentStage, firstStage, lastStage}, error }
 *   out: { kind:"viewer-stage", token, info }  pushed whenever the current stage changes
 * Nothing leaves the device.
 */
(function () {
  "use strict";
  var TAG = "CLINCHECK_WCC_CAPTURE";
  if (window.__clincheckViewerBridge) return;
  window.__clincheckViewerBridge = true;

  var TOKEN = (function () {
    try { var a = new Uint8Array(16); (self.crypto || window.crypto).getRandomValues(a); return Array.prototype.map.call(a, function (x) { return (x + 256).toString(16).slice(1); }).join(""); }
    catch (e) { return "v" + (Math.random ? Math.random().toString(36).slice(2) : "x"); }
  })();
  var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
  try { window.postMessage({ source: TAG, kind: "hello", token: TOKEN }, ORIGIN); } catch (e) {}

  function post(msg) { msg.source = TAG; msg.token = TOKEN; try { window.postMessage(msg, ORIGIN); } catch (e) {} }

  function editor() {
    var ed = window.editor;
    return (ed && typeof ed.getViewState === "function" && typeof ed.setViewState === "function") ? ed : null;
  }
  function readInfo() {
    var ed = editor(); if (!ed) return null;
    var st;
    try { var vs = ed.getViewState(); st = vs && vs.stage; } catch (e) { return null; }
    if (!st || typeof st.currentStage !== "number" || typeof st.lastStage !== "number") return null;
    return {
      currentStage: st.currentStage,
      firstStage: typeof st.firstStage === "number" ? st.firstStage : 0,
      lastStage: st.lastStage
    };
  }
  function setStage(n) {
    var ed = editor(); if (!ed) return Promise.reject(new Error("viewer controls not found"));
    var vs = ed.getViewState(), st = vs && vs.stage;
    if (!st) return Promise.reject(new Error("viewer has no stage state"));
    n = Math.max(st.firstStage || 0, Math.min(st.lastStage, n | 0));
    var next = {}; for (var k in vs) next[k] = vs[k];
    var ns = {}; for (var j in st) ns[j] = st[j];
    ns.currentStage = n; next.stage = ns;
    return Promise.resolve(ed.setViewState(next));
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== TAG || d.kind !== "viewer-request") return;
    var reqId = d.reqId;
    if (d.op === "info") {
      var info = readInfo();
      post({ kind: "viewer-reply", reqId: reqId, ok: !!info, info: info, error: info ? null : "viewer controls not found" });
    } else if (d.op === "setStage") {
      setStage(d.stage).then(function () {
        post({ kind: "viewer-reply", reqId: reqId, ok: true, info: readInfo() });
      }, function (e) {
        post({ kind: "viewer-reply", reqId: reqId, ok: false, info: readInfo(), error: String(e && e.message || e) });
      });
    }
  });

  // push stage changes (user drags the slider, plays, or we step it) so the badge stays exact
  var last = null;
  setInterval(function () {
    var info = readInfo(); if (!info) return;
    var key = info.currentStage + ":" + info.firstStage + ":" + info.lastStage;
    if (key !== last) { last = key; post({ kind: "viewer-stage", info: info }); }
  }, 500);
})();
