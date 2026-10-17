// Fleet Operations service worker: lets Android install the site as an app.
// It never caches records or API calls; it only shows a short message when the phone is offline.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet Operations</title>
<body style="font-family:system-ui,sans-serif;background:#18212b;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><h1 style="font-size:22px">No internet connection</h1><p style="opacity:.8">Fleet Operations needs the internet to load your records.<br>Check the connection and try again.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#1f5f8b;color:#fff">Try again</button></div></body>`;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
