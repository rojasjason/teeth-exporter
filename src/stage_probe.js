/*
 * stage_probe.js — detect which aligner step the viewer is currently showing, and watch it live.
 *
 * Per-tooth motion is sub-millimeter, so the step CANNOT be inferred from the 3D geometry — it has
 * to be read from the viewer's own step control. We don't know that control's markup a priori, so
 * we scan for the usual shapes (a range slider, an ARIA slider, or "X / Y" text) and disambiguate
 * using a fact we DO know: the bundle's total stage count. The control whose total matches the
 * plan's stage count is almost certainly the aligner stepper, not some unrelated slider.
 *
 * Exposes globalThis.TeethStageProbe(opts):
 *   opts.getMaxStage() -> number|null   the plan's max stage (from engine.stageRange); null = unknown
 *   opts.onChange(info)                 called when the detected step changes; info = {stage,current,total,source}
 *   returns { start(), stop(), get() }
 *
 * `stage` is OUR 0-based engine stage (0..max). `current`/`total` are the raw control values.
 */
(function (root) {
  "use strict";

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function visible(el) {
    if (!el || !el.getClientRects) return false;
    if (!el.getClientRects().length) return false;
    var s = (root.getComputedStyle ? root.getComputedStyle(el) : null);
    return !s || (s.visibility !== "hidden" && s.display !== "none");
  }

  function TeethStageProbe(opts) {
    opts = opts || {};
    var getMax = opts.getMaxStage || function () { return null; };
    var onChange = opts.onChange || function () {};
    var cur = null, timer = null, observer = null, started = false;

    // collect candidate step controls with {current, total, min, source, score}
    function candidates() {
      var maxStage = getMax();                          // e.g. 21 (stages 0..21 -> 22 steps)
      var out = [];
      function add(current, total, min, source, baseScore) {
        if (current == null || total == null || total < 2 || total > 200) return;
        var score = baseScore;
        if (maxStage != null) {
          if (total === maxStage || total === maxStage + 1) score += 100;      // exact (0- or 1-indexed)
          else if (Math.abs(total - maxStage) <= 1) score += 40;
          else score -= 30;                                                    // unlikely the stepper
        }
        out.push({ current: current, total: total, min: min == null ? 0 : min, source: source, score: score });
      }
      // 1) native range sliders
      var ranges = root.document.querySelectorAll('input[type="range"]');
      for (var i = 0; i < ranges.length; i++) {
        var r = ranges[i]; if (!visible(r)) continue;
        var mn = num(r.min) || 0, mx = num(r.max), v = num(r.value);
        if (mx != null && v != null) add(v, mx, mn, "range", 50);
      }
      // 2) ARIA sliders
      var aria = root.document.querySelectorAll('[role="slider"],[aria-valuemax]');
      for (var j = 0; j < aria.length; j++) {
        var a = aria[j]; if (!visible(a)) continue;
        var amn = num(a.getAttribute("aria-valuemin")) || 0;
        var amx = num(a.getAttribute("aria-valuemax")), av = num(a.getAttribute("aria-valuenow"));
        if (amx != null && av != null) add(av, amx, amn, "aria", 45);
      }
      // 3) the older WebCC viewer (share.invisalign "Outcome Simulation"): a jQuery UI slider whose
      // handle sits at left: 0%..100% across stages 0..max. Reported 1-based (total = max + 1) so it
      // reads like the other steppers.
      var handles = root.document.querySelectorAll(".cc-stageslider .ui-slider-handle");
      for (var h = 0; h < handles.length; h++) {
        var hd = handles[h]; if (!visible(hd) || maxStage == null || maxStage < 1) continue;
        var pct = num(hd.style && hd.style.left);
        if (pct == null || !/%\s*$/.test(hd.style.left)) continue;
        pct = Math.max(0, Math.min(100, pct));
        out.push({ current: 1 + Math.round(pct / 100 * maxStage), total: maxStage + 1, min: 1, source: "webcc", score: 200 });
      }
      // 4) "X / Y" or "X of Y" text, ideally near step/stage/aligner wording.
      // Skipped when a slider already matched the plan's stage count — this scan walks the DOM
      // and is only worth the cost as a fallback.
      if (out.some(function (c) { return c.score >= 85; })) { out.sort(function (p, q) { return q.score - p.score; }); return out; }
      try {
        var rx = /\b(\d{1,3})\s*(?:\/|of)\s*(\d{1,3})\b/;
        var nodes = root.document.querySelectorAll("body *");
        for (var k = 0; k < nodes.length && k < 4000; k++) {
          var el = nodes[k];
          if (el.children && el.children.length) continue;          // leaf text only
          var txt = (el.textContent || "").trim();
          if (txt.length > 40) continue;
          var m = rx.exec(txt);
          if (!m) continue;
          var c = num(m[1]), t = num(m[2]);
          var labelled = /step|stage|aligner|week/i.test((el.textContent || "") + " " + (el.getAttribute && (el.getAttribute("aria-label") || "") || ""));
          add(c, t, t === (getMax() + 1) ? 1 : 0, "text", labelled ? 35 : 10);
        }
      } catch (e) {}
      out.sort(function (p, q) { return q.score - p.score; });
      return out;
    }

    function read() {
      var maxStage = getMax();
      // without the plan's stage count there is nothing to disambiguate with, and any visible
      // slider (zoom, opacity) would latch as "the step". Don't guess.
      if (maxStage == null) return null;
      var c = candidates();
      if (!c.length) return null;
      // require a control whose total actually matches the plan (a +100 match or +40 near-match
      // bonus) — don't latch onto an unrelated slider.
      if (c[0].score < 85) return null;
      var best = c[0];
      // map to 0-based engine stage (stages 0..maxStage):
      // Controls count ALIGNERS, which start at 1: the live ClinCheck viewer shows "Aligner Number 1 / 21"
      // at stage 0 and "21 / 21" at stage 20, so aligner N = stage N - 1. A 1-based control (min 1,
      // or text, or a total of maxStage+1 with no min) maps N -> N - 1; a 0-based one maps directly.
      var offset = best.min;
      if (best.source === "text" || best.total === maxStage + 1) offset = 1;
      var stage = Math.max(0, Math.min(maxStage, Math.round(best.current - offset)));
      return { stage: stage, current: best.current, total: best.total, source: best.source };
    }

    function doTick() {
      var info = read();
      if (info && (cur == null || info.stage !== cur.stage || info.total !== cur.total)) {
        cur = info; try { onChange(info); } catch (e) {}
      }
    }
    // MutationObserver can fire on every DOM change in a busy SPA — throttle the actual scan
    // to at most one per 300ms (leading edge immediate, trailing edge scheduled).
    var lastTick = 0, tickTimer = null;
    function tick() {
      var now = Date.now();
      if (now - lastTick >= 300) { lastTick = now; doTick(); }
      else if (!tickTimer) {
        tickTimer = root.setTimeout(function () { tickTimer = null; lastTick = Date.now(); doTick(); }, 300 - (now - lastTick));
      }
    }

    function start() {
      if (started) return; started = true;
      // observe attribute (aria-valuenow / value) + text changes, plus a backing-off poll for SPAs
      try {
        observer = new root.MutationObserver(function () { tick(); });
        observer.observe(root.document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-valuenow", "value"] });
      } catch (e) {}
      try {
        root.document.addEventListener("input", tick, true);
        root.document.addEventListener("change", tick, true);
        // a jQuery UI slider moves by pointer or arrow keys and fires neither input nor change
        root.document.addEventListener("pointerup", tick, true);
        root.document.addEventListener("keyup", tick, true);
      } catch (e) {}
      var n = 0;
      timer = root.setInterval(function () { tick(); if (++n > 40) { root.clearInterval(timer); timer = root.setInterval(tick, 2500); } }, 700);
      tick();
    }
    function stop() {
      started = false;
      if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
      if (timer) { root.clearInterval(timer); timer = null; }
      if (tickTimer) { try { root.clearTimeout(tickTimer); } catch (e) {} tickTimer = null; }
    }
    return { start: start, stop: stop, get: function () { return cur; } };
  }

  root.TeethStageProbe = TeethStageProbe;
})(typeof globalThis !== "undefined" ? globalThis : this);
