// Firefox end-to-end: real Firefox + the Firefox build (temporary add-on) + a fake viewer on localhost.
// run:  node build/package.js && node test/firefox/run.js   (needs Firefox installed, macOS)
const fs = require("fs"), path = require("path"), http = require("http"), cp = require("child_process");
const REPO = path.resolve(__dirname, "../..");
const HAND = path.resolve(REPO, "../clincheck-extraction-handoff/data");
const T = __dirname, OUT = path.join(require("os").tmpdir(), "teeth-exporter-firefox-test"), EXT = path.join(OUT, "ext"), DL = path.join(OUT, "downloads"), PROF = path.join(OUT, "prof");
global.fflate = require(REPO + "/lib/fflate.umd.js");
fs.mkdirSync(OUT, { recursive: true });
for (const d of [EXT, DL, PROF]) fs.rmSync(d, { recursive: true, force: true });
fs.mkdirSync(DL); fs.mkdirSync(PROF);
// extension copy + test hooks (in the temp folder: macOS blocks Firefox from profiles under ~/Desktop)
fs.cpSync(REPO + "/dist/teeth-exporter-firefox", EXT, { recursive: true });
const man = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json")));
man.host_permissions.push("http://localhost/*");
man.content_scripts.forEach((c) => c.matches.push("http://localhost/*"));
man.content_scripts[1].js.push("bridge.js");
fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(man, null, 2));
fs.copyFileSync(path.join(T, "bridge.js"), path.join(EXT, "bridge.js"));
fs.appendFileSync(path.join(EXT, "src/background.js"), fs.readFileSync(path.join(T, "bg_test.js")));
// fixtures
const ent = {}; const W = path.join(HAND, "wcc_extracted");
for (const f of fs.readdirSync(W)) if (fs.statSync(path.join(W, f)).isFile()) ent[f] = new Uint8Array(fs.readFileSync(path.join(W, f)));
const ZIP = Buffer.from(fflate.zipSync(ent, { level: 0 }));
const GLB = fs.readFileSync(path.join(HAND, "captures/rendered_meshes_20260625.glb"));
const srv = http.createServer((q, s) => {
  if (q.url.startsWith("/treatment_plan_video_wcc")) { s.writeHead(200, { "content-type": "application/octet-stream" }); return s.end(ZIP); }
  if (q.url === "/meshes.glb") { s.writeHead(200, { "content-type": "model/gltf-binary" }); return s.end(GLB); }
  s.writeHead(200, { "content-type": "text/html" }); s.end(fs.readFileSync(path.join(T, "site/index.html")));
}).listen(8723);
fs.writeFileSync(path.join(PROF, "user.js"), [
  ['browser.download.dir', DL], ['browser.download.folderList', 2], ['browser.download.useDownloadDir', true],
  ['browser.download.always_ask_before_handling_new_types', false], ['browser.download.start_downloads_in_tmp_dir', false],
  ['browser.helperApps.neverAsk.saveToDisk', 'application/zip,application/octet-stream'], ['browser.download.panel.shown', true],
  ['webgl.force-enabled', true], ['extensions.manifestV3.enabled', true], ['browser.shell.checkDefaultBrowser', false]
].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
cp.execFileSync("open", ["-na", "Firefox", "--args", "-headless", "--remote-debugging-port", "9335", "-profile", PROF, "-no-remote"]);
const ff = { kill() { try { cp.execSync("pkill -f " + JSON.stringify(PROF)); } catch (e) {} } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pend = {};
function bidi(method, params) { return new Promise((res, rej) => { const i = ++id; pend[i] = { res, rej }; ws.send(JSON.stringify({ id: i, method, params })); }); }
const results = []; function check(n, c, extra) { results.push(c); console.log((c ? "  ✓ " : "  ✗ ") + n + (extra ? "  " + extra : "")); }
(async () => {
  for (let i = 0; i < 40; i++) { try { ws = new WebSocket("ws://127.0.0.1:9335/session"); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); break; } catch (e) { await sleep(500); } }
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { d.type === "error" ? pend[d.id].rej(new Error(d.error + ": " + d.message)) : pend[d.id].res(d.result); } };
  await bidi("session.new", { capabilities: {} });
  const inst = await bidi("webExtension.install", { extensionData: { type: "path", path: EXT } });
  check("Firefox installs the extension", !!inst.extension, inst.extension);
  const tree = await bidi("browsingContext.getTree", {}); const ctx = tree.contexts[0].context;
  await bidi("browsingContext.navigate", { context: ctx, url: "http://localhost:8723/", wait: "complete" });
  const ev = async (expr) => (await bidi("script.evaluate", { expression: expr, target: { context: ctx }, awaitPromise: true })).result.value;
  let title; for (let i = 0; i < 40; i++) { title = await ev("document.title"); if (/READY|ERR|NO-WEBGL/.test(title)) break; await sleep(250); }
  check("fake viewer draws with WebGL2", /READY/.test(title), title);
  let n = 0;
  async function run(cmd, name, args, ms) {
    const k = ++n; await ev(`document.documentElement.setAttribute("data-te-cmd", ${JSON.stringify(JSON.stringify({ id: k, cmd, name, args }))}), 1`);
    for (let i = 0; i < (ms || 20000) / 250; i++) { const v = await ev(`document.documentElement.getAttribute("data-te-result-${k}")`); if (v) return JSON.parse(v); await sleep(250); }
    return { timeout: true };
  }
  await sleep(2500);
  const st = await run("status");
  check("scan captured (status)", st && st.captured, JSON.stringify(st).slice(0, 200));
  async function waitDl(before, ms) { for (let i = 0; i < ms / 250; i++) { const f = fs.readdirSync(DL).filter((x) => !/\.part$/.test(x)); if (f.length > before) return f; await sleep(250); } return fs.readdirSync(DL); }
  function zipOf(f) { return Object.keys(fflate.unzipSync(new Uint8Array(fs.readFileSync(path.join(DL, f))))); }
  let r = await run("run", "fullMouth", {}); let files = await waitDl(0, 8000);
  check("Export this aligner", r && r.ok, JSON.stringify(r).slice(0, 220));
  let z = files[0] ? zipOf(files[files.length - 1]) : [];
  check("  zip downloaded with gums", z.includes("upper_with_gums.stl") && z.includes("lower_with_gums.stl"), files.join(",") + " | " + z.join(" "));
  r = await run("run", "fullMouth", { override: 5 }); files = await waitDl(1, 10000);
  check("Export aligner 5 (typed in Advanced)", r && r.ok && r.aligner === 5, JSON.stringify(r).slice(0, 200));
  r = await run("run", "allStages", {}, 90000); files = await waitDl(2, 15000);
  check("Export every aligner", r && r.ok, JSON.stringify(r).slice(0, 220));
  const all = (files||[]).find((f) => /all|every|stages/i.test(f)) || files[files.length - 1];
  z = zipOf(all); check("  every-aligner zip", z.filter((x) => /upper_with_gums\.stl$/.test(x)).length === 6, all + " | " + z.filter((x) => /upper_with/.test(x)).join(" "));
  r = await run("run", "raw", {}); await waitDl(3, 8000); check("Download raw scan", r && r.ok);
  r = await run("run", "diag", {}); await waitDl(4, 8000); check("Download captured files", r && r.ok);
  r = await run("run", "glCapture", {}); await waitDl(5, 8000); check("Download rendered 3D", r && r.ok);
  console.log("downloads:", fs.readdirSync(DL).join(", "));
  console.log(results.every(Boolean) ? "\nPASS  Firefox" : "\nFAIL  Firefox");
})().catch((e) => console.log("HARNESS ERROR", e.message)).finally(() => { try { ff.kill(); } catch (e) {} srv.close(); setTimeout(() => process.exit(0), 300); });
