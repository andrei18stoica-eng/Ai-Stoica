// AI Stoica installable app (PWA). Nothing is cached: the interface and every answer always come from the
// server, so an update is visible at the next opening. Only when the network is down does opening the app
// show a short offline page instead of the browser's error.
const OFFLINE = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI Stoica</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#05070b;color:#edf3fb;font-family:system-ui,-apple-system,Segoe UI,sans-serif;text-align:center;padding:24px">
<div><h1 style="font-size:22px;margin:0 0 8px">AI Stoica nu este conectat</h1><p style="color:#8390a3;margin:0 0 18px">Verifică internetul și încearcă din nou.</p>
<button onclick="location.reload()" style="border:1px solid #2a8cff;background:#126bd0;color:#fff;border-radius:10px;padding:10px 16px;font:inherit">Reîncearcă</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

// Phone notifications for the Owner (Web Push from AI Stoica Cloud). A new account arrives as
// "Maria (maria@…) vrea să se conecteze. Permiți?" with Permite / Refuză. Android shows the two buttons on the
// notification; iPhone does not support buttons on web notifications, so tapping it opens the app on the same question.
const ICON = "./icons/icon-192.png";
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const access = data.kind === "access_request" && data.token;
  event.waitUntil(self.registration.showNotification(data.title || "AI Stoica", {
    body: data.body || "",
    tag: data.tag || undefined,
    icon: ICON,
    badge: ICON,
    data: { url: data.url || "/", token: access ? data.token : "" },
    requireInteraction: !!access,
    actions: access ? [{ action: "allow", title: "Permite" }, { action: "deny", title: "Refuză" }] : []
  }));
});

async function openApp(url) {
  const target = new URL(url || "/", self.location.origin).href;
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of open) {
    if (new URL(c.url).origin !== self.location.origin) continue;
    try { await c.focus(); } catch {}
    try { return await c.navigate(target); } catch { return c; }
  }
  return self.clients.openWindow(target);
}

async function decide(token, decision, url) {
  try {
    const r = await fetch(`/auth/access-requests/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "HTTP " + r.status);
    const who = d.name ? `${d.name} (${d.email})` : "Contul";
    await self.registration.showNotification(decision === "allow" ? "Acces permis" : "Acces refuzat", {
      body: decision === "allow" ? `${who} poate intra acum în AI Stoica.` : `${who} nu va putea intra în AI Stoica.`,
      icon: ICON, badge: ICON, tag: "access-result", data: { url: "/" }
    });
  } catch {
    // No network or the request was already answered: open the app on the same question.
    await openApp(url);
  }
}

self.addEventListener("notificationclick", event => {
  const n = event.notification, data = n.data || {};
  n.close();
  if (data.token && (event.action === "allow" || event.action === "deny")) event.waitUntil(decide(data.token, event.action, data.url));
  else event.waitUntil(openApp(data.url));
});
