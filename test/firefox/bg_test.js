
// TEST ONLY
chrome.runtime.onMessage.addListener(function (m, s, r) {
  if (!m || m.type !== "test-run") return;
  chrome.storage.session.get("scanFrame:" + s.tab.id, function (o) {
    var f = o["scanFrame:" + s.tab.id];
    chrome.tabs.sendMessage(s.tab.id, m.cmd === "status" ? { cmd: "status" } : { cmd: "run", name: m.name, args: m.args }, { frameId: f == null ? 0 : f }, function (res) {
      r(res === undefined ? { err: String(chrome.runtime.lastError && chrome.runtime.lastError.message) } : res);
    });
  });
  return true;
});

// TEST ONLY: site access state, and a switch to turn the real sites off (like a user can in about:addons)
chrome.runtime.onMessage.addListener(function (m, s, r) {
  if (m && m.type === "test-open-popup") { chrome.tabs.create({ url: chrome.runtime.getURL("src/popup.html") }, function () { r({ ok: true }); }); return true; }
  if (!m || (m.type !== "test-perms" && m.type !== "test-revoke")) return;
  var o = { origins: ["*://*.aligntech.com/*", "*://*.invisalign.com/*", "*://*.invisalign.cn/*", "*://*.clincheck.com/*"] };
  function report() { chrome.permissions.contains(o, function (v) { r({ has: v }); }); }
  if (m.type === "test-revoke") chrome.permissions.remove(o, report); else report();
  return true;
});
