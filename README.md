# Teeth Exporter (unofficial)

Download your own teeth and gums as 3D files (STL and GLB) from your aligner treatment plan's
3D viewer. Works with the Invisalign ClinCheck viewer. One aligner or every aligner at once.

Everything runs in your browser. Nothing is uploaded anywhere.

> **Unofficial.** Not affiliated with, authorized by, or endorsed by Align Technology,
> Invisalign, or ClinCheck. Use it only on **your own** treatment plan.
> See [Legal](#legal).

---

## Install

Teeth Exporter is a Chrome extension. It is not in the Chrome Web Store, so you add it yourself.
It takes about two minutes. It works in Chrome, Edge, Brave, and other Chromium browsers
(version 111 or newer).

### 1. Download it

1. At the top of this page, click the green **Code** button.
2. Click **Download ZIP**.
3. Unzip the file. You get a folder named `teeth-exporter-main`.
4. Move that folder somewhere it can stay, for example your Documents folder.
   The browser loads the extension from this folder. If you move or delete the folder later,
   the extension stops working.

### 2. Add it to your browser

1. Open a new tab and go to `chrome://extensions`.
   (Edge: `edge://extensions`. Brave: `brave://extensions`.)
2. Turn on **Developer mode**. The switch is in the top-right corner.
   (In Edge, it is in the left sidebar.)
3. Click **Load unpacked**. The button appears after you turn on Developer mode.
4. Select the `teeth-exporter-main` folder (the one that holds `manifest.json`), then click
   **Select**.
5. **Teeth Exporter** now shows in your list of extensions.

### 3. Pin the icon

1. Click the puzzle-piece icon in the browser toolbar.
2. Click the pin next to **Teeth Exporter**.

The mint tooth icon now stays in your toolbar.

### Update to a new version

1. Download the ZIP again and unzip it.
2. Replace the old `teeth-exporter-main` folder with the new one.
3. Go to `chrome://extensions` and click the reload arrow on **Teeth Exporter**.

### Remove it

Go to `chrome://extensions` and click **Remove** on **Teeth Exporter**. Then delete the folder.

---

## Use

1. Open your **ClinCheck / Invisalign 3D viewer** (for example, the treatment plan shared with
   you on `my.invisalign.com`) and let the 3D model load.
2. **Rotate the model once** so the pink gums on both jaws show on screen. The gums are created
   only when the viewer draws them, so this is what lets them be captured.
3. Click the tooth icon in your toolbar to open the Teeth Exporter panel.
4. Click one of the two buttons:
   - **Export this aligner** saves the aligner on screen, teeth and real gums.
   - **Export every aligner** steps through your whole plan and saves every aligner, each with
     its own real gums. A progress screen shows which aligner it is on. It takes about a second
     per aligner. Keep the tab open and on screen while it runs.

Aligner numbers match the viewer's **Aligner Number** slider: the folder `stage_05` is
Aligner Number 5.

### What you get

Each export is a `.zip`. Each aligner looks like this (true scale, millimeters):

```
full_mouth_with_gums.stl   both jaws, teeth + gums
upper_with_gums.stl        upper teeth + gum
lower_with_gums.stl        lower teeth + gum
full_mouth.glb             colored 3D model; upper teeth, lower teeth, and each gum are separate objects
Advanced/
  full_mouth_teeth.stl, upper_teeth.stl, lower_teeth.stl    teeth only
  full_mouth_gums.stl, gum_U.stl, gum_L.stl                 gums only
```

"Export every aligner" gives one of these folders per aligner (`stage_01`, `stage_02`, ...)
plus a README and a manifest. "Export this aligner" also puts its manifest and README in
`Advanced/`.

The STL files print at true size. The GLB opens at true size in Blender and other 3D apps.

### Advanced

- **Aligner number:** export a specific aligner instead of the one on screen. The viewer
  briefly moves to that aligner to capture its gums, then moves back.
- **Download raw scan:** the original scan file from the viewer, untouched. Useful as a backup
  and for bug reports.
- **Troubleshooting:** download the files the viewer loaded (your scan itself is left out),
  or what is on screen as a 3D file. Case IDs and private links are removed from the file list.
  The raw scan does contain your treatment-plan identifiers, so don't post it publicly.

---

## How it works

The viewer loads your whole 3D model as one compressed file (a ZIP of
[OpenCTM](http://openctm.sourceforge.net/) meshes plus JSON data). Teeth Exporter:

1. **Captures** that file as the viewer loads it, by watching the page's own network requests.
2. **Decodes** the tooth meshes (OpenCTM MG2 + LZMA) in the page.
3. **Places** both jaws in their real bite, using the plan's own jaw data, at any aligner.
4. **Captures the real gums.** The gum you see is generated, not downloaded: the viewer builds
   it for each aligner and sends it to the graphics card to draw. Teeth Exporter reads them at that point, the exact
   surface the viewer shows, and fits them onto the teeth. The captured teeth come back
   identical to the downloaded ones, which proves both use the same coordinates.
5. For **every aligner**, it moves the viewer to each aligner in turn, captures that aligner's
   gums, and puts the viewer back where you had it.
6. **Saves** STL and GLB files into one `.zip`.

The scan stays in the tab's memory and goes straight to your downloads. Teeth Exporter makes
no network requests of its own.

### Code

```
manifest.json            extension manifest (MV3)
src/capture.js           captures the scan file (page context)
src/webgl_capture.js     captures the drawn gums (page context)
src/viewer_bridge.js     reads and sets the viewer's aligner (page context)
src/controller.js        everything the buttons do
src/ui_panel.js          the panel and the progress screen
src/all_stages.js        the every-aligner loop
src/engine.js            decode, place, fit gums, write STL/GLB/zip
src/stage_probe.js       fallback: reads the aligner from the page text
src/content.js           connects the page scripts to the panel
src/popup.*              extension popup
src/background.js        toolbar badge
lib/                     OpenCTM decoder + fflate (vendored, MIT)
icons/src/icon.svg       source of the toolbar icon
test/                    offline test suites
```

There is no build step and there are no dependencies. Edit `src/`, then click the reload arrow
on `chrome://extensions`.

### Tests

```
node test/validate.js                teeth match the reference pipeline within 0.01 mm
node test/validate_gums.js           gum fitting matches the reference exactly
node test/validate_gum_variants.js   the right gum is picked per jaw when there are several
node test/validate_stage_probe.js    reading the aligner from page text
node test/validate_webgl_capture.js  the gum capture keeps the right meshes
node test/validate_all_stages.js     the every-aligner loop, folders, and Cancel
node test/validate_hardening.js      message lock, zip and mesh size limits, scan never in captured files
```

The parity tests read a real scan from a private folder that is not part of this repository.
Point the `DATA` path in a test at any extracted scan to run them.

---

## Troubleshooting

- **The panel never says the scan is ready.** Your viewer may be on a website that isn't listed
  yet. Open an issue with the website's address (no private links, please). Never attach your
  raw scan to a public issue.
- **No gums in the export.** That jaw wasn't drawn yet. Rotate the model so both gums show,
  then export again.
- **"Export every aligner" missed some gums.** The tab was probably hidden while it ran. Keep
  the tab open and on screen, then run it again.
- **"Can't reach the viewer."** Reload the viewer page, let it load, then try again.

---

## Roadmap

- Attachments export (the planned bumps are in the scan file)
- Firefox version
- 3D preview in the panel

---

## Legal

- **Your data only.** Export treatment plans that are yours, or that you are authorized to
  access.
- **No affiliation.** "Invisalign", "ClinCheck", and "Align Technology" are trademarks of
  Align Technology, Inc. This project is independent and unofficial.
- Teeth Exporter only reads a model file your own browser already downloaded to show it, using
  open-source decoders.
- Provided **as is**, without warranty. Not a medical device. Exported models are for personal,
  educational, and hobby use, not for clinical decisions.

## Credits

- OpenCTM JavaScript reader `ctm.js` + `lzma.js`, © Juan Mellado, MIT
- [fflate](https://github.com/101arrowz/fflate), © Arjun Barrett, MIT
- OpenCTM format, Marcus Geelnard

See [THIRD_PARTY.md](THIRD_PARTY.md).

## License

This project's own code is licensed
**[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**: free to use, share,
and change for **non-commercial** purposes, with credit, and changed versions must use the same
license. No selling. Full text in [LICENSE](LICENSE). The libraries in `lib/` keep their MIT
licenses ([THIRD_PARTY.md](THIRD_PARTY.md)).
