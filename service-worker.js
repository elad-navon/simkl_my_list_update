const CACHE_NAME = "tvseries-shell-v4";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // GitHub Pages sits behind a CDN that caches responses for several
  // minutes regardless of the browser's own cache-control (no-store only
  // skips the *browser's* HTTP cache, not that edge layer) - a device
  // that isn't the one that just pushed can otherwise keep getting the
  // CDN's stale copy long after the deploy finished. A unique query
  // string on every request forces a cache miss at that edge too, while
  // caches.put/match below still key off the original request so the
  // offline fallback cache is unaffected.
  const bustedUrl = new URL(url);
  bustedUrl.searchParams.set("_sw", Date.now().toString());

  event.respondWith(
    fetch(bustedUrl.toString(), { cache: "no-store" })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
