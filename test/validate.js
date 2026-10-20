/*
 * validate.js — offline parity check: JS engine vs the Python pipeline.
 *
 * Zips the already-extracted WCC bundle (../../clincheck-extraction-handoff/data/wcc_extracted),
 * runs it through src/engine.js exactly as the browser extension will, and compares the seated
 * full-mouth teeth stats to the Python oracle.
 *
 *   run:  node test/validate.js
 */
const fs = require("fs");
const path = require("path");

// expose the vendored libs as globals BEFORE loading the engine (mirrors the browser)
global.CTM = require("../lib/ctm.js");
global.fflate = require("../lib/fflate.umd.js");
const engine = require("../src/engine.js");

const DATA = path.resolve(__dirname, "../../clincheck-extraction-handoff/data/wcc_extracted");

// Python oracle (from build_model seating, stage 0) — see chat / build_model.py
const ORACLE = {
  teeth: 28, vertices: 31221, faces: 62330,
  bboxMin: [-34.3066, 14.8230, -48.4988],
  bboxMax: [32.1205, 34.3749, -0.5345],
  centroid: [-0.3566, 25.5083, -23.7170]
};

function zipDir(dir) {
  const entries = {};
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) entries[f] = new Uint8Array(fs.readFileSync(p));
  }
  return global.fflate.zipSync(entries, { level: 0 });
}

function close(a, b, tol) { return Math.abs(a - b) <= tol; }
function vclose(a, b, tol) { return a.every((x, i) => close(x, b[i], tol)); }

const zipBytes = zipDir(DATA);
const t0 = Date.now();
const res = engine.exportFromBundle(zipBytes, { stage: 0, glb: true });
const dt = Date.now() - t0;
const s = res.stats;

const fmt = (v) => v.map((x) => x.toFixed(4)).join(", ");
console.log(`decode+seat+export in ${dt} ms\n`);
console.log("                    JS engine                         Python oracle");
console.log(`teeth      ${String(s.teeth).padEnd(34)} ${ORACLE.teeth}`);
console.log(`vertices   ${String(s.vertices).padEnd(34)} ${ORACLE.vertices}`);
console.log(`faces      ${String(s.faces).padEnd(34)} ${ORACLE.faces}`);
console.log(`bbox min   ${("[" + fmt(s.bboxMin) + "]").padEnd(34)} [${fmt(ORACLE.bboxMin)}]`);
console.log(`bbox max   ${("[" + fmt(s.bboxMax) + "]").padEnd(34)} [${fmt(ORACLE.bboxMax)}]`);
console.log(`centroid   ${("[" + fmt(s.centroid) + "]").padEnd(34)} [${fmt(ORACLE.centroid)}]`);

const TOL = 0.01; // mm
let pass =
  s.teeth === ORACLE.teeth &&
  s.vertices === ORACLE.vertices &&
  s.faces === ORACLE.faces &&
  vclose(s.bboxMin, ORACLE.bboxMin, TOL) &&
  vclose(s.bboxMax, ORACLE.bboxMax, TOL) &&
  vclose(s.centroid, ORACLE.centroid, TOL);

// write outputs for eyeballing in a slicer / viewer
const OUT = path.resolve(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
for (const name in res.outputs) fs.writeFileSync(path.join(OUT, name), res.outputs[name]);
const zip = engine.zipOutputs(res.outputs, { "manifest.json": new TextEncoder().encode(JSON.stringify(res.manifest, null, 2)) });
fs.writeFileSync(path.join(OUT, "clincheck_export.zip"), zip);

// every-stage export: one folder per stage, stage_00 identical to the single stage-0 export,
// and the final stage actually differs (teeth moved)
const all = engine.exportAllStages(zipBytes);
const dirs = new Set(Object.keys(all.outputs).map((k) => k.split("/")[0]));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const allOk = dirs.size === all.stageCount && all.stageCount === 22 &&
  same(all.outputs["stage_00/full_mouth_teeth.stl"], res.outputs["full_mouth_teeth.stl"]) &&
  !same(all.outputs["stage_21/full_mouth_teeth.stl"], res.outputs["full_mouth_teeth.stl"]) &&
  ["full_mouth_teeth.stl", "upper_teeth.stl", "lower_teeth.stl", "full_mouth_teeth.glb"].every((f) => all.outputs["stage_21/" + f]);
console.log((allOk ? "  ✓ " : "  ✗ ") + `all-stages export: ${dirs.size} folders, stage_00 == stage-0 export, stage_21 differs`);
pass = pass && allOk;

console.log(`\nwrote ${Object.keys(res.outputs).length} files + clincheck_export.zip to test/out/`);
console.log("\n" + (pass ? "PASS  JS engine matches the Python oracle within 0.01 mm" : "FAIL  mismatch vs oracle"));
process.exit(pass ? 0 : 1);
