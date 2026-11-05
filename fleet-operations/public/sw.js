// Fleet Operations service worker: lets Android install the site as an app, and opens it without signal.
// The page and its runtime are kept from the last visit and refreshed from the network whenever there is signal.
// Records and API calls are never cached here (the app keeps a driver's offline copy itself).
const CACHE = "fo-shell-v1", SHELL = ["/", "/claude-shim.js", "/manifest.webmanifest", "/icon-192.png"];
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet Operations</title>
<body style="font-family:system-ui,sans-serif;background:#0a1f16;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><h1 style="font-size:22px">No internet connection</h1><p style="opacity:.8">Fleet Operations needs the internet the first time it is opened on this phone.<br>Check the connection and try again.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 18px;border-radius:8px;border:0;background:#3b7d1e;color:#fff">Try again</button></div></body>`;
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
// Network first; a good answer refreshes the saved copy. Without signal, the saved copy.
async function fresh(req, key) {
  const c = await caches.open(CACHE);
  try { const r = await fetch(req); if (r.ok) c.put(key, r.clone()); return r; }
  catch { const hit = await c.match(key); if (hit) return hit; throw new Error("offline"); }
}
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/_blob/")) return;
  if (e.request.mode === "navigate") { e.respondWith(fresh(e.request, "/").catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }))); return; }
  if (SHELL.includes(u.pathname)) e.respondWith(fresh(e.request, u.pathname));
});
