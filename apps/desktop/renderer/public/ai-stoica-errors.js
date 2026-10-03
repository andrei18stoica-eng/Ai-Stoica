(function () {
  var shown = {};
  function host() {
    var el = document.getElementById("aiStoicaToasts");
    if (!el) {
      el = document.createElement("div");
      el.id = "aiStoicaToasts";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    return el;
  }
  function toast(message, kind) {
    var text = String(message || "").trim();
    if (!text) return;
    var now = Date.now();
    if (shown[text] && now - shown[text] < 3000) return;
    shown[text] = now;
    var item = document.createElement("div");
    item.className = "aiToast " + (kind === "ok" ? "ok" : kind === "info" ? "info" : "error");
    var span = document.createElement("span");
    span.textContent = text;
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Închide notificarea");
    close.textContent = "×";
    close.onclick = function () { item.remove(); };
    item.appendChild(span);
    item.appendChild(close);
    host().appendChild(item);
    setTimeout(function () { item.remove(); }, kind === "error" || !kind ? 9000 : 4500);
  }
  function describe(err) {
    if (err && err.name === "AbortError") return "";
    var message = String((err && err.message) || err || "Eroare necunoscută.");
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      message = "Nu pot contacta serviciul AI Stoica. Verifică dacă aplicația rulează și conexiunea la internet, apoi încearcă din nou.";
    }
    return "AI Stoica: " + message;
  }
  window.aiStoicaToast = toast;
  window.addEventListener("unhandledrejection", function (event) {
    var message = describe(event.reason);
    if (!message) return;
    console.error("AI Stoica action failed", event.reason);
    toast(message, "error");
  });
  window.addEventListener("error", function (event) {
    if (!event || (!event.error && !event.message)) return;
    if (event.target && event.target !== window) return;
    if (/ResizeObserver loop|^Script error\.?$/i.test(String(event.message || ""))) return;
    var message = describe(event.error || event.message);
    if (!message) return;
    console.error("AI Stoica error", event.error || event.message);
    toast(message, "error");
  });
})();
