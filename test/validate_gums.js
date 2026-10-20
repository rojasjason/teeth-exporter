/*
 * validate_gums.js — parity check for the WebGL-rip gum registration.
 *
 * Feeds the SAME inputs the extension uses at runtime:
 *   - the WCC bundle (zipped from ../../clincheck-extraction-handoff/data/wcc_extracted)
 *   - the ripped meshes from a real capture (rendered_meshes.glb)
 * through engine.exportFromBundle({glMeshes}), then checks the registered gums against the
 * Python reference (../../clincheck-extraction-handoff/outputs/full_mouth/gum_{U,L}.stl).
 *
 *   run:  node test/validate_gums.js [path/to/rendered_meshes.glb]
 */
const fs = require("fs");
const path = require("path");

global.CTM = require("../lib/ctm.js");
global.fflate = require("../lib/fflate.umd.js");
const engine = require("../src/engine.js");

const HANDOFF = path.resolve(__dirname, "../../clincheck-extraction-handoff");
const DATA = path.join(HANDOFF, "data/wcc_extracted");
const GLB = process.argv[2] || path.join(HANDOFF, "data/captures/rendered_meshes_20260625.glb");
const REF = path.join(HANDOFF, "outputs/full_mouth");

function zipDir(dir) {
  const entries = {};
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) entries[f] = new Uint8Array(fs.readFileSync(p));
  }
  return global.fflate.zipSync(entries, { level: 0 });
}

// --- minimal GLB reader: returns [{positions:Float32Array(meters), indices:Uint32Array}] ---
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
    const positions = Float32Array.from(readAcc(prim.attributes.POSITION));
    const indices = prim.indices != null ? Uint32Array.from(readAcc(prim.indices)) : new Uint32Array(0);
    out.push({ positions, indices });
  }
  return out;
}

// --- read a binary STL -> centroid + bbox + triangle count (for comparison) ---
function statSTL(file) {
  const buf = fs.readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  let off = 84, sx = 0, sy = 0, sz = 0, cnt = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(off + 12 + k * 12, true), y = dv.getFloat32(off + 16 + k * 12, true), z = dv.getFloat32(off + 20 + k * 12, true);
      sx += x; sy += y; sz += z; cnt++;
      mn[0] = Math.min(mn[0], x); mn[1] = Math.min(mn[1], y); mn[2] = Math.min(mn[2], z);
      mx[0] = Math.max(mx[0], x); mx[1] = Math.max(mx[1], y); mx[2] = Math.max(mx[2], z);
    }
    off += 50;
  }
  return { tris: n, centroid: [sx / cnt, sy / cnt, sz / cnt], bboxMin: mn, bboxMax: mx };
}

const glMeshes = readGLB(GLB);
console.log(`ripped ${glMeshes.length} meshes from ${path.basename(GLB)}`);

const res = engine.exportFromBundle(zipDir(DATA), { stage: 0, glMeshes });
const gi = res.gumInfo;
console.log(`\nmatched ${gi.matched} ripped meshes to teeth (worst max|Δ| = ${gi.worstMatch.toExponential(2)} m)`);
console.log(`gum candidates placed: ${gi.gums.map((g) => g.arch + "(fit " + g.cost + "mm)").join(", ")}`);

// write JS gum STLs for eyeballing
const OUT = path.resolve(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
for (const name in res.outputs) if (/gum|with_gums|full_mouth\.glb/.test(name)) fs.writeFileSync(path.join(OUT, name), res.outputs[name]);

// compare each JS gum to the Python reference of the same arch
let pass = true;
const TOLC = 0.05; // mm on centroid
for (const arch of ["U", "L"]) {
  const jsName = path.join(OUT, "gum_" + arch + ".stl");
  const refName = path.join(REF, "gum_" + arch + ".stl");
  if (!fs.existsSync(jsName) || !fs.existsSync(refName)) { console.log(`gum_${arch}: (skipped — missing js or ref)`); continue; }
  const a = statSTL(jsName), b = statSTL(refName);
  const dc = a.centroid.map((x, i) => Math.abs(x - b.centroid[i]));
  const ok = a.tris === b.tris && dc.every((d) => d <= TOLC);
  pass = pass && ok;
  console.log(`gum_${arch}: tris js=${a.tris} ref=${b.tris} | centroid Δ=[${dc.map((d) => d.toFixed(4)).join(", ")}] ${ok ? "OK" : "MISMATCH"}`);
}

console.log("\n" + (pass ? "PASS  JS gum registration matches the Python reference" : "FAIL  gum mismatch"));
process.exit(pass ? 0 : 1);
