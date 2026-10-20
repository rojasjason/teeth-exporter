/*
 * make_beta_package.js — produce a hand-off beta folder (+ zip) for testers.
 *
 * Output: dist/teeth-exporter-beta/  and  dist/teeth-exporter-beta.zip
 *   - teeth-exporter.user.js   the bundle, with @downloadURL/@updateURL stripped (no dead
 *                              auto-update calls while the repo isn't public yet)
 *   - START-HERE.html          a friendly, self-contained install + use guide
 *   - INSTALL.txt              plaintext fallback of the same steps
 *
 *   run:  node build/build_userscript.js && node build/make_beta_package.js
 */
const fs = require("fs");
const path = require("path");
const fflate = require("../lib/fflate.umd.js");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "dist/teeth-exporter.user.js");
if (!fs.existsSync(SRC)) { console.error("build dist/teeth-exporter.user.js first: node build/build_userscript.js"); process.exit(1); }

// beta copy: drop the auto-update lines so a not-yet-live repo URL is never fetched
let script = fs.readFileSync(SRC, "utf8")
  .split("\n").filter((l) => !/^\/\/ @(downloadURL|updateURL)\b/.test(l)).join("\n");

const START_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Teeth Exporter — Beta · Start Here</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0f1419;color:#e6edf3;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:680px;margin:0 auto;padding:32px 22px 64px}
  h1{font-size:24px;margin:0 0 4px} .sub{color:#8b97a3;margin:0 0 26px}
  .tag{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#c9923a;border:1px solid #c9923a;border-radius:4px;padding:1px 6px;vertical-align:middle;margin-left:8px}
  .card{background:#171d24;border:1px solid #283039;border-radius:12px;padding:18px 20px;margin:16px 0}
  .step{display:flex;gap:14px;margin:18px 0}
  .num{flex:none;width:28px;height:28px;border-radius:50%;background:#1f9d72;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:14px}
  .step h3{margin:2px 0 5px;font-size:16px} .step p{margin:0;color:#c4cdd6}
  a{color:#25b886} code{background:#0f1419;border:1px solid #283039;border-radius:5px;padding:1px 6px;font-size:13px}
  .btn{display:inline-block;background:#1f9d72;color:#fff;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:8px;margin-top:6px}
  .muted{color:#8b97a3;font-size:13px} .ok{color:#25b886} ul{margin:6px 0 0;padding-left:20px;color:#c4cdd6}
  hr{border:none;border-top:1px solid #283039;margin:26px 0}
  .warn{font-size:12.5px;color:#8b97a3;border-left:3px solid #c9923a;padding:4px 0 4px 12px;margin:18px 0}
</style></head><body><div class="wrap">
  <h1>Teeth Exporter <span class="tag">beta</span></h1>
  <p class="sub">Download your own teeth <strong>and gums</strong> from your aligner's 3D viewer — one click, all in your browser. Nothing is uploaded.</p>

  <div class="card">
    <div class="step"><div class="num">1</div><div>
      <h3>Install Tampermonkey (free, one click)</h3>
      <p>It's the standard way to run small browser scripts — no "developer mode", no fuss.</p>
      <a class="btn" href="https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo" target="_blank" rel="noopener">Get Tampermonkey — Chrome / Edge / Brave</a>
      <p class="muted" style="margin-top:8px">Firefox: <a href="https://addons.mozilla.org/firefox/addon/tampermonkey/" target="_blank" rel="noopener">addons.mozilla.org</a></p>
    </div></div>

    <div class="step"><div class="num">2</div><div>
      <h3>Add the script</h3>
      <p>Click the Tampermonkey icon → <strong>Dashboard</strong>. Then drag the file
      <code>teeth-exporter.user.js</code> (in this same folder) <strong>onto the dashboard</strong> →
      an <strong>Install</strong> page opens → click <strong>Install</strong>.</p>
      <p class="muted" style="margin-top:8px">That's the reliable way. (If you turned on Tampermonkey's
      "Allow access to file URLs", you can instead just open <code>teeth-exporter.user.js</code> in your browser.)</p>
    </div></div>

    <div class="step"><div class="num">3</div><div>
      <h3>Use it on your plan</h3>
      <p>Open your <strong>Invisalign / ClinCheck 3D viewer</strong> and let your plan load.
      <strong>Slowly orbit the model once</strong> so the pink gums on <strong>both arches</strong> appear.
      A small <strong>Teeth Exporter</strong> panel shows up bottom-right → click
      <strong>Export this aligner</strong>. A <code>.zip</code> of STL + GLB files downloads. Done. <span class="ok">✓</span></p>
    </div></div>
  </div>

  <hr>
  <h3>If something's off</h3>
  <ul>
    <li><strong>No panel?</strong> It only appears once your 3D plan has loaded — give it a moment and rotate the model.</li>
    <li><strong>No gums in the file?</strong> That arch wasn't drawn yet. Orbit so both arches' gums face the camera, then click Export again.</li>
    <li><strong>Want every aligner?</strong> Click "Export every aligner": one folder per aligner, each with its real gums. Keep the tab on screen while it runs.</li>
    <li><strong>Just want teeth?</strong> Every zip has teeth-only files in its <code>Advanced</code> folder.</li>
    <li><strong>Your portal is a different website?</strong> Tell Jason the address — it's a one-line fix.</li>
  </ul>

  <p class="warn">Unofficial. Not affiliated with, authorized by, or endorsed by Align Technology, Invisalign, or ClinCheck.
  Use it only on <strong>your own</strong> treatment plan. Everything runs locally in your browser; nothing is uploaded.
  Exported models are for personal/educational use, not clinical decisions.</p>

  <p class="muted">Found a bug or have feedback? Note which viewer/portal you used and what happened, and send it to Jason — that's the whole point of the beta. 🙏</p>
</div></body></html>
`;

const INSTALL_TXT = `Teeth Exporter (beta) — install in 3 steps
==========================================

1) Install Tampermonkey (free, one click — no "developer mode"):
   Chrome / Edge / Brave:  https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo
   Firefox:                https://addons.mozilla.org/firefox/addon/tampermonkey/

2) Add the script:
   Click the Tampermonkey icon -> Dashboard.
   Drag the file "teeth-exporter.user.js" (in this folder) ONTO the dashboard.
   An Install page opens -> click Install.

3) Use it:
   Open your Invisalign / ClinCheck 3D viewer and let your plan load.
   Slowly orbit the model once so the pink gums on BOTH arches appear.
   A small "Teeth Exporter" panel appears bottom-right -> click "Export this aligner".
   A .zip with STL + GLB files downloads. Done.

Tips
----
- No panel? It appears once your 3D plan has loaded. Give it a moment and rotate the model.
- No gums in the file? Orbit so both arches' gums face the camera, then Export again.
- "Export every aligner" saves one folder per aligner, each with its real gums.
  Keep the tab on screen while it runs.
- Teeth-only files are in each zip's "Advanced" folder.
- Different portal website? Send Jason the address; it's a one-line fix.

Everything runs locally in your browser. Nothing is uploaded.
Unofficial - not affiliated with Align Technology / Invisalign / ClinCheck.
Use only on your own treatment plan. Not for clinical decisions.
`;

const OUTDIR = path.join(ROOT, "dist", "teeth-exporter-beta");
fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, "teeth-exporter.user.js"), script);
fs.writeFileSync(path.join(OUTDIR, "START-HERE.html"), START_HTML);
fs.writeFileSync(path.join(OUTDIR, "INSTALL.txt"), INSTALL_TXT);

// also a single zip to send
const enc = new TextEncoder();
const zip = fflate.zipSync({
  "teeth-exporter-beta/teeth-exporter.user.js": enc.encode(script),
  "teeth-exporter-beta/START-HERE.html": enc.encode(START_HTML),
  "teeth-exporter-beta/INSTALL.txt": enc.encode(INSTALL_TXT)
}, { level: 6 });
fs.writeFileSync(path.join(ROOT, "dist", "teeth-exporter-beta.zip"), zip);

const kb = (n) => Math.round(n / 1024) + " KB";
console.log("beta package ready:");
console.log("  folder:  dist/teeth-exporter-beta/  (teeth-exporter.user.js + START-HERE.html + INSTALL.txt)");
console.log("  zip:     dist/teeth-exporter-beta.zip  (" + kb(zip.length) + ")");
console.log("  script:  " + kb(script.length) + ", update URLs stripped for beta");
