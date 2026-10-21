
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
