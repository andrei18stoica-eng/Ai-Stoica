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
