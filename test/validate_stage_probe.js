/*
 * validate_stage_probe.js — exercise the aligner-step probe heuristic against a mock DOM.
 * Confirms it (a) picks the control whose total matches the plan's stage count over a decoy
 * slider, (b) maps 1-indexed controls to our 0-based engine stage, (c) reads "X of Y" text.
 *
 *   run:  node test/validate_stage_probe.js
 */
function el(props) { return Object.assign({ getClientRects: () => [{}], getAttribute: () => null, children: [], textContent: "" }, props); }

global.globalThis = global;
global.getComputedStyle = () => ({});
global.MutationObserver = function () { return { observe() {}, disconnect() {} }; };
global.setInterval = () => 0; global.clearInterval = () => {};

let pass = true;
function check(name, cond) { console.log((cond ? "  ✓ " : "  ✗ ") + name); pass = pass && cond; }

function run(opts) {
  const ranges = opts.ranges || [];
  const aria = opts.aria || [];
  const texts = opts.texts || [];
  global.document = {
    documentElement: {}, addEventListener() {},
    querySelectorAll(sel) {
      if (sel.indexOf("range") >= 0) return ranges;
      if (sel.indexOf("slider") >= 0 || sel.indexOf("valuemax") >= 0) return aria;
      if (sel === "body *") return texts;
      return [];
    }
  };
  delete require.cache[require.resolve("../src/stage_probe.js")];
  require("../src/stage_probe.js");
  let got = null;
  const p = global.TeethStageProbe({ getMaxStage: opts.max, onChange: (i) => { got = i; } });
  p.start();
  return got;
}

// 1) real stepper (max 21) beats a decoy zoom slider (max 8)
let r = run({ max: () => 21, ranges: [el({ min: "1", max: "8", value: "3" }), el({ min: "0", max: "21", value: "5" })] });
check("picks max=21 stepper over decoy, stage 5", r && r.stage === 5 && r.total === 21);

// 2) 1-indexed ARIA slider (1..22) maps to 0-based stage
r = run({ max: () => 21, aria: [el({ getAttribute: (k) => ({ "aria-valuemin": "1", "aria-valuemax": "22", "aria-valuenow": "13" }[k] || null) })] });
check("1-indexed aria slider 13/22 -> stage 12", r && r.stage === 12);

// 3) "Step X of Y" text when no slider exists
r = run({ max: () => 21, texts: [el({ textContent: "Step 7 of 22", children: [] })] });
check('text "Step 7 of 22" -> stage 6', r && r.stage === 6);

// 3b) the live viewer's label: "Aligner Number 1 / 21" is stage 0, "21 / 21" is stage 20
r = run({ max: () => 21, texts: [el({ textContent: "Aligner Number 1 / 21", children: [] })] });
check('text "Aligner Number 1 / 21" -> stage 0', r && r.stage === 0);
r = run({ max: () => 21, texts: [el({ textContent: "Aligner Number 21 / 21", children: [] })] });
check('text "Aligner Number 21 / 21" -> stage 20', r && r.stage === 20);

// 4) nothing confident -> no detection (don't guess a random slider)
r = run({ max: () => 21, ranges: [el({ min: "0", max: "100", value: "40" })] });
check("ignores unrelated max=100 slider (no false positive)", r === null);

// 5) F12: 1-indexed slider whose max equals the stage count (1..21) reads the stage directly
r = run({ max: () => 21, ranges: [el({ min: "1", max: "21", value: "21" })] });
check("1..21 slider at 21 -> stage 21 (reachable, not one low)", r && r.stage === 21);
r = run({ max: () => 21, ranges: [el({ min: "1", max: "21", value: "5" })] });
check("1..21 slider at 5 -> stage 5", r && r.stage === 5);

// 6) F12: ARIA 1..22 with no aria-valuemin is still treated as 1-indexed
r = run({ max: () => 21, aria: [el({ getAttribute: (k) => ({ "aria-valuemax": "22", "aria-valuenow": "22" }[k] || null) })] });
check("aria 22/22 without valuemin -> stage 21", r && r.stage === 21);

// 7) F13: unknown plan stage count -> never latch a slider
r = run({ max: () => null, ranges: [el({ min: "0", max: "10", value: "7" })] });
check("maxStage unknown -> no detection (zoom slider not read as a step)", r === null);

console.log("\n" + (pass ? "PASS  stage probe heuristic works" : "FAIL  stage probe heuristic"));
process.exit(pass ? 0 : 1);
