# Third-party components

Vendored in `lib/`, unmodified except small dual-environment shims (noted inline).

## ctm.js, lzma.js, OpenCTM JavaScript reader
- © 2011 Juan Mellado. License: MIT.
- Decodes the OpenCTM mesh format (RAW / MG1 / MG2 with LZMA).
- Local change: `lib/ctm.js` `require('./lzma')` made conditional so it also runs as a
  browser classic script via `globalThis.LZMA`; both files append a `globalThis` export.
  A stray no-op token was removed. One decoding fix: `CTM.restoreVertices` reads the MG2
  vertex deltas as signed (`Int32Array`, as the OpenCTM spec and the ClinCheck viewer's own copy
  do); the upstream unsigned view sent any negative delta ~8.6 km off. Tooth meshes never carry
  negative deltas, so they still decode bit-exact against the reference `python-openctm` decoder.

## fflate, `lib/fflate.umd.js`
- © Arjun Barrett (101arrowz). License: MIT. https://github.com/101arrowz/fflate
- ZIP read (unzip the WCC bundle) and write (package the exported files).
- UMD build, unmodified.

## OpenCTM format
- © Marcus Geelnard. The format spec/reference implementation is zlib/libpng-licensed.
  http://openctm.sourceforge.net/

This project's own code is licensed **CC BY-NC-SA 4.0** (see `LICENSE`). The components listed
above keep their original **MIT** licenses, MIT is permissive and compatible with bundling into
a CC BY-NC-SA project; their copyright notices are retained in `lib/`.
