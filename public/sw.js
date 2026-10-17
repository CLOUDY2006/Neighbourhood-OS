const SHELL = "nos-shell-v2";
const MAPS = "nos-maps-v2";

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])).catch(() => undefined));
});
// Drop older shell caches so a bad copy saved while the server was failing is not reused.
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith("nos-shell-") && k !== SHELL) || (k.startsWith("nos-maps-") && k !== MAPS)).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEIGHBORHOOD OS</title>' +
  '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.25rem;line-height:1.5"><h1>Cannot reach the server</h1>' +
  '<p>Check your connection, or wait a few seconds if the site was asleep, then reload this page.</p>';

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      const home = await cache.match("/");
      if (home) return home;
      return new Response(OFFLINE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    throw err;
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(MAPS);
  const hit = await cache.match(req.url);
  const fresh = fetch(req).then(res => { if (res.ok && res.headers.get("X-Map-Status") !== "none") cache.put(req.url, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/api\/n\/[^/]+\/map$/.test(url.pathname)) { e.respondWith(staleWhileRevalidate(req)); return; }
  if (url.pathname.startsWith("/api/")) return;
  e.respondWith(networkFirst(req));
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data.json(); } catch (err) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || "NEIGHBORHOOD OS", { body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => (cs[0] ? cs[0].focus() : self.clients.openWindow((e.notification.data && e.notification.data.url) || "/"))));
});
self.addEventListener("message", e => { if (e.data === "clear") e.waitUntil(caches.delete(MAPS)); });