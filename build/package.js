/*
 * package.js: builds the two release downloads from this folder.
 *   dist/teeth-exporter-chrome-edge-brave.zip   Chrome, Edge, Brave (manifest.json as is)
 *   dist/teeth-exporter-firefox.zip       Firefox 128+ (background script + gecko settings)
 * The code is the same in both; only the manifest differs.
 *
 *   run:  node build/package.js
 */
const fs = require("fs");
const path = require("path");
const fflate = require("../lib/fflate.umd.js");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const INCLUDE = ["manifest.json", "LICENSE", "README.md", "THIRD_PARTY.md", "icons", "lib", "src"];

function collect(rel, out) {
  const p = path.join(ROOT, rel);
  if (fs.statSync(p).isDirectory()) { for (const f of fs.readdirSync(p)) if (f !== ".DS_Store") collect(path.posix.join(rel, f), out); }
  else out[rel] = new Uint8Array(fs.readFileSync(p));
  return out;
}

function firefoxManifest(m) {
  const f = JSON.parse(JSON.stringify(m));
  delete f.minimum_chrome_version;
  f.background = { scripts: ["src/background.js"] };
  f.browser_specific_settings = {
    gecko: {
      id: "teeth-exporter@rojasjason.github.io",
      strict_min_version: "128.0",                     // first Firefox with MAIN-world content scripts
      data_collection_permissions: { required: ["none"] }
    }
  };
  return f;
}

const files = {};
for (const r of INCLUDE) collect(r, files);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
fs.mkdirSync(DIST, { recursive: true });

const builds = {
  "teeth-exporter-chrome-edge-brave": manifest,
  "teeth-exporter-firefox": firefoxManifest(manifest)
};
for (const [name, man] of Object.entries(builds)) {
  const entries = Object.assign({}, files, { "manifest.json": new TextEncoder().encode(JSON.stringify(man, null, 2) + "\n") });
  const dir = path.join(DIST, name);                  // unpacked copy, for testing
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, bytes] of Object.entries(entries)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), bytes); }
  const zip = fflate.zipSync(entries, { level: 9 });
  fs.writeFileSync(path.join(DIST, name + ".zip"), zip);
  console.log("  " + name + ".zip  " + Math.round(zip.length / 1024) + " KB  (v" + man.version + ")");
}
