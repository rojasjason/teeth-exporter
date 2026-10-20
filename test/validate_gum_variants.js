/*
 * validate_gum_variants.js — stage-scrub simulation for gum registration.
 *
 * Scrubbing aligner steps makes the viewer REGENERATE the gum, so one capture session can hold
 * several near-identical gum variants per arch (the content-aware dedup keeps them all, by
 * design). registerGums must collapse those to the single best-fitting gum per arch — never
 * export stacked overlapping shells.
 *
 * Simulates it by cloning each real gum with a 0.05 mm jitter (a "regenerated variant") and
 * asserting the export still places exactly one U + one L.
 *
 *   run:  node test/validate_gum_variants.js
 */
const fs = require("fs");
const path = require("path");

global.CTM = require("../lib/ctm.js");
global.fflate = require("../lib/fflate.umd.js");
const engine = require("../src/engine.js");

const HANDOFF = path.resolve(__dirname, "../../clincheck-extraction-handoff");
const DATA = path.join(HANDOFF, "data/wcc_extracted");
const GLB = process.argv[2] || path.join(HANDOFF, "data/captures/rendered_meshes_20260625.glb");

function zipDir(dir) {
  const entries = {};
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) entries[f] = new Uint8Array(fs.readFileSync(p));
  }
  return global.fflate.zipSync(entries, { level: 0 });
}

// minimal GLB reader (same as validate_gums.js)
function readGLB(file) {
  const buf = fs.readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(start, start + len)));
    else if (type === 0x004e4942) bin = buf.subarray(start, start + len);
    off = start + len + ((4 - (len % 4)) % 4);
  }
  const acc = json.accessors, bv = json.bufferViews;
  function readAcc(i) {
    const a = acc[i], v = bv[a.bufferView];
    const base = (v.byteOffset || 0) + (a.byteOffset || 0);
    const n = a.count * (a.type === "VEC3" ? 3 : 1);
    if (a.componentType === 5126) return new Float32Array(bin.buffer, bin.byteOffset + base, n);
    if (a.componentType === 5125) return new Uint32Array(bin.buffer, bin.byteOffset + base, n);
    if (a.componentType === 5123) return new Uint16Array(bin.buffer, bin.byteOffset + base, n);
    throw new Error("componentType " + a.componentType);
  }
  const out = [];
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    out.push({
      positions: Float32Array.from(readAcc(prim.attributes.POSITION)),
      indices: prim.indices != null ? Uint32Array.from(readAcc(prim.indices)) : new Uint32Array(0)
    });
  }
  return out;
}

const meshes = readGLB(GLB);
const variants = [];
for (const m of meshes) {
  if (m.positions.length / 3 >= 2500) {                       // gum-sized -> clone as a jittered variant
    const p2 = Float32Array.from(m.positions);
    for (let i = 0; i < p2.length; i++) p2[i] += 0.00005;     // 0.05 mm in meters
    variants.push({ positions: p2, indices: m.indices });
  }
}
const all = meshes.concat(variants);
console.log(`input: ${meshes.length} ripped meshes + ${variants.length} jittered gum variant(s)`);

const res = engine.exportFromBundle(zipDir(DATA), { stage: 0, glb: true, glMeshes: all });
const gums = res.gumInfo.gums;
console.log("placed:", gums.map((g) => g.arch + "(fit " + g.cost + "mm)").join(", "), "|", res.gumInfo.info);

// one per arch AND both fit tightly — a misassigned gum shows up as a ~4.7mm "fit",
// a correct one is ~2.3mm (proven values from the clean capture)
const oneEach = gums.length === 2 && new Set(gums.map((g) => g.arch)).size === 2;
const tight = gums.every((g) => g.cost < 3.0);
const ok = oneEach && tight;
if (!tight) console.log("  a gum fit exceeds 3mm — likely an arch misassignment, not the stage-matched variant");
console.log("\n" + (ok ? "PASS  variants collapsed to the correct gum per arch (both fits tight)" : "FAIL  expected exactly U+L with tight fits"));
process.exit(ok ? 0 : 1);
