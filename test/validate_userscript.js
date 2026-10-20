/*
 * validate_userscript.js — load the bundled dist/teeth-exporter.user.js in a stubbed browser
 * environment and confirm (a) it loads with no strict-mode / wiring errors, (b) the decoders +
 * engine wired up (globalThis.ClinCheckEngine exists), and (c) it still exports teeth from a real
 * WCC bundle. The DOM/WebGL hooks just install listeners/prototype patches at load — we stub
 * enough that they don't throw; correctness of decode/seat/export is what we assert.
 *
 *   run:  node build/build_userscript.js && node test/validate_userscript.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(ROOT, "dist/teeth-exporter.user.js");
const DATA = path.resolve(ROOT, "../clincheck-extraction-handoff/data/wcc_extracted");

// ---- minimal browser stubs: in a real page window === self === globalThis (ONE object) ----
function noop() {}
function proto() { return { getContext: function () { return null; }, addEventListener: noop }; }
const listeners = {};
function XHRStub() {}
XHRStub.prototype = { open: noop, send: noop, addEventListener: noop, setRequestHeader: noop };

const sandbox = {
  addEventListener: function (t, f) { (listeners[t] = listeners[t] || []).push(f); },
  removeEventListener: noop, postMessage: noop, setTimeout, clearTimeout, setInterval, clearInterval, console,
  MutationObserver: function () { return { observe: noop, disconnect: noop }; },
  getComputedStyle: function () { return {}; },
  location: { origin: "https://my.invisalign.com", href: "https://my.invisalign.com/" },
  crypto: { getRandomValues: function (a) { for (let i = 0; i < a.length; i++) a[i] = (i * 7 + 3) & 255; return a; } },
  fetch: function () { return Promise.resolve(); }, XMLHttpRequest: XHRStub,
  Blob: function () {}, URL: { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: noop }, Promise,
  HTMLCanvasElement: function () {}, OffscreenCanvas: function () {},
  document: {
    addEventListener: noop, readyState: "loading", body: null,
    documentElement: { appendChild: noop }, querySelectorAll: function () { return []; },
    createElement: function () { return { style: {}, appendChild: noop, addEventListener: noop, attachShadow: function () { return { appendChild: noop }; }, click: noop, remove: noop }; }
  },
  navigator: { userAgent: "node-test" },
  TextEncoder, TextDecoder, Uint8Array, Float32Array, Uint32Array, Uint16Array, Int16Array, Int8Array,
  ArrayBuffer, DataView, Math, JSON, Date, Object, Array, Error, String, Number, Boolean, isNaN, parseInt, parseFloat
};
sandbox.HTMLCanvasElement.prototype = proto();
sandbox.OffscreenCanvas.prototype = proto();
sandbox.window = sandbox.self = sandbox.globalThis = sandbox.global = sandbox;
sandbox.HTMLCanvasElement.prototype = proto();
sandbox.OffscreenCanvas.prototype = proto();
sandbox.globalThis = sandbox;
sandbox.global = sandbox;

const code = fs.readFileSync(BUNDLE, "utf8");
let loadErr = null;
try { vm.runInNewContext(code, sandbox, { filename: "teeth-exporter.user.js" }); }
catch (e) { loadErr = e; }

if (loadErr) { console.error("FAIL  bundle threw on load:\n  " + (loadErr.stack || loadErr)); process.exit(1); }
console.log("bundle loaded with no errors (strict-mode + wiring OK)");

const checks = {
  "globalThis.LZMA": !!sandbox.LZMA,
  "globalThis.CTM": !!sandbox.CTM,
  "globalThis.fflate": !!sandbox.fflate,
  "globalThis.ClinCheckEngine": !!sandbox.ClinCheckEngine,
  "capture.js installed (fetch/XHR hook)": !!sandbox.window.__clincheckCaptureInstalled,
  "webgl_capture.js installed": !!sandbox.window.__clincheckGLInstalled,
  "orchestrator UI installed": !!sandbox.window.__teethExporterUI,
  "shared controller (same as the extension)": typeof sandbox.TeethController === "function",
  "shared panel (same as the extension popup)": typeof sandbox.TeethPanel === "function",
  "every-aligner loop": typeof sandbox.TeethAllStages === "function",
  "shared progress overlay": typeof sandbox.TeethProgress === "function",
  "message listener registered": (listeners.message || []).length >= 1
};
let ok = true;
for (const k in checks) { console.log("  " + (checks[k] ? "✓" : "✗") + " " + k); ok = ok && checks[k]; }

// exercise the engine end-to-end through the bundled globals
try {
  const entries = {};
  for (const f of fs.readdirSync(DATA)) {
    const p = path.join(DATA, f);
    if (fs.statSync(p).isFile()) entries[f] = new Uint8Array(fs.readFileSync(p));
  }
  const zip = sandbox.fflate.zipSync(entries, { level: 0 });
  const res = sandbox.ClinCheckEngine.exportFromBundle(zip, { stage: 0, glb: true });
  const s = res.stats;
  const teethOK = s.teeth === 28 && s.vertices === 31221 && s.faces === 62330;
  console.log("  " + (teethOK ? "✓" : "✗") + " engine.exportFromBundle: " + s.teeth + " teeth / " + s.vertices + " v / " + s.faces + " f");
  ok = ok && teethOK;
} catch (e) { console.log("  ✗ engine.exportFromBundle threw: " + (e && e.message || e)); ok = false; }

console.log("\n" + (ok ? "PASS  the single-file userscript bundle is self-contained and functional" : "FAIL  bundle wiring/engine problem"));
process.exit(ok ? 0 : 1);
