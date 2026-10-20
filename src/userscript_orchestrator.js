/*
 * userscript_orchestrator.js — userscript glue. A Tampermonkey userscript with @grant none runs
 * everything in ONE page context, so capture.js / webgl_capture.js / viewer_bridge.js message this
 * same window. All behavior lives in controller.js and the panel is the shared ui_panel.js, the
 * same one the extension popup shows; here it floats in a Shadow DOM over the viewer.
 *
 * The panel appears in whichever frame captures the scan (iframe viewers get exactly one panel).
 * No chrome.* APIs; nothing leaves the page.
 */
(function () {
  "use strict";
  if (window.__teethExporterUI) return;
  window.__teethExporterUI = true;
  if (!globalThis.ClinCheckEngine || !globalThis.TeethController || !globalThis.TeethPanel) return;

  var mounted = false;
  var overlay = globalThis.TeethProgress();                  // same overlay the extension shows
  var ctl = globalThis.TeethController({
    onCapture: mount,
    onProgress: function (p) { overlay.update(p); },
    onRunStart: function (name) { if (name === "allStages") overlay.show({ onCancel: function () { ctl.cancel(); } }); },
    onRunEnd: function (e) {
      if (e.name !== "allStages") return;
      if (e.result && e.result.ok) overlay.finish("Saved " + e.result.count + " aligners"); else overlay.hide();
    }
  });

  function mount() {
    if (mounted) return;
    mounted = true;
    var host = document.createElement("div");
    host.id = "teeth-exporter-ui";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    var shadow = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
    globalThis.TeethPanel({
      mount: shadow,
      mode: "floating",
      adapter: {
        status: function () { return Promise.resolve(ctl.status()); },
        run: function (name, args) { return ctl.run(name, args); }
      }
    });
  }
})();
