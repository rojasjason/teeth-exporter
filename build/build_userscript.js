/*
 * build_userscript.js — bundle the whole tool into ONE self-contained Tampermonkey userscript.
 *
 * Concatenates (inside a single outer IIFE, so nothing leaks to the page except the intended
 * globals): the vendored decoders → engine → the unchanged capture + WebGL-rip hooks → the
 * single-context orchestrator/UI. The result is dist/teeth-exporter.user.js — a beta tester
 * installs Tampermonkey once (no Developer Mode) and opens this one file.
 *
 *   run:  node build/build_userscript.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const VERSION = manifest.version || "0.1.0";
const REPO = "https://github.com/rojasjason/teeth-exporter";          // updated at launch
const RAW = "https://raw.githubusercontent.com/rojasjason/teeth-exporter/main/dist/teeth-exporter.user.js";

// domains the extension matches → @match lines
const matches = (manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].matches) || [
  "*://*.invisalign.com/*", "*://*.aligntech.com/*", "*://*.clincheck.com/*"
];

const header = [
  "// ==UserScript==",
  "// @name         Teeth Exporter (unofficial)",
  "// @namespace    " + REPO,
  "// @version      " + VERSION,
  "// @description  Export your own teeth + gums as STL/GLB from your aligner's 3D treatment-plan viewer. Unofficial; runs entirely in your browser.",
  "// @author       Jason Rojas",
  "// @homepageURL  " + REPO,
  "// @supportURL   " + REPO + "/issues",
  ...matches.map((m) => "// @match        " + m),
  "// @run-at       document-start",
  "// @grant        none",
  "// @downloadURL  " + RAW,
  "// @updateURL    " + RAW,
  "// @license      CC-BY-NC-SA-4.0",
  "// ==/UserScript==",
  ""
].join("\n");

// order matters: decoders set globalThis.{LZMA,CTM,fflate}; engine reads them; hooks; orchestrator
const parts = [
  "lib/lzma.js",
  "lib/ctm.js",
  "lib/fflate.umd.js",
  "src/engine.js",
  "src/stage_probe.js",
  "src/capture.js",
  "src/webgl_capture.js",
  "src/viewer_bridge.js",
  "src/all_stages.js",
  "src/controller.js",
  "src/ui_panel.js",
  "src/userscript_orchestrator.js"
];

function section(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return "\n/* ===================== " + rel + " ===================== */\n" + code + "\n";
}

const body = [
  "(function () {",
  '"use strict";',
  "/* Bundled by build/build_userscript.js — do not edit dist/ directly; edit src/ + lib/ and rebuild. */",
  parts.map(section).join("\n"),
  "})();",
  ""
].join("\n");

const out = header + "\n" + body;
const OUT_DIR = path.join(ROOT, "dist");
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, "teeth-exporter.user.js");
fs.writeFileSync(OUT, out);

console.log("wrote " + path.relative(ROOT, OUT) + "  (" + Math.round(out.length / 1024) + " KB)");
console.log("@match: " + matches.join("  "));
