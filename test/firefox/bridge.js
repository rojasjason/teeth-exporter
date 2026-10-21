// TEST ONLY: page sets data-te-cmd, this asks the background to message the frame like the popup does
(function(){
  var de = document.documentElement;
  new MutationObserver(function(){
    var c = de.getAttribute("data-te-cmd"); if (!c) return; de.removeAttribute("data-te-cmd");
    var m = JSON.parse(c);
    if (m.cmd === "perms" || m.cmd === "revoke" || m.cmd === "open-popup") {
      chrome.runtime.sendMessage({ type: "test-" + m.cmd }, function (r) { de.setAttribute("data-te-result-" + m.id, JSON.stringify(r || null)); });
      return;
    }
    chrome.runtime.sendMessage({ type: "test-run", cmd: m.cmd, name: m.name, args: m.args || {} }, function (r) {
      de.setAttribute("data-te-result-" + m.id, JSON.stringify(r === undefined ? { none: String(chrome.runtime.lastError && chrome.runtime.lastError.message) } : r));
    });
  }).observe(de, { attributes: true });
})();
