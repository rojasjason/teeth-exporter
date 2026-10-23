/*
 * validate_scene_layout.js — the share.invisalign "Outcome Simulation" bundle layout.
 *
 * That viewer ships scene.json (JawPair > Upper/Lower Jaw > Tooth_NN nodes) + Tooth_NN.ctm and
 * carries its gums as GingivaMorph nodes, instead of teeth.json + jaws.json. No such scan is kept
 * in this repo, so this test REWRITES the plan fixture into the scene layout (same meshes, same
 * motion, an equivalent jaw chain) and checks both layouts export the same seated teeth at the
 * first and last stage, and that bundle gums are seated with the teeth's chain.
 *
 * Optional: SIM_BUNDLE=/path/to/a/real/simulation.zip also runs a real one (kept out of the repo)
 * and checks every exported vertex is in a sane range (the MG2 signed-delta decoder fix).
 *
 *   run:  node test/validate_scene_layout.js
 */
const fs = require("fs");
const path = require("path");

global.CTM = require("../lib/ctm.js");
global.fflate = require("../lib/fflate.umd.js");
const engine = require("../src/engine.js");

const DATA = path.resolve(__dirname, "../../clincheck-extraction-handoff/data/wcc_extracted");
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
let failed = 0;
function check(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed++; }

// ---- the plan fixture, as the my.invisalign viewer delivers it ----
const planFiles = {};
for (const f of fs.readdirSync(DATA)) {
  const p = path.join(DATA, f);
  if (fs.statSync(p).isFile()) planFiles[f] = new Uint8Array(fs.readFileSync(p));
}
const planZip = fflate.zipSync(planFiles, { level: 0 });
const jp = JSON.parse(new TextDecoder().decode(planFiles["jaws.json"]))[0];
const teethMeta = JSON.parse(new TextDecoder().decode(planFiles["teeth.json"]));

// ---- rewrite it into the scene layout ----
// plan:  w = Rg(Rj(p - b) + b + t - rc) + rc + gp      scene:  w = Rg'(Rj' p + t') + gp'
// so     Rj' = Rj,  t' = b + t - Rj b - rc,  Rg' = Rg,  gp' = rc + gp
function q2m(q) {
  let [x, y, z, w] = q; const n = Math.hypot(x, y, z, w) || 1; x /= n; y /= n; z /= n; w /= n;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
          2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
          2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function jawNode(name, J) {
  const R = q2m(J.motion["0"].rotation), b = J.basis, t = J.motion["0"].position, rc = jp.rotationCenter;
  const Rb = [R[0] * b[0] + R[1] * b[1] + R[2] * b[2], R[3] * b[0] + R[4] * b[1] + R[5] * b[2], R[6] * b[0] + R[7] * b[1] + R[8] * b[2]];
  return { name, parent: "JawPair", rotation: J.motion["0"].rotation,
    position: [0, 1, 2].map((i) => b[i] + t[i] - Rb[i] - rc[i]) };
}
const objs = [
  { name: "JawPair", rotation: jp.rotation, position: [0, 1, 2].map((i) => jp.rotationCenter[i] + jp.position[i]) },
  jawNode("Upper Jaw", jp.upper),
  jawNode("Lower Jaw", jp.lower)
];
const sceneFiles = {}, toothNumbers = {}, used = {};
let upperMesh = null, lowerMesh = null;
for (const t of teethMeta) {
  const src = planFiles["Tooth-" + t.id + ".ctm"];
  const uns = t.dentalTypeID != null ? t.dentalTypeID : t.number;
  if (!src || used[uns]) continue;
  used[uns] = true;
  const name = "Tooth_" + String(uns).padStart(2, "0");
  const position = {}, rotation = { key: { shape: "slerp" } };
  for (const k in t.motion) {
    const m = t.motion[k];
    position[k] = { x: m.position[0], y: m.position[1], z: m.position[2] };
    rotation[k] = { quaternion: m.rotation };
  }
  const jaw = uns <= 16 ? "Upper Jaw" : "Lower Jaw";
  objs.push({ name, parent: jaw, mesh: name + ".ctm", basis: t.basis, motion: { position, rotation } });
  objs.push({ name: "Lat_" + uns, parent: name, frames: [0], vert: 0 });     // a non-mesh child node, as in real files
  sceneFiles[name + ".ctm"] = src;
  toothNumbers[String(uns)] = { dentalTypeID: uns, parent: name, toothId: uns };
  if (jaw === "Upper Jaw" && !upperMesh) upperMesh = name + ".ctm";
  if (jaw === "Lower Jaw" && !lowerMesh) lowerMesh = name + ".ctm";
}
// stand-in gums: one tooth mesh per arch as the morph target, keyed at stage 0
for (const [jaw, mesh] of [["Upper Jaw", upperMesh], ["Lower Jaw", lowerMesh]]) {
  const gname = "Gingiva" + jaw + "_0.ctm";
  sceneFiles[gname] = sceneFiles[mesh];
  objs.push({ name: "GingivaMorph" + jaw + "0", parent: jaw, mesh: gname, morphTargets: [gname],
    motion: { morph: { "0": { morphTarget: 0 } } }, visibility: [0, -1] });
}
function zipScene(objList, tn, extra) {
  const f = Object.assign({}, sceneFiles, extra || {});
  f["scene.json"] = enc({ rotationCenter: { x: 0, y: 0, z: 0 }, sceneObjects: objList, version: 23 });
  f["toothNumbers.json"] = enc(tn);
  return fflate.zipSync(f, { level: 0 });
}
const sceneZip = zipScene(objs, toothNumbers);

// ---- compare ----
const rPlan = engine.stageRange(planZip), rScene = engine.stageRange(sceneZip);
check(rScene.layout === "scene" && rPlan.layout === "plan", "layout detected (plan / scene)");
check(rScene.max === rPlan.max && rScene.upper === rPlan.upper && rScene.lower === rPlan.lower, "same stage range (max " + rScene.max + ")");
check(rScene.bundleGums === true && rPlan.bundleGums === false, "bundle gums flagged only for the scene layout");

const TOL = 1e-4;   // mm
const close = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= TOL);
for (const stage of [0, rPlan.max]) {
  const a = engine.exportFromBundle(planZip, { stage, glb: false }).stats;
  const b = engine.exportFromBundle(sceneZip, { stage, glb: false }).stats;
  check(a.teeth === b.teeth && a.vertices === b.vertices && a.faces === b.faces,
    `stage ${stage}: same tooth count / vertices / faces (${b.teeth} / ${b.vertices} / ${b.faces})`);
  check(close(a.bboxMin, b.bboxMin) && close(a.bboxMax, b.bboxMax) && close(a.centroid, b.centroid),
    `stage ${stage}: same seated bbox + centroid within ${TOL} mm`);
}

// bundle gums: seated with the jaw chain only (no tooth motion), so each must equal its source
// mesh seated by the plan's own seater
const res = engine.exportFromBundle(sceneZip, { stage: 0, glb: true });
const gums = (res.gumInfo && res.gumInfo.gums) || [];
check(gums.length === 2 && res.gumInfo.source === "bundle", "both bundle gums exported");
check(["full_mouth_with_gums.stl", "upper_with_gums.stl", "lower_with_gums.stl", "gum_U.stl", "gum_L.stl", "full_mouth.glb"].every((n) => res.outputs[n]),
  "with-gums STL set + colored GLB present");
const planSeated = engine.buildSeatedTeeth(engine.unzip(planZip), 0);
for (const g of gums) {
  const raw = engine.decodeCTM(sceneFiles[g.arch === "U" ? upperMesh : lowerMesh]).vertices;
  let worst = 0;
  for (let i = 0; i < raw.length; i += 3) {
    const w = planSeated.seater.seat([raw[i], raw[i + 1], raw[i + 2]], g.arch);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(w[k] - g.verts[i + k]));
  }
  check(worst <= TOL, `gum_${g.arch} seated with the jaw chain (max |d| ${worst.toExponential(2)} mm)`);
}

const all = engine.exportAllStages(sceneZip);
check(all.stageCount === rPlan.max + 1 && Object.keys(all.outputs).some((k) => /with_gums\.stl$/.test(k)),
  `every-stage export from the file: ${all.stageCount} stages, gums in each`);

// ---- case types of the older viewer (all synthetic, built from the same fixture) ----
const clone = (o) => JSON.parse(JSON.stringify(o));
const toothNodes = objs.filter((o) => /^Tooth_\d+$/.test(o.name));
const upperTooth = toothNodes.find((o) => o.parent === "Upper Jaw"), lowerTooth = toothNodes.find((o) => o.parent === "Lower Jaw");
const otherMesh = toothNodes.find((o) => o !== upperTooth && o.parent === "Upper Jaw").mesh;
const baseStats = (stage) => engine.exportFromBundle(sceneZip, { stage, glb: false }).stats;
const statsOf = (zip, stage) => engine.exportFromBundle(zip, { stage, glb: false });
const sameStats = (a, b) => a.teeth === b.teeth && a.vertices === b.vertices && close(a.bboxMin, b.bboxMin) && close(a.bboxMax, b.bboxMax) && close(a.centroid, b.centroid);
const MID = Math.max(1, rPlan.max >> 1);

// teen: the tooth's mesh moves onto children; the viewer shows TeenVirtual, not TeenReal or CBCT
{
  const o2 = clone(objs), t = o2.find((o) => o.name === upperTooth.name), mesh = t.mesh;
  delete t.mesh;
  o2.push({ name: "TeenReal_" + t.name, parent: t.name, mesh: otherMesh });
  o2.push({ name: "CBCT_" + t.name, parent: t.name, mesh: otherMesh });
  o2.push({ name: "TeenVirtual_" + t.name, parent: t.name, mesh, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
  check(sameStats(statsOf(zipScene(o2, toothNumbers), rPlan.max).stats, baseStats(rPlan.max)), "teen tooth: TeenVirtual child used, TeenReal and CBCT skipped");
}
// a tooth shown only on some steps (an extraction): [0, MID) visible, gone from MID on
{
  const o2 = clone(objs);
  o2.find((o) => o.name === lowerTooth.name).visibility = [0, MID];
  const z = zipScene(o2, toothNumbers);
  check(statsOf(z, 0).stats.teeth === 28 && statsOf(z, MID).stats.teeth === 27 && statsOf(z, rPlan.max).stats.teeth === 27,
    `tooth with visibility [0, ${MID}]: 28 teeth before step ${MID}, 27 from it on`);
}
// an ExtractedTooth node with its own mesh, numbered through toothNumbers.extractedTooth
{
  const o2 = clone(objs), tn = clone(toothNumbers);
  o2.push({ name: "ExtractedTooth_x", parent: "Lower Jaw", mesh: lowerTooth.mesh, basis: [0, 0, 0], motion: {}, visibility: [0, MID] });
  tn["99"] = { dentalTypeID: 30, parent: "Pontic_x", extractedTooth: "ExtractedTooth_x" };
  const z = zipScene(o2, tn), r0 = statsOf(z, 0);
  check(r0.stats.teeth === 29 && r0.manifest.some((m) => m.id === "ExtractedTooth_x" && m.uns === 30 && m.arch === "L") && statsOf(z, MID).stats.teeth === 28,
    "extracted tooth: exported while visible, UNS from toothNumbers, gone after");
}
// two gum nodes for one jaw, each for a range of steps, plus a teen gum that wins when present
{
  const o2 = clone(objs).filter((o) => o.name !== "GingivaMorphUpper Jaw0");
  o2.push({ name: "GingivaMorphUpper Jaw0", parent: "Upper Jaw", mesh: "GA.ctm", morphTargets: ["GA.ctm"], motion: { morph: { "0": { morphTarget: 0 } } }, visibility: [0, MID] });
  o2.push({ name: "GingivaMorphUpper Jaw1", parent: "Upper Jaw", mesh: "GB.ctm", morphTargets: ["GB.ctm"], motion: { morph: { "0": { morphTarget: 0 } } }, visibility: [MID, -1] });
  const extra = { "GA.ctm": sceneFiles[upperTooth.mesh], "GB.ctm": sceneFiles[otherMesh] };
  const gumU = (zip, s) => statsOf(zip, s).gumInfo.gums.find((g) => g.arch === "U");
  const nA = engine.decodeCTM(extra["GA.ctm"]).vertices.length / 3, nB = engine.decodeCTM(extra["GB.ctm"]).vertices.length / 3;
  const z = zipScene(o2, toothNumbers, extra);
  check(gumU(z, 0).verts.length / 3 === nA && gumU(z, MID).verts.length / 3 === nB, "split upper gum: the node in range is used at each step");
  o2.push({ name: "TeenGingivaMorphUpper Jaw0", parent: "Upper Jaw", mesh: "GB.ctm", morphTargets: ["GB.ctm"], motion: { morph: { "0": { morphTarget: 0 } } } });
  const zt = zipScene(o2, toothNumbers, extra);
  check(gumU(zt, 0).verts.length / 3 === nB, "teen gum present: used instead of the regular gum");
}

// a zip of meshes in a layout nobody reads: the engine refuses it, and its file list is readable
{
  const odd = fflate.zipSync({ "a.ctm": sceneFiles[upperTooth.mesh], "b.ctm": sceneFiles[otherMesh], "c.ctm": sceneFiles[otherMesh], "layout.json": enc({}) }, { level: 0 });
  let threw = false; try { engine.stageRange(odd); } catch (e) { threw = true; }
  const list = engine.listZip(odd);
  check(threw && list.length === 4 && list.every((f) => typeof f.name === "string" && f.size > 0), "unknown layout: refused, file list readable without unpacking");
}

// ---- optional: a real simulation bundle kept outside the repo ----
if (process.env.SIM_BUNDLE) {
  const zip = new Uint8Array(fs.readFileSync(process.env.SIM_BUNDLE));
  const r = engine.stageRange(zip);
  for (let s = 0; s <= r.max; s++) {
    const e = engine.exportFromBundle(zip, { stage: s, glb: false });
    let far = 0;
    for (const g of e.gumInfo.gums) for (let i = 0; i < g.verts.length; i++) if (Math.abs(g.verts[i]) > 200) far++;
    check(e.gumInfo.gums.length === 2 && far === 0, `real bundle stage ${s}: ${e.stats.teeth} teeth, 2 gums, no stray vertices`);
  }
} else {
  console.log("skip real-bundle check (set SIM_BUNDLE to run it)");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
