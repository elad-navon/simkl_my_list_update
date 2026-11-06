// The page's offline copy and its fast start.
//
// The page's own files (index.html and every script and stylesheet it lists,
// read from index.html itself - no list here to forget a new file in) are
// kept in a cache named after the site version (version.js), and the page
// opens from it at once. A deploy bumps the version: the browser sees a new
// service worker (main.js asks on every load and every return to the page),
// which fetches the new files - straight from GitHub, past its CDN's copy -
// into a new cache, all or nothing, and takes over; the page then reloads
// itself when it's out of sight or left alone (main.js). Other files of the
// site (the theme's pictures, icons) come from the cache when there and are
// refreshed behind it; anything else goes to the network, with the last good
// copy kept for offline use. Only good answers are ever kept.
//
// On localhost it stays out of the way, so a change shows on the next reload.
importScripts("./version.js");
const CACHE_NAME = `tvseries-shell-v${self.SITE_VERSION.number}`;
const DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);
// What the page needs that index.html doesn't list as a script or stylesheet.
const EXTRA_FILES = ["./", "./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

// A unique query string makes GitHub Pages' CDN (which keeps its copies for
// minutes after a deploy) answer from the site itself; the cache still keys
// on the plain address.
function fresh(url) {
  const u = new URL(url, self.location.href);
  u.searchParams.set("_sw", Date.now().toString());
  return fetch(u.toString(), { cache: "no-store" });
}

// index.html's scripts and stylesheets, as addresses on this site.
async function shellFiles() {
  const res = await fresh("./index.html");
  if (!res.ok) throw new Error(`index.html: ${res.status}`);
  const html = await res.text();
  const refs = [
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map(m => m[1]),
  ];
  const own = refs.filter(r => !/^[a-z]+:|^\/\//i.test(r));
  return [...new Set([...EXTRA_FILES, ...own.map(r => (r.startsWith("./") ? r : `./${r}`))])];
}

self.addEventListener("install", event => {
  self.skipWaiting();
  if (DEV) return;
  event.waitUntil((async () => {
    const files = await shellFiles();
    const answers = await Promise.all(files.map(async f => {
      const res = await fresh(f);
      if (!res.ok) throw new Error(`${f}: ${res.status}`); // all or nothing: the old version stays
      return [f, res];
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(answers.map(([f, res]) => cache.put(new URL(f, self.location.href).toString(), res)));
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE_NAME) await caches.delete(key);
    await self.clients.claim();
  })());
});

const keep = (req, res) => {
  if (res && res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener("fetch", event => {
  const req = event.request;
  if (DEV || req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Opening the page: the kept index.html (with or without a query string).
    if (req.mode === "navigate") {
      const page = await cache.match(new URL("./", self.location.href).toString(), { ignoreSearch: true })
        || await cache.match(req, { ignoreSearch: true });
      if (page) return page;
      return fresh(req.url).then(res => keep(req, res)).catch(() => Response.error());
    }
    const hit = await cache.match(req);
    // The page's own files: always the kept copy of this version.
    if (hit && !url.search) {
      // Pictures and fonts kept on the way: refreshed behind the kept copy.
      if (["image", "font"].includes(req.destination)) event.waitUntil(fresh(req.url).then(res => keep(req, res)).catch(() => {}));
      return hit;
    }
    // Anything else: the network, the kept copy when offline.
    try {
      return keep(req, await fresh(req.url));
    } catch (e) {
      return hit || (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
