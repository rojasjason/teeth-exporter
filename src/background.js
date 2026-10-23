/*
 * background.js: MV3 service worker. Badges the toolbar icon when a scan is captured in a tab,
 * and remembers WHICH FRAME captured it. The viewer usually lives in an iframe
 * (con-share-tx-plan-*.aligntech.com inside my.invisalign.com); a tab-wide message is answered
 * first by the top frame, which has no scan, so the popup must address the capturing frame.
 * Stored in storage.session because the service worker can be stopped between clicks.
 */
function frameKey(tabId) { return "scanFrame:" + tabId; }
function fmtSize(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
  if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
  return Math.round(b / 1024) + " KB";
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;
  if (msg.type === "get-scan-frame" && msg.tabId != null) {
    chrome.storage.session.get(frameKey(msg.tabId), function (o) {
      var f = o && o[frameKey(msg.tabId)];
      sendResponse({ frameId: (typeof f === "number") ? f : null });
    });
    return true;                                            // async reply
  }
  var tabId = sender && sender.tab && sender.tab.id;
  if (msg.type === "wcc-captured" && tabId != null) {
    var rec = {}; rec[frameKey(tabId)] = (sender.frameId != null) ? sender.frameId : 0;
    chrome.storage.session.set(rec);
    chrome.action.setBadgeText({ tabId: tabId, text: "OK" });
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#2BB58A" });
    chrome.action.setTitle({ tabId: tabId, title: "Teeth Exporter: scan ready (" + fmtSize(msg.size || 0) + ")" });
  }
  // a scan this version can't read: point the popup at that frame (unless a readable scan already
  // claimed the tab) so it can say so, and mark the icon
  if (msg.type === "wcc-unreadable" && tabId != null) {
    chrome.storage.session.get(frameKey(tabId), function (o) {
      if (o && typeof o[frameKey(tabId)] === "number") return;
      var rec = {}; rec[frameKey(tabId)] = (sender.frameId != null) ? sender.frameId : 0;
      chrome.storage.session.set(rec);
      chrome.action.setBadgeText({ tabId: tabId, text: "?" });
      chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#D9822B" });
      chrome.action.setTitle({ tabId: tabId, title: "Teeth Exporter: found a scan this version can't read yet" });
    });
  }
  // live aligner-step badge: reflect the step the user is currently viewing
  if (msg.type === "stage-step" && tabId != null && msg.step != null) {
    chrome.action.setBadgeText({ tabId: tabId, text: "A" + msg.step });           // the viewer's aligner number
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#2BB58A" });
    chrome.action.setTitle({ tabId: tabId, title: "Teeth Exporter: aligner " + msg.step + (msg.total ? " / " + msg.total : "") + (msg.progress ? " (capturing)" : " (current view)") });
  }
});

// clear the badge when navigating away / reloading
chrome.tabs.onUpdated.addListener(function (tabId, info) {
  if (info.status === "loading") {
    chrome.action.setBadgeText({ tabId: tabId, text: "" });
    chrome.storage.session.remove(frameKey(tabId));
  }
});
chrome.tabs.onRemoved.addListener(function (tabId) { chrome.storage.session.remove(frameKey(tabId)); });
