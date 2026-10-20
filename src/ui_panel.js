/*
 * ui_panel.js — the ONE panel both builds show. The extension popup and the userscript's floating
 * panel both call TeethPanel, so they look and behave the same; only the adapter differs (the popup
 * messages the tab, the userscript calls its controller directly).
 *
 * Styles go in through a constructable stylesheet (adoptedStyleSheets), which a strict page CSP
 * can't strip, so the floating panel looks right on any viewer page. Design: Workshop Standard
 * (mono base, mono uppercase labels, 1px rules, square corners, no shadows, light + dark).
 *
 * Exposes globalThis.TeethPanel({ mount, adapter, mode }) -> { refresh() }
 *   mount    element or ShadowRoot to render into
 *   adapter  { status() -> Promise<status|null>, run(name, args) -> Promise<result|null> }
 *            null means the viewer can't be reached
 *   mode     "popup" | "floating"
 */
(function (root) {
  "use strict";

  // The look. Kept as a theme table so a future variant only adds colors, never layout.
  var THEMES = {
    mint: {                      // the chosen look (Jason, 2026-10-19)
      paper: "#FFFFFF", ink: "#16302B", ink2: "#4F6B65", ink3: "#93A8A3", line: "#E4EFEC", soft: "#EEF8F5",
      primary: "#2BB58A", primaryHover: "#239C76", primaryInk: "#FFFFFF", chip: "#DDF5EC", chipInk: "#17785A",
      ok: "#2BB58A", err: "#D9534F", errBg: "#FDECEA", radius: "16px", btnRadius: "12px", head: "#F3FBF8",
      shadow: "0 10px 30px rgba(20,40,60,.12)",
      // dark mode (follows the system setting). Dark text on the green keeps the button readable.
      dark: {
        paper: "#131A19", ink: "#E6F2EE", ink2: "#A3B8B2", ink3: "#6D827C", line: "#25312E", soft: "#1A2422",
        primary: "#34C496", primaryHover: "#4AD3A7", primaryInk: "#0C251D", chip: "#173A2F", chipInk: "#86E3C2",
        ok: "#34C496", err: "#FF8A80", errBg: "#3A1F1E", head: "#17221F", shadow: "0 10px 30px rgba(0,0,0,.45)"
      }
    }
  };

  function cssFor(name) {
    var t = THEMES[name] || THEMES.mint;
    function colors(c) {
      return "--paper:" + c.paper + ";--ink:" + c.ink + ";--ink-2:" + c.ink2 + ";--ink-3:" + c.ink3 + ";--line:" + c.line + ";--soft:" + c.soft + ";" +
        "--primary:" + c.primary + ";--primary-hover:" + c.primaryHover + ";--primary-ink:" + c.primaryInk + ";--chip:" + c.chip + ";--chip-ink:" + c.chipInk + ";" +
        "--ok:" + c.ok + ";--err:" + c.err + ";--err-bg:" + c.errBg + ";--head:" + c.head + ";--shadow:" + c.shadow + ";";
    }
    return [
      ".te{" + colors(t),
      "--r:" + t.radius + ";--br:" + t.btnRadius + ";",
      "--ease:cubic-bezier(0.16,1,0.3,1);--sans:ui-rounded,'SF Pro Rounded',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;",
      "box-sizing:border-box;width:320px;background:var(--paper);color:var(--ink);font:13px/1.5 var(--sans);",
      "-webkit-font-smoothing:antialiased;text-align:left;overflow:hidden;color-scheme:light;}",
      t.dark ? "@media (prefers-color-scheme:dark){.te{" + colors(t.dark) + "color-scheme:dark;}}" : "",
      ".te *,.te *::before,.te *::after{box-sizing:border-box;}",
      ".te[data-mode=popup]{max-height:590px;overflow-x:hidden;overflow-y:auto;}",
      ".te[data-mode=floating]{border:1px solid var(--line);border-radius:var(--r);max-height:calc(100vh - 32px);overflow-y:auto;",
      "box-shadow:var(--shadow);}",
      ".te-label{font:600 12px/1.3 var(--sans);color:var(--ink-2);}",
      ".te-head{display:flex;align-items:center;gap:10px;padding:16px 16px 14px;background:var(--head);}",
      ".te-logo{width:30px;height:30px;flex:none;border-radius:10px;background:var(--primary);display:grid;place-items:center;}",
      ".te-logo svg{width:18px;height:18px;color:var(--primary-ink);}",
      ".te-title{font:700 15px/1.2 var(--sans);margin:0;color:var(--ink);flex:1;}",
      ".te-tag{font:600 10px/1 var(--sans);color:var(--ink-3);background:var(--paper);border:1px solid var(--line);border-radius:999px;padding:4px 8px;}",
      ".te-status{display:flex;align-items:center;padding:12px 16px 0;}",
      ".te-pill{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;background:var(--soft);",
      "font:600 12px/1 var(--sans);color:var(--ink-2);transition:background-color 250ms var(--ease),color 250ms var(--ease);}",
      ".te-dot{width:7px;height:7px;border-radius:50%;background:var(--ink-3);flex:none;}",
      ".te-status[data-state=ready] .te-pill{background:var(--chip);color:var(--chip-ink);}",
      ".te-status[data-state=ready] .te-dot{background:var(--ok);}",
      ".te-status[data-state=busy] .te-pill{background:var(--chip);color:var(--chip-ink);}",
      ".te-status[data-state=busy] .te-dot{background:var(--primary);}",
      ".te-body{padding:14px 16px 16px;display:flex;flex-direction:column;}",
      ".te-btn{display:block;width:100%;padding:12px 16px;margin:0;border:1px solid var(--line);border-radius:var(--br);background:var(--paper);",
      "color:var(--ink);font:600 13px/1.2 var(--sans);text-align:center;cursor:pointer;",
      "transition:background-color 200ms var(--ease),border-color 200ms var(--ease),transform 200ms var(--ease);}",
      ".te-btn:hover:not(:disabled){background:var(--soft);border-color:var(--ink-3);}",
      ".te-btn:active:not(:disabled){transform:scale(.98);}",
      ".te-btn--solid{background:var(--primary);border-color:var(--primary);color:var(--primary-ink);padding:14px 16px;font-size:14px;}",
      ".te-btn--solid:hover:not(:disabled){background:var(--primary-hover);border-color:var(--primary-hover);}",
      ".te-btn--quiet{font-weight:500;}",
      ".te-btn:disabled{opacity:.45;cursor:default;}",
      ".te-btn:focus-visible,.te-input:focus-visible,.te-adv summary:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}",
      ".te-hint{margin:7px 2px 14px;color:var(--ink-2);font-size:12px;line-height:1.5;}",
      ".te-hint:last-child{margin-bottom:0;}",
      ".te-msg{margin:0 16px 14px;padding:10px 12px;border-radius:calc(var(--r) - 6px);background:var(--chip);color:var(--chip-ink);font:500 12px/1.45 var(--sans);}",
      ".te-msg:empty{display:none;}",
      ".te-msg[data-err]{background:var(--err-bg);color:var(--err);}",
      ".te-help{margin:0;padding:0 0 0 18px;color:var(--ink-2);font-size:12.5px;}",
      ".te-help li{margin:0 0 6px;}",
      ".te-adv{border-top:1px solid var(--line);}",
      ".te-adv summary{list-style:none;cursor:pointer;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;}",
      ".te-adv summary::-webkit-details-marker{display:none;}",
      ".te-adv summary::after{content:'';width:7px;height:7px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);",
      "transform:rotate(45deg) translateY(-2px);transition:transform 250ms var(--ease);}",
      ".te-adv[open] summary::after{transform:rotate(-135deg) translateY(-2px);}",
      ".te-adv-body{padding:2px 16px 16px;display:flex;flex-direction:column;}",
      ".te-field{display:flex;align-items:center;justify-content:space-between;gap:12px;}",
      ".te-input{width:104px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;",
      "background:var(--paper);color:var(--ink);font:13px/1 var(--sans);}",
      ".te-input:focus{border-color:var(--primary);outline:none;}",
      ".te-rule{height:1px;background:var(--line);margin:2px 0 14px;}",
      ".te-sub{margin:0 0 8px;}",
      ".te-stack{display:flex;flex-direction:column;gap:8px;}",
      ".te-foot{display:block;padding:11px 16px 13px;border-top:1px solid var(--line);color:var(--ink-3);font:500 11px/1.3 var(--sans);text-align:center;}",
      "[hidden]{display:none !important;}",
      // progress overlay
      ".te.te-ov{position:fixed;inset:0;width:auto;display:grid;place-items:center;z-index:2147483647;overflow:hidden;",
      "background:color-mix(in srgb,var(--paper) 78%,transparent);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);",
      "opacity:0;transition:opacity 300ms var(--ease);}",
      ".te.te-ov[data-on]{opacity:1;}",
      ".te-card{width:300px;max-width:calc(100vw - 32px);background:var(--paper);border:1px solid var(--line);border-radius:var(--r);",
      "box-shadow:var(--shadow);padding:22px 22px 18px;text-align:center;transform:translateY(12px);transition:transform 600ms var(--ease);}",
      ".te.te-ov[data-on] .te-card{transform:none;}",
      ".te-card .te-logo{margin:0 auto 12px;width:40px;height:40px;border-radius:12px;}",
      ".te-card .te-logo svg{width:24px;height:24px;}",
      ".te-ov-title{font:700 15px/1.3 var(--sans);margin:0 0 4px;}",
      ".te-ov-count{font:700 30px/1.1 var(--sans);margin:10px 0 12px;letter-spacing:-.01em;}",
      ".te-ov-count small{font-size:14px;font-weight:600;color:var(--ink-2);}",
      ".te-bar{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;}",
      ".te-bar i{display:block;height:100%;width:0;border-radius:999px;background:var(--primary);transition:width 500ms var(--ease);}",
      ".te-ov-note{margin:12px 0 14px;color:var(--ink-2);font-size:12px;line-height:1.5;}",
      ".te-card .te-btn{width:auto;display:inline-block;padding:9px 18px;}"
    ].join("");
  }

  function fmtSize(b) {
    if (!b && b !== 0) return "";
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
    if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
    return Math.round(b / 1024) + " KB";
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  // the tooth mark, built with DOM calls (no innerHTML: Trusted Types pages reject it)
  function toothLogo() {
    var logo = el("span", "te-logo");
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M7 3c-2.2 0-4 1.9-4 4.6 0 2.3 1 3.6 1.6 5.6.6 2.2.7 7.8 2.9 7.8 1.6 0 1.5-4.6 2.6-5.9.5-.6 1.3-.6 1.8 0 1.1 1.3 1 5.9 2.6 5.9 2.2 0 2.3-5.6 2.9-7.8.6-2 1.6-3.3 1.6-5.6C21 4.9 19.2 3 17 3c-1.9 0-2.9 1.2-5 1.2S8.9 3 7 3z");
    [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"]]
      .forEach(function (kv) { path.setAttribute(kv[0], kv[1]); });
    svg.appendChild(path); logo.appendChild(svg);
    return logo;
  }

  function addStyles(mount, CSS) {
    var host = mount.adoptedStyleSheets !== undefined ? mount : (mount.ownerDocument || document);
    try {
      var sheet = new CSSStyleSheet(); sheet.replaceSync(CSS);
      host.adoptedStyleSheets = (host.adoptedStyleSheets || []).concat([sheet]);
      return;
    } catch (e) {}
    var st = el("style"); st.textContent = CSS; (mount.appendChild ? mount : document.head).appendChild(st);
  }

  var DEFAULT_THEME = "mint";

  function TeethPanel(opts) {
    var mount = opts.mount, adapter = opts.adapter, mode = opts.mode || "popup", theme = opts.theme || DEFAULT_THEME;
    var LOST = "Can't reach the viewer. Reload the viewer page, let it load, then try again.";
    addStyles(mount, cssFor(theme));

    var rootEl = el("div", "te"); rootEl.setAttribute("data-mode", mode);

    var head = el("header", "te-head");
    var logo = toothLogo();
    head.appendChild(logo);
    head.appendChild(el("h1", "te-title", "Teeth Exporter"));
    head.appendChild(el("span", "te-tag", "Unofficial"));

    var status = el("div", "te-status"); status.setAttribute("data-state", "waiting");
    var pill = el("span", "te-pill");
    pill.appendChild(el("span", "te-dot"));
    var statusText = el("span", null, "Checking this tab");
    pill.appendChild(statusText);
    status.appendChild(pill);

    // main actions (shown once a scan is captured)
    var main = el("div", "te-body");
    var btnOne = el("button", "te-btn te-btn--solid", "Export this aligner");
    var hintOne = el("p", "te-hint", "Teeth and real gums for the aligner on screen. Orbit the model once first so both gums get drawn.");
    var btnAll = el("button", "te-btn", "Export every aligner");
    var hintAll = el("p", "te-hint", "One folder per aligner, each with its real gums. About a second per aligner. Keep the viewer on screen.");
    [btnOne, hintOne, btnAll, hintAll].forEach(function (n) { main.appendChild(n); });

    // help (shown until a scan is captured)
    var help = el("div", "te-body");
    var ol = el("ol", "te-help");
    ["Open your ClinCheck 3D treatment plan in this tab.", "Let the 3D model load and rotate it once.", "The buttons show up here when the scan is ready."]
      .forEach(function (t) { ol.appendChild(el("li", null, t)); });
    help.appendChild(ol);

    var msg = el("p", "te-msg");

    // advanced
    var adv = el("details", "te-adv");
    var sum = el("summary"); sum.appendChild(el("span", "te-label", "Advanced")); adv.appendChild(sum);
    var advBody = el("div", "te-adv-body");
    var field = el("label", "te-field");
    field.appendChild(el("span", "te-label", "Aligner number"));
    var input = el("input", "te-input"); input.type = "number"; input.min = "1"; input.placeholder = "current";
    field.appendChild(input);
    var hintField = el("p", "te-hint", "Blank exports the aligner on screen. A number exports that aligner instead, numbered like the viewer's slider.");
    var btnRaw = el("button", "te-btn te-btn--quiet", "Download raw scan");
    var hintRaw = el("p", "te-hint", "The original scan file, untouched. A backup of your data, and the file to send with a bug report.");
    var rule = el("div", "te-rule");
    var sub = el("span", "te-label te-sub", "Troubleshooting");
    var stack = el("div", "te-stack");
    var btnDiag = el("button", "te-btn te-btn--quiet", "Download captured files");
    var btnGl = el("button", "te-btn te-btn--quiet", "Download rendered 3D");
    stack.appendChild(btnDiag); stack.appendChild(btnGl);
    var hintDiag = el("p", "te-hint", "For bug reports. Case IDs and private links are removed from the file list.");
    [field, hintField, btnRaw, hintRaw, rule, sub, stack, hintDiag].forEach(function (n) { advBody.appendChild(n); });
    adv.appendChild(advBody);

    var foot = el("span", "te-label te-foot", "Runs locally. Nothing is uploaded.");

    [head, status, main, help, msg, adv, foot].forEach(function (n) { rootEl.appendChild(n); });
    mount.appendChild(rootEl);

    var buttons = [btnOne, btnAll, btnRaw, btnDiag, btnGl];
    var running = false;

    function setMsg(t, isErr) {
      msg.textContent = t || "";
      if (isErr) msg.setAttribute("data-err", ""); else msg.removeAttribute("data-err");
    }
    function setStatus(stateName, t) { status.setAttribute("data-state", stateName); statusText.textContent = t; }

    function render(s) {
      if (!s) {
        setStatus("waiting", mode === "popup" ? "Open your ClinCheck viewer" : "Waiting for the viewer");
        main.hidden = true; adv.hidden = true; help.hidden = false;
        return;
      }
      if (!s.captured) {
        setStatus("waiting", "Waiting for the 3D plan to load");
        main.hidden = true; adv.hidden = true; help.hidden = false;
        return;
      }
      main.hidden = false; adv.hidden = false; help.hidden = true;
      var where = s.aligner != null ? "Aligner " + s.aligner + (s.total ? " / " + s.total : "") : "Scan";
      if (s.busy === "allStages" && s.progress && s.progress.total) setStatus("busy", "Capturing aligner " + s.progress.aligner + " of " + s.progress.total);
      else if (s.busy) setStatus("busy", where + " · working");
      else setStatus("ready", where + " · ready");
      buttons.forEach(function (b) { b.disabled = !!s.busy || running; });
      if (s.aligner != null && !input.value) input.placeholder = "current (" + s.aligner + ")";
      if (s.total) input.max = String(s.total);
    }

    function refresh() { return adapter.status().then(render, function () { render(null); }); }

    function overrideValue() { var v = (input.value || "").trim(); return v === "" ? null : (parseInt(v, 10) || 1); }

    function describe(name, r) {
      if (name === "fullMouth") {
        var a = r.arches || [];
        if (a.length >= 2) return ["Saved aligner " + r.aligner + ": " + r.teeth + " teeth and both gums.", false];
        if (a.length === 1) return ["Saved aligner " + r.aligner + " with only the " + (a[0] === "U" ? "upper" : "lower") + " gum. Orbit to show the other gum, then export again.", true];
        return [r.timedOut
          ? "Saved aligner " + r.aligner + " teeth only. The 3D capture did not answer in time. Export again."
          : "Saved aligner " + r.aligner + " teeth only. No gums yet: orbit the model so both gums get drawn, then export again.", true];
      }
      if (name === "allStages") {
        var miss = r.missing && r.missing.length;
        return ["Saved " + r.count + " aligners with real gums (" + fmtSize(r.bytes) + ")." + (miss ? " Gum missing on aligner " + r.missing.join(", ") + "." : ""), !!miss];
      }
      if (name === "raw") return ["Saved the raw scan (" + fmtSize(r.bytes) + ").", false];
      if (name === "diag") return ["Saved " + r.files + " captured files and an index of " + r.responses + " responses.", false];
      if (name === "glCapture") return ["Saved " + r.count + " rendered meshes." + (r.skipped ? " Left out " + r.skipped + " with broken data." : ""), false];
      return ["Done.", false];
    }

    var START = {
      fullMouth: "Capturing the gums and seating the teeth.",
      allStages: "Stepping through every aligner. Keep the viewer on screen." + (mode === "popup" ? " You can close this popup; the zip downloads when it's done." : ""),
      raw: "Saving the raw scan.", diag: "Bundling the captured files.", glCapture: "Capturing the rendered 3D."
    };

    function run(name) {
      if (running) return;
      running = true;
      buttons.forEach(function (b) { b.disabled = true; });
      setMsg(START[name] || "Working.");
      var args = name === "fullMouth" ? { override: overrideValue() } : null;
      adapter.run(name, args).then(function (r) {
        if (!r) { setMsg(LOST, true); return; }
        if (!r.ok) { setMsg(r.error || "That didn't work.", true); return; }
        var d = describe(name, r); setMsg(d[0], d[1]);
      }, function (e) { setMsg(String(e && e.message || e), true); })
        .then(function () { running = false; refresh(); });
    }

    btnOne.addEventListener("click", function () { run("fullMouth"); });
    btnAll.addEventListener("click", function () { run("allStages"); });
    btnRaw.addEventListener("click", function () { run("raw"); });
    btnDiag.addEventListener("click", function () { run("diag"); });
    btnGl.addEventListener("click", function () { run("glCapture"); });

    refresh();
    setInterval(refresh, 1000);
    return { refresh: refresh };
  }

  // ---- progress overlay over the viewer during "Export every aligner" ----
  // show({onCancel}) -> update({aligner,total}) -> finish(text) | hide()
  function TeethProgress() {
    var host = null, ov = null, count = null, bar = null, title = null, note = null, cancelBtn = null, hideTimer = null;
    function build() {
      host = document.createElement("div");
      host.id = "teeth-exporter-progress";
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
      var shadow = host.attachShadow({ mode: "open" });
      addStyles(shadow, cssFor(DEFAULT_THEME));
      ov = el("div", "te te-ov");
      ov.setAttribute("role", "dialog"); ov.setAttribute("aria-live", "polite");
      var card = el("div", "te-card");
      card.appendChild(toothLogo());
      title = el("p", "te-ov-title", "Exporting every aligner");
      count = el("div", "te-ov-count", "Starting");
      var track = el("div", "te-bar"); bar = el("i"); track.appendChild(bar);
      note = el("p", "te-ov-note", "Capturing the real gums for each aligner. Keep this tab open and on screen.");
      cancelBtn = el("button", "te-btn", "Cancel");
      [title, count, track, note, cancelBtn].forEach(function (n) { card.appendChild(n); });
      ov.appendChild(card); shadow.appendChild(ov);
    }
    return {
      show: function (opts) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        if (!host) build();
        title.textContent = "Exporting every aligner";
        count.textContent = "Starting"; bar.style.width = "0%";
        note.textContent = "Capturing the real gums for each aligner. Keep this tab open and on screen.";
        cancelBtn.hidden = false; cancelBtn.disabled = false; cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = function () {
          cancelBtn.disabled = true; cancelBtn.textContent = "Stopping";
          note.textContent = "Finishing this aligner, then putting the viewer back.";
          if (opts && opts.onCancel) opts.onCancel();
        };
        (document.body || document.documentElement).appendChild(host);
        requestAnimationFrame(function () { ov.setAttribute("data-on", ""); });
      },
      update: function (p) {
        if (!host || !p || !p.total) return;
        count.textContent = "";
        count.appendChild(document.createTextNode(String(p.aligner)));
        count.appendChild(el("small", null, " of " + p.total));
        bar.style.width = Math.round(((p.aligner - 1) / p.total) * 100) + "%";
      },
      finish: function (text) {
        if (!host) return;
        bar.style.width = "100%";
        title.textContent = text || "Done";
        count.textContent = "Saved";
        note.textContent = "Your zip is downloading.";
        cancelBtn.hidden = true;
        hideTimer = setTimeout(this.hide, 1600);
      },
      hide: function () {
        if (!host) return;
        ov.removeAttribute("data-on");
        var h = host;
        setTimeout(function () { if (h.parentNode) h.parentNode.removeChild(h); }, 320);
      }
    };
  }

  root.TeethPanel = TeethPanel;
  root.TeethProgress = TeethProgress;
})(typeof globalThis !== "undefined" ? globalThis : this);
