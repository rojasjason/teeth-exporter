/*
 * validate_webgl_capture.js — drive src/webgl_capture.js with a fake WebGL context.
 * Covers the 2026-07-19 audit fixes in the ripper:
 *   F5  two gums that differ only in a small contiguous region are BOTH kept (full hash)
 *   F7  a viewer reusing one scratch ArrayBuffer can't make mesh A carry mesh B's bytes
 *   F1  a draw whose indices point past its vertices is dropped, not exported as garbage
 *   F4  that bad draw does not wipe the good meshes
 *   F8  drawRangeElements is hooked
 *   F9  the snapshot reply echoes the request id
 *
 *   run:  node test/validate_webgl_capture.js
 */
let pass = true;
function check(name, cond) { console.log((cond ? "  ✓ " : "  ✗ ") + name); pass = pass && cond; }

// ---- minimal browser + WebGL fakes ----
const listeners = [], posted = [];
global.window = global;
global.location = { origin: "http://viewer.test" };
global.addEventListener = (t, fn) => { if (t === "message") listeners.push(fn); };
global.postMessage = (data) => { posted.push(data); };
function dispatch(data) { listeners.forEach((fn) => fn({ source: global, data: data })); }

function FakeGL() {}
FakeGL.prototype = {
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
  createBuffer() { return {}; }, bindBuffer() {}, bufferData() {}, bufferSubData() {},
  vertexAttribPointer() {}, enableVertexAttribArray() {}, disableVertexAttribArray() {},
  useProgram() {}, bindVertexArray() {}, uniform4f() {}, uniform4fv() {},
  drawElements() {}, drawArrays() {}, drawRangeElements() {}, getExtension() { return null; }, deleteBuffer() {}
};
global.HTMLCanvasElement = function () {};
global.HTMLCanvasElement.prototype.getContext = function () { return new FakeGL(); };

require("../src/webgl_capture.js");
const gl = new global.HTMLCanvasElement().getContext("webgl2");
const TRI = 4, FLOAT = 0x1406, U16 = 0x1403;

// a "gum": n verts on a grid, triangle indices
function gumVerts(n, bump) {
  const v = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { v[3 * i] = i * 0.001; v[3 * i + 1] = Math.sin(i) * 0.01; v[3 * i + 2] = 0; }
  if (bump) for (let i = 150; i < 200; i++) v[3 * i + 2] += 0.0001;   // 50 verts moved: a small contiguous change between sample points
  return v;
}
function tris(n) { const idx = new Uint16Array((n - 2) * 3); for (let i = 0; i < n - 2; i++) idx.set([i, i + 1, i + 2], 3 * i); return idx; }
const prog = {};
function draw(verts, idx, opts) {
  opts = opts || {};
  const vb = gl.createBuffer(), ib = gl.createBuffer();
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, opts.rawAB ? verts.buffer : verts);
  gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx);
  if (opts.range) gl.drawRangeElements(TRI, 0, verts.length / 3 - 1, idx.length, U16, 0);
  else gl.drawElements(TRI, idx.length, U16, 0);
}

const N = 5076;
draw(gumVerts(N, false), tris(N));                 // gum A
draw(gumVerts(N, true), tris(N));                  // gum B: same template, 200 verts nudged

// F7: one scratch ArrayBuffer reused to upload two different meshes before either is drawn
const scratch = new Float32Array(600 * 3);
const vbA = gl.createBuffer(), vbB = gl.createBuffer(), ibS = gl.createBuffer();
scratch.fill(1); gl.bindBuffer(gl.ARRAY_BUFFER, vbA); gl.bufferData(gl.ARRAY_BUFFER, scratch.buffer);
scratch.fill(2); gl.bindBuffer(gl.ARRAY_BUFFER, vbB); gl.bufferData(gl.ARRAY_BUFFER, scratch.buffer);
gl.bindBuffer(gl.ARRAY_BUFFER, vbA);
gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibS); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris(600));
gl.drawElements(TRI, (600 - 2) * 3, U16, 0);                 // draws mesh A

// F1/F4: indices past the vertex count
const bad = tris(50); bad[3] = 9999;
draw(gumVerts(50, false), bad);

// F8: drawRangeElements
draw(gumVerts(700, false), tris(700), { range: true });

dispatch({ source: "CLINCHECK_WCC_CAPTURE", kind: "gl-snapshot-request", reqId: 42 });
const reply = posted.filter((m) => m.kind === "gl-snapshot").pop();
const meshes = (reply && reply.meshes) || [];

check("snapshot replied and echoed request id 42", reply && reply.reqId === 42);
const gums = meshes.filter((m) => m.positions.length / 3 === N);
check("both same-template gums kept (small contiguous change detected)", gums.length === 2);
const scratchMesh = meshes.find((m) => m.positions.length / 3 === 600);
check("scratch-buffer mesh kept its own bytes (1s, not the later 2s)", scratchMesh && scratchMesh.positions[0] === 1);
check("draw with out-of-range indices dropped", !meshes.some((m) => m.positions.length / 3 === 50));
check("good meshes survive the bad draw", gums.length === 2 && !!scratchMesh);
check("drawRangeElements draw captured", meshes.some((m) => m.positions.length / 3 === 700));
check("budget flag reported and false", reply && reply.summary && reply.summary.budgetExceeded === false);

// audit fixes
// (a) same vertices, new triangle order -> a new draw (connectivity isn't stale)
const tv = gumVerts(400, false);
const iA = tris(400), iB = tris(400).reverse();
draw(tv, iA); draw(tv, iB);
// (b) interleaved positions at offset 12 in a 24-byte stride: all 3 vertices count
const inter = new Float32Array(6 * 3);                              // 3 records x (3 pad floats + xyz)
for (let v = 0; v < 3; v++) inter.set([9, 9, 9, v, v * 2, 0.5], v * 6);
{ const vb = gl.createBuffer(), ib = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, inter);   // 72 bytes: the 3rd xyz ends exactly at the buffer end
  gl.vertexAttribPointer(0, 3, FLOAT, false, 24, 12); gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2]));
  gl.drawElements(TRI, 3, U16, 0); }
// (c) element upload after switching VAOs lands in the bound VAO's index buffer
const vaoA = {}, vaoB = {};
{ const vb = gl.createBuffer(), ibA = gl.createBuffer(), ibB = gl.createBuffer();
  gl.bindVertexArray(vaoA); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, gumVerts(300, false));
  gl.vertexAttribPointer(0, 3, FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibA); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2]));
  gl.bindVertexArray(vaoB); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibB); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([5, 6, 7]));
  gl.bindVertexArray(vaoA); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([7, 8, 9]));    // updates A's indices
  gl.drawElements(TRI, 3, U16, 0); gl.bindVertexArray(null); }

dispatch({ source: "CLINCHECK_WCC_CAPTURE", kind: "gl-snapshot-request", reqId: 44 });
const r3 = posted.filter((m) => m.kind === "gl-snapshot" && m.reqId === 44).pop();
const m3 = (r3 && r3.meshes) || [];
check("same vertices with new triangle order are kept as two draws", m3.filter((m) => m.positions.length / 3 === 400).length === 2);
check("interleaved positions with an offset keep all 3 vertices", m3.some((m) => m.positions.length === 9 && m.positions[6] === 2 && m.positions[7] === 4));
check("an index upload after a VAO switch updates the bound VAO", m3.some((m) => m.indices.length === 3 && m.indices[0] === 7 && m.indices[2] === 9));

// latestFrame: after a pause, only the draws of the newest frame come back
setTimeout(() => {
  draw(gumVerts(900, false), tris(900));                 // the "current frame"
  dispatch({ source: "CLINCHECK_WCC_CAPTURE", kind: "gl-snapshot-request", reqId: 43, latestFrame: true });
  const r2 = posted.filter((m) => m.kind === "gl-snapshot" && m.reqId === 43).pop();
  const counts = ((r2 && r2.meshes) || []).map((m) => m.positions.length / 3);
  check("latestFrame returns only the newest frame's draw", counts.length === 1 && counts[0] === 900);
  // a second canvas drawing later must not push the first canvas's current frame out
  setTimeout(() => {
    const gl2 = new global.HTMLCanvasElement().getContext("webgl2");
    const vb = gl2.createBuffer(), ib = gl2.createBuffer();
    gl2.useProgram({}); gl2.bindBuffer(gl2.ARRAY_BUFFER, vb); gl2.bufferData(gl2.ARRAY_BUFFER, gumVerts(30, false));
    gl2.vertexAttribPointer(0, 3, FLOAT, false, 0, 0); gl2.enableVertexAttribArray(0);
    gl2.bindBuffer(gl2.ELEMENT_ARRAY_BUFFER, ib); gl2.bufferData(gl2.ELEMENT_ARRAY_BUFFER, tris(30)); gl2.drawElements(TRI, 84, U16, 0);
    dispatch({ source: "CLINCHECK_WCC_CAPTURE", kind: "gl-snapshot-request", reqId: 45, latestFrame: true });
    const r5 = posted.filter((m) => m.kind === "gl-snapshot" && m.reqId === 45).pop();
    const c5 = ((r5 && r5.meshes) || []).map((m) => m.positions.length / 3).sort((x, y) => x - y);
    check("a second canvas drawing later keeps each canvas's own latest frame", JSON.stringify(c5) === "[30,900]");
    console.log("\n" + (pass ? "PASS  webgl ripper keeps the right meshes" : "FAIL  webgl ripper"));
    process.exit(pass ? 0 : 1);
  }, 400);
  return;
  console.log("\n" + (pass ? "PASS  webgl ripper keeps the right meshes" : "FAIL  webgl ripper"));
  process.exit(pass ? 0 : 1);
}, 400);
