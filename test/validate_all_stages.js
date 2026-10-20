/*
 * validate_all_stages.js — run all_stages.js end to end against a FAKE viewer + ripper.
 * The fake viewer reports its own stage range (firstStage..lastStage), so this also proves nothing
 * assumes a step count. Each stage's "rip" is the real July capture. Checks: one folder per stage,
 * the everyday files at the top of each folder, the rest under Advanced/, README + manifest, the
 * viewer stepped through every stage and was put back where the user had it.
 *
 *   run:  node test/validate_all_stages.js
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


let pass = true;
function check(name, cond) { console.log((cond ? "  \u2713 " : "  \u2717 ") + name); pass = pass && cond; }

const TAG = "CLINCHECK_WCC_CAPTURE", TOKEN = "tok";
const ripped = readGLB(GLB).map((m) => ({ positions: m.positions, indices: m.indices, meta: { mode: 4 } }));

// ---- a fake window: message bus + fake viewer_bridge + fake webgl ripper ----
const listeners = [];
global.window = global;
global.addEventListener = (t, fn) => { if (t === "message") listeners.push(fn); };
global.removeEventListener = (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
function deliver(data) { setTimeout(() => listeners.slice().forEach((fn) => fn({ source: global, data })), 1); }

function runFake(firstStage, lastStage, startAt, isCancelled) {
  const viewer = { currentStage: startAt, firstStage, lastStage }, visited = [];
  let epoch = 0;
  global.postMessage = (d) => {
    if (!d || d.source !== TAG) return;
    const reply = (o) => deliver(Object.assign({ source: TAG, token: TOKEN, reqId: d.reqId }, o));
    if (d.kind === "viewer-request") {
      if (d.op === "setStage") { viewer.currentStage = d.stage; visited.push(d.stage); }
      reply({ kind: "viewer-reply", ok: true, info: Object.assign({}, viewer) });
    } else if (d.kind === "gl-mark") reply({ kind: "gl-mark-ack", epoch: ++epoch });
    else if (d.kind === "gl-stats-request") reply({ kind: "gl-stats", recent: ripped.length });
    else if (d.kind === "gl-snapshot-request") reply({ kind: "gl-snapshot", meshes: ripped });
  };
  delete require.cache[require.resolve("../src/all_stages.js")];
  require("../src/all_stages.js");
  return global.TeethAllStages({
    tag: TAG, origin: "*", tokens: { [TOKEN]: true }, engine, fflate: global.fflate, bytes: zipDir(DATA), isCancelled
  }).then((res) => ({ res, viewer, visited }), (err) => ({ err, viewer, visited }));
}

(async () => {
  // a short plan: data stages 0..3, so the slider shows aligners 1..3 (stages 0..2); user on stage 2
  const { res, viewer, visited } = await runFake(0, 3, 2);
  const zip = global.fflate.unzipSync(new Uint8Array(Buffer.concat(res.chunks.map((c) => Buffer.from(c)))));
  const names = Object.keys(zip);
  const dirs = new Set(names.filter((n) => n.startsWith("stage_")).map((n) => n.split("/")[0]));
  check("3 aligner folders stage_01..stage_03 for a 0..3 plan (matches the slider)",
    dirs.size === 3 && res.stageCount === 3 && dirs.has("stage_01") && dirs.has("stage_03") && !dirs.has("stage_00"));
  const top = names.filter((n) => /^stage_02\/[^/]+$/.test(n)).map((n) => n.split("/")[1]).sort();
  check("top of stage_02 = full mouth / upper / lower with gums + GLB",
    JSON.stringify(top) === JSON.stringify(["full_mouth.glb", "full_mouth_with_gums.stl", "lower_with_gums.stl", "upper_with_gums.stl"]));
  const adv = names.filter((n) => n.startsWith("stage_02/Advanced/")).map((n) => n.split("/")[2]).sort();
  check("Advanced/ holds teeth-only, gums-only and per-arch files",
    ["full_mouth_teeth.stl", "full_mouth_gums.stl", "upper_teeth.stl", "lower_teeth.stl", "gum_U.stl", "gum_L.stl"].every((f) => adv.includes(f)));
  check("README.txt + manifest.json at the zip root", !!zip["README.txt"] && !!zip["manifest.json"]);
  check("both gums found on every stage", res.missing.length === 0);
  check("viewer visited stages 0..2 (never the hidden last stage), then went back to stage 2",
    [0, 1, 2].every((s) => visited.includes(s)) && !visited.includes(3) && viewer.currentStage === 2 && res.restored);
  const man = JSON.parse(new TextDecoder().decode(zip["manifest.json"]));
  check("manifest maps aligner 1 -> stage 0", man.stages[0].aligner === 1 && man.stages[0].stage === 0);

  // a longer plan than the fixture's 21 keyframes still works (engine holds the last pose)
  const long = await runFake(0, 25, 0);
  check("0..25 plan -> 25 aligner folders", long.res.stageCount === 25);

  // Cancel: stop after aligner 2 of a 0..10 plan; the viewer must go back to where the user was
  let seen = 0;
  const can = await runFake(0, 10, 4, () => ++seen > 2);
  check("cancel stops early with 'Export cancelled.' and puts the viewer back on stage 4",
    can.err && /cancelled/i.test(can.err.message) && can.viewer.currentStage === 4 && !can.visited.includes(5));

  console.log("\n" + (pass ? "PASS  every-stage export with real gums" : "FAIL  every-stage export"));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
