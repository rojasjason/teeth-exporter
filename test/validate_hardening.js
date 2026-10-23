/*
 * validate_hardening.js — the v1.0.0 audit fixes in the controller and engine.
 *   - the token list closes after our three hellos; a page script can't register a token,
 *     and prototype names like "toString" don't count as tokens
 *   - a zip that isn't a treatment-plan bundle never replaces a good capture
 *   - "Download captured files" leaves zips (the scan) out
 *   - unzip refuses oversized entries before inflating; CTM headers with absurd map counts fail
 *
 *   run:  node test/validate_hardening.js
 */
const fs = require("fs");
const path = require("path");
global.CTM = require("../lib/ctm.js");
global.fflate = require("../lib/fflate.umd.js");
const engine = require("../src/engine.js");

let pass = true;
function check(name, cond) { console.log((cond ? "  ✓ " : "  ✗ ") + name); pass = pass && cond; }

const DATA = path.resolve(__dirname, "../../clincheck-extraction-handoff/data/wcc_extracted");
function zipDir(dir) {
  const e = {};
  for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isFile()) e[f] = new Uint8Array(fs.readFileSync(p)); }
  return fflate.zipSync(e, { level: 0 });
}
const realZip = zipDir(DATA);
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// ---- engine ----
const bomb = fflate.zipSync({ "big.json": new Uint8Array(80 * 1024 * 1024) }, { level: 9 });   // ~80 KB that inflates to 80 MB
let bombErr = null; try { engine.unzip(bomb); } catch (e) { bombErr = e.message; }
check("unzip refuses an entry that inflates past the cap (" + Math.round(bomb.length / 1024) + " KB zip)", /too large/.test(bombErr || ""));
check("the real bundle still unzips", Object.keys(engine.unzip(realZip)).some((k) => /\.ctm$/.test(k)));

// a stored entry that claims 1 byte but holds 70 MB is caught by the actual-size check
{
  const real = fflate.zipSync({ "big.json": new Uint8Array(70 * 1024 * 1024) }, { level: 0 });
  // patch the sizes in the local header (offset 22) and central directory to claim 1 byte
  const dv = new DataView(real.buffer);
  dv.setUint32(22, 1, true);
  for (let i = real.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x02014b50) { dv.setUint32(i + 24, 1, true); break; }
  let lieErr = null; try { engine.unzip(real); } catch (e) { lieErr = e.message; }
  check("a zip entry that lies about its size is rejected", /too large/.test(lieErr || ""));
}
// a zip with an empty tooth list is not a plan
{
  const empty = fflate.zipSync({ "teeth.json": new TextEncoder().encode("[]"), "jaws.json": new TextEncoder().encode("{}") });
  let e2 = null; try { engine.stageRange(empty); } catch (e) { e2 = e.message; }
  check("a zip with an empty tooth list is not accepted as a plan", /no teeth/.test(e2 || ""));
}

const ctm = new Uint8Array(64);
ctm.set([0x4f, 0x43, 0x54, 0x4d], 0);
new DataView(ctm.buffer).setInt32(12, 1, true); new DataView(ctm.buffer).setInt32(16, 1, true);
new DataView(ctm.buffer).setInt32(20, 10000, true);                     // 10,000 UV maps
let ctmErr = null; try { engine.decodeCTM(ctm); } catch (e) { ctmErr = e.message; }
check("CTM with 10,000 UV maps is rejected before allocating", /map counts/.test(ctmErr || ""));

// ---- controller in a fake window ----
const listeners = [], downloads = [];
global.window = global;
global.location = { origin: "https://viewer.test", href: "https://viewer.test/" };
global.addEventListener = (t, fn) => { if (t === "message") listeners.push(fn); };
global.removeEventListener = () => {};
global.postMessage = () => {};
global.Blob = function (parts) { this.parts = parts; };
global.URL = { createObjectURL: (b) => { downloads.push(b); return "blob:x"; }, revokeObjectURL: () => {} };
global.document = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} }, documentElement: { appendChild() {} } };
const TAG = "CLINCHECK_WCC_CAPTURE";
function send(d) { listeners.slice().forEach((fn) => fn({ source: global, origin: "https://viewer.test", data: Object.assign({ source: TAG }, d) })); }

require("../src/controller.js");
let captures = 0;
const ctl = global.TeethController({ onCapture: () => captures++ });

send({ kind: "hello", token: "tok-capture-1" });
send({ kind: "hello", token: "tok-webgl-002" });
send({ kind: "hello", token: "tok-viewer-03" });
send({ kind: "hello", token: "page-attacker" });                        // 4th hello: page script
send({ kind: "wcc", token: "page-attacker", bytes: ab(realZip), url: "x" });
check("a token registered by a page script after ours is ignored", captures === 0);
send({ kind: "wcc", token: "toString", bytes: ab(realZip), url: "x" });
check("prototype names like 'toString' are not tokens", captures === 0);

// a scan in a layout this version can't read: the panel is told, and the bug-report file list
// carries names (ID-like parts removed) and sizes, never the scan or its URL
const meshBytes = fs.readFileSync(path.join(DATA, fs.readdirSync(DATA).find((f) => /\.ctm$/i.test(f))));
const oddZip = fflate.zipSync({ "case_12345678": { "a.ctm": meshBytes, "b.ctm": meshBytes, "c.ctm": meshBytes }, "layout.json": new TextEncoder().encode("{}") }, { level: 0 });
send({ kind: "wcc", token: "tok-capture-1", bytes: ab(oddZip), url: "https://viewer.test/secret/case_12345678.zip?sig=abc" });
check("an unreadable scan is reported, not dropped", captures === 0 && ctl.status().unreadable === true && !ctl.status().captured);
let listResult = null;
ctl.run("fileList").then((r) => { listResult = r; });

send({ kind: "wcc", token: "tok-capture-1", bytes: ab(realZip), url: "https://viewer.test/treatment_plan_video_wcc" });
check("our own token delivers the real scan", captures === 1 && ctl.status().captured);
check("a readable scan clears the unreadable notice", ctl.status().unreadable === false);

const junk = fflate.zipSync({ "readme.txt": new TextEncoder().encode("not a plan") });
send({ kind: "wcc", token: "tok-capture-1", bytes: ab(junk), url: "https://viewer.test/other.zip" });
check("a later zip that isn't a plan does not replace the scan", captures === 1 && ctl.state.bytes.length === realZip.length);

send({ kind: "viewer-stage", token: "tok-viewer-03", info: { currentStage: "4", firstStage: 0, lastStage: 21 } });
check("a malformed viewer-stage push is ignored", ctl.status().aligner == null);
send({ kind: "viewer-stage", token: "tok-viewer-03", info: { currentStage: 4, firstStage: 0, lastStage: 21 } });
check("a valid viewer-stage push sets aligner 5 / 21", ctl.status().aligner === 5 && ctl.status().total === 21);

send({ kind: "resource", token: "tok-capture-1", url: "https://viewer.test/treatment_plan_video_wcc", size: realZip.length, fmt: "zip", bytes: ab(realZip) });
send({ kind: "resource", token: "tok-capture-1", url: "https://viewer.test/model/mesh.ctm", size: 8, fmt: "ctm", bytes: ab(new Uint8Array([0x4f, 0x43, 0x54, 0x4d, 0, 0, 0, 0])) });
ctl.run("diag").then((r) => {
  const blob = downloads.pop();
  const zip = fflate.unzipSync(blob.parts[0]);
  const names = Object.keys(zip);
  check("captured-files zip leaves the scan out (" + names.join(", ") + ")", r.ok && !names.some((n) => /\.zip$/i.test(n)) && names.includes("mesh.ctm"));
  const t = listResult && listResult.text || "";
  check("file list: names and sizes, ID and URL left out", listResult && listResult.ok && /:id\/a\.ctm\s+\d+/.test(t) && /layout\.json/.test(t) &&
    !/12345678|secret|sig=|viewer\.test\/|treatment_plan/.test(t));
  console.log("\n" + (pass ? "PASS  hardening holds" : "FAIL  hardening"));
  process.exit(pass ? 0 : 1);
});
