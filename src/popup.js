/*
 * popup.js — the extension popup. Draws the shared panel (ui_panel.js) and hands it an adapter
 * that messages the tab's content script (content.js -> controller.js).
 */
(function () {
  "use strict";

  // talk ONLY to the frame that captured the scan: the viewer is usually an iframe, and a tab-wide
  // message gets the top frame's "no scan" answer first. No capture recorded yet = top frame.
  function sendToTab(payload) {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var tab = tabs && tabs[0];
        if (!tab) { resolve(null); return; }
        chrome.runtime.sendMessage({ type: "get-scan-frame", tabId: tab.id }, function (r) {
          if (chrome.runtime.lastError) r = null;
          var frameId = (r && r.frameId != null) ? r.frameId : 0;
          chrome.tabs.sendMessage(tab.id, payload, { frameId: frameId }, function (resp) {
            if (chrome.runtime.lastError) { resolve(null); return; }   // no content script answering
            resolve(resp || null);
          });
        });
      });
    });
  }

  // the sites in the manifest; Firefox can leave these switched off, and then nothing gets captured
  var origins = chrome.runtime.getManifest().host_permissions || [];

  document.body.style.margin = "0";
  globalThis.TeethPanel({
    mount: document.body,
    mode: "popup",
    access: {
      check: function () { return new Promise(function (r) { chrome.permissions.contains({ origins: origins }, function (v) { r(v !== false); }); }); },
      request: function () { return new Promise(function (r) { chrome.permissions.request({ origins: origins }, function (v) { r(!!v); }); }); }
    },
    adapter: {
      status: function () { return sendToTab({ cmd: "status" }); },
      run: function (name, args) { return sendToTab({ cmd: "run", name: name, args: args }); }
    }
  });
})();
