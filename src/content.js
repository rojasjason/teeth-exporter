/*
 * content.js — extension glue (ISOLATED world). All behavior lives in controller.js; this file only
 * connects it to Chrome: badge updates go to background.js, and the popup's requests ("status",
 * "run <command>") are answered by the controller. The popup addresses the frame that captured the
 * scan (see background.js), so only that frame's controller answers.
 *
 * Loaded after lib/*, engine.js, stage_probe.js, all_stages.js, controller.js.
 */
(function () {
  "use strict";
  function send(m) { try { chrome.runtime.sendMessage(m); } catch (e) {} }

  var overlay = globalThis.TeethProgress ? globalThis.TeethProgress() : null;
  var ctl = globalThis.TeethController({
    onCapture: function (st) { send({ type: "wcc-captured", size: st.size }); },
    onStep: function (i) { send({ type: "stage-step", step: i.aligner, total: i.total }); },
    onProgress: function (p) { send({ type: "stage-step", step: p.aligner, total: p.total, progress: true }); if (overlay) overlay.update(p); },
    onRunStart: function (name) { if (overlay && name === "allStages") overlay.show({ onCancel: function () { ctl.cancel(); } }); },
    onRunEnd: function (e) {
      if (!overlay || e.name !== "allStages") return;
      if (e.result && e.result.ok) overlay.finish("Saved " + e.result.count + " aligners"); else overlay.hide();
    }
  });

  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || !msg.cmd) return;
    if (msg.cmd === "status") { reply(ctl.status()); return true; }
    if (msg.cmd === "run") { ctl.run(msg.name, msg.args).then(reply); return true; }
  });
})();
