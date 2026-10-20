/*
 * capture.js — MAIN-world hook (runs in the page's own JS context, document_start).
 *
 * Two jobs:
 *   1. CAPTURE the WCC bundle (the ZIP the viewer loads from .../treatment_plan_video_wcc?...).
 *   2. DIAGNOSTICS: record EVERY mesh/archive-looking response the viewer fetches, so we can
 *      tell whether the gum surface arrives as a separate file we'd otherwise miss. Nothing
 *      leaves the device — records + bytes go only to our isolated content script.
 *
 * We patch fetch + XMLHttpRequest. Detection of the WCC bundle mirrors decode_har.py
 * (ZIP magic "PK" + url mentions wcc, or a large ZIP blob).
 */
(function () {
  "use strict";
  var TAG = "CLINCHECK_WCC_CAPTURE";
  if (window.__clincheckCaptureInstalled) return;
  window.__clincheckCaptureInstalled = true;

  var MAX_BYTES = 96 * 1024 * 1024;   // never buffer/forward responses larger than this

  // Per-load random token. capture.js runs at document_start (before the page's app code),
  // so it announces this token to content.js first; content.js then rejects any message that
  // doesn't carry it — a page script injected later can't have observed an earlier announce.
  var TOKEN = (function () {
    try {
      var a = new Uint8Array(16); (self.crypto || window.crypto).getRandomValues(a);
      return Array.prototype.map.call(a, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    } catch (e) { return "t" + String(Date.now ? Date.now() : 0) + Math.abs((Math.random ? Math.random() : 0.5) * 1e9 | 0); }
  })();

  // ---- format sniffing by magic bytes ----
  function s4(u8) { return String.fromCharCode(u8[0] | 0, u8[1] | 0, u8[2] | 0, u8[3] | 0); }
  function meshKind(u8) {
    if (!u8 || u8.length < 4) return null;
    if (u8[0] === 0x50 && u8[1] === 0x4b) return "zip";          // PK..  (WCC bundle / any zip)
    var m = s4(u8);
    if (m === "OCTM") return "ctm";                              // OpenCTM mesh
    if (m === "glTF") return "glb";                              // binary glTF
    if (m === "DRAC") return "draco";                            // Draco-compressed mesh
    if (m.toLowerCase().slice(0, 3) === "ply") return "ply";
    if (m.toLowerCase() === "soli") return "stl";               // "solid" ascii STL
    return null;
  }
  function isZip(u8) { return u8 && u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b; }
  function looksLikeWCC(url, u8) {
    if (!isZip(u8)) return false;
    if (/treatment_plan_video_wcc|wcc|\.zip(\?|$)/i.test(url)) return true;
    return u8.length > 200000;
  }

  // worth cloning the body? skip obvious html/js/css/json/images to stay light.
  function worthInspecting(url, ct, len) {
    if (/text\/html|javascript|text\/css|^image\/|font|^text\/plain|application\/wasm/i.test(ct)) return false;
    if (/\.(js|css|html?|png|jpe?g|gif|svg|woff2?|ttf|map|wasm)(\?|$)/i.test(url)) return false;
    if (len && len > MAX_BYTES) return false;                   // never clone giant bodies
    if (/octet-stream|zip|model\/|application\/x|ctm|gltf|glb|draco|mesh|binary/i.test(ct)) return true;
    if (/wcc|ctm|gltf|glb|drc|\.ply|\.stl|\.obj|mesh|model|scan|gingiv|gum/i.test(url)) return true;
    if (len && len > 60000) return true;                        // large unknown binary -> peek
    return false;
  }

  // Post to our isolated content script, scoped to THIS page's origin so a cross-origin
  // parent/embedder can never receive the scan bytes. (content.js runs same-origin.)
  var ORIGIN = (location && location.origin && location.origin !== "null") ? location.origin : "*";
  // announce our token to content.js first thing (before any page app code runs)
  try { window.postMessage({ source: TAG, kind: "hello", token: TOKEN }, ORIGIN); } catch (e) {}
  function postWCC(url, ab) {
    try { window.postMessage({ source: TAG, kind: "wcc", token: TOKEN, url: String(url || ""), size: ab.byteLength, bytes: ab }, ORIGIN); } catch (e) {}
  }
  function postResource(url, ct, ab, kind) {
    try {
      window.postMessage({
        source: TAG, kind: "resource", token: TOKEN, url: String(url || ""), ct: String(ct || ""),
        size: ab.byteLength, fmt: kind,
        // keep bytes for recognized meshes/archives so we can inspect them; metadata-only otherwise
        bytes: kind ? ab : null
      }, ORIGIN);
    } catch (e) {}
  }

  // central inspector: called with the response bytes for anything worth a look
  function inspect(url, ct, ab) {
    try {
      if (!ab || ab.byteLength > MAX_BYTES) return;   // never buffer/forward an oversized body
      var u8 = new Uint8Array(ab);
      if (looksLikeWCC(url, u8)) postWCC(url, ab.slice(0));
      var kind = meshKind(u8);
      // record every inspected response (kind=null => metadata only, so we still see "what loaded")
      postResource(url, ct, ab.slice(0), kind);
    } catch (e) {}
  }

  // ---- fetch ----
  var _fetch = window.fetch;
  if (typeof _fetch === "function") {
    window.fetch = function () {
      var args = arguments, reqUrl = "";
      try { reqUrl = (args[0] && args[0].url) ? args[0].url : String(args[0]); } catch (e) {}
      return _fetch.apply(this, args).then(function (res) {
        try {
          var url = reqUrl || res.url || "";
          var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
          var len = (res.headers && res.headers.get && +res.headers.get("content-length")) || 0;
          if (worthInspecting(url, ct, len)) {
            res.clone().arrayBuffer().then(function (ab) { inspect(url, ct, ab); }).catch(function () {});
          }
        } catch (e) {}
        return res;
      });
    };
  }

  // ---- XMLHttpRequest ----
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__wccUrl = url; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    this.addEventListener("load", function () {
      try {
        var url = xhr.__wccUrl || "";
        var ct = (xhr.getResponseHeader && xhr.getResponseHeader("content-type")) || "";
        var worth = worthInspecting(url, ct, 0);
        // not obviously a mesh: peek only the first bytes (no copy) and inspect just if they are
        // a known mesh/archive magic. Heavy images/blobs are no longer cloned "just in case".
        if (xhr.response instanceof ArrayBuffer) {
          var ab = xhr.response;
          if (ab.byteLength > MAX_BYTES) return;
          if (worth || meshKind(new Uint8Array(ab, 0, Math.min(8, ab.byteLength)))) inspect(url, ct, ab);
          return;
        }
        if (xhr.responseType === "blob" && xhr.response) {
          var blob = xhr.response;
          if (blob.size > MAX_BYTES) return;
          if (worth) { blob.arrayBuffer().then(function (b) { inspect(url, ct, b); }).catch(function () {}); return; }
          blob.slice(0, 8).arrayBuffer().then(function (head) {
            if (meshKind(new Uint8Array(head))) return blob.arrayBuffer().then(function (b) { inspect(url, ct, b); });
          }).catch(function () {});
          return;
        }
        if (!worth && xhr.responseType !== "" && xhr.responseType !== "text") return;
        if (xhr.responseType === "" || xhr.responseType === "text") {
          var s = xhr.responseText || "";
          if (s && (s.charCodeAt(0) === 0x50 && s.charCodeAt(1) === 0x4b)) {
            var u = new Uint8Array(s.length);
            for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
            inspect(url, ct, u.buffer);
          }
        }
      } catch (e) {}
    });
    return _send.apply(this, arguments);
  };
})();
