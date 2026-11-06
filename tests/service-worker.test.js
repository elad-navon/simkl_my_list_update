// service-worker.js, run in a stand-in for the browser: the worker's global
// (events, importScripts), the Cache Storage, and a network that answers from
// the project's own files - or with an error, or not at all (offline).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SITE = "https://elad-navon.github.io/my-watch-list/";

function worker({ host = SITE, fail = () => false, offline = () => false, version } = {}) {
  const handlers = {};
  const stores = new Map(); // cache name -> Map(url -> Response)
  const calls = [];
  const keyOf = req => (typeof req === "string" ? req : req.url);
  const strip = u => { const x = new URL(u); x.search = ""; return x.toString(); };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async put(req, res) { m.set(keyOf(req), res.clone()); },
        async match(req, opts = {}) {
          const k = keyOf(req);
          const hit = m.get(k) || (opts.ignoreSearch ? [...m].find(([u]) => strip(u) === strip(k)) : null);
          return hit ? (Array.isArray(hit) ? hit[1] : hit).clone() : undefined;
        },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  async function fetch(url) {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (offline()) throw new TypeError("Failed to fetch");
    const rel = u.pathname.replace(/^\/my-watch-list\//, "") || "index.html";
    if (fail(rel)) return new Response("boom", { status: 500 });
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("", { status: 404 });
    let body = fs.readFileSync(file);
    if (version && rel === "version.js") body = String(body).replace(/number:\s*\d+/, `number: ${version}`);
    const res = new Response(body, { status: 200 });
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  }
  const self = {
    location: new URL("service-worker.js", host),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({
    self, caches, fetch, Response, URL, Promise, console, Date, setTimeout,
    importScripts: (...files) => {
      for (const f of files) {
        let src = fs.readFileSync(path.join(ROOT, f), "utf8");
        if (version && /version\.js$/.test(f)) src = src.replace(/number:\s*\d+/, `number: ${version}`);
        vm.runInContext(src, context);
      }
    },
  });
  context.self.SITE_VERSION = undefined;
  vm.runInContext(fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8"), context);

  async function fire(type, extra = {}) {
    const waits = [];
    const event = { waitUntil: p => waits.push(p), ...extra };
    handlers[type](event);
    await Promise.all(waits);
    return event;
  }
  async function request(rel, { mode = "cors", destination = "" } = {}) {
    const url = new URL(rel, host).toString();
    let answer = null;
    const waits = [];
    handlers.fetch({ request: { url, method: "GET", mode, destination }, respondWith: p => { answer = p; }, waitUntil: p => waits.push(p) });
    if (!answer) return { handled: false };
    const res = await answer;
    await Promise.all(waits);
    return { handled: true, res };
  }
  return { fire, request, stores, calls, handlers };
}

const listed = () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
};

test("install keeps index.html and every script and stylesheet it lists, in a cache named after the version", async () => {
  const w = worker();
  await w.fire("install");
  const names = [...w.stores.keys()];
  assert.equal(names.length, 1);
  assert.match(names[0], /^tvseries-shell-v\d+$/);
  const kept = [...w.stores.get(names[0]).keys()].map(u => new URL(u).pathname.replace("/my-watch-list/", ""));
  for (const f of [...listed(), "style.css", "theme/cinematic.css", "index.html", "", "manifest.json"]) assert.ok(kept.includes(f), `${f} kept`);
  assert.ok(w.calls.every(c => /[?&]_sw=\d+/.test(c)), "every download past the CDN's copy");
});

test("a file that fails at install: nothing is kept, so the old version stays", async () => {
  const w = worker({ fail: rel => rel === "app/render.js" });
  await assert.rejects(w.fire("install"), /app\/render\.js: 500/);
  assert.equal(w.stores.size, 0);
});

test("opening the page and its files come from the kept copy, without the network", async () => {
  const w = worker();
  await w.fire("install");
  w.calls.length = 0;
  const page = await w.request("./", { mode: "navigate" });
  assert.match(await page.res.text(), /<title>My Watch List<\/title>/);
  const withQuery = await w.request("./?from=widget", { mode: "navigate" });
  assert.equal(withQuery.res.status, 200);
  const js = await w.request("app/main.js");
  assert.match(await js.res.text(), /serviceWorker/);
  assert.deepEqual(w.calls, []);
});

test("other files: from the network, kept when good, never when an error; the kept copy offline", async () => {
  let down = false, broken = false;
  const w = worker({ offline: () => down, fail: rel => broken && rel === "tools/import.html" });
  await w.fire("install");
  broken = true;
  const bad = await w.request("tools/import.html");
  assert.equal(bad.res.status, 500);
  broken = false;
  down = true;
  const offlineBad = await w.request("tools/import.html");
  assert.equal(offlineBad.res.type, "error", "the error wasn't kept, so offline there's nothing");
  down = false;
  const good = await w.request("tools/import.html?x=1");
  assert.equal(good.res.status, 200);
  down = true;
  const offlineGood = await w.request("tools/import.html?x=1");
  assert.equal(offlineGood.res.status, 200, "kept, so offline it's still there");
});

test("a new version: its own cache, and the old one is dropped when it takes over", async () => {
  const old = worker();
  await old.fire("install");
  const next = worker({ version: 99999 });
  for (const [name, m] of old.stores) next.stores.set(name, m); // the same browser's caches
  await next.fire("install");
  await next.fire("activate");
  assert.deepEqual([...next.stores.keys()], ["tvseries-shell-v99999"]);
});

test("on localhost it stays out of the way: nothing kept, nothing answered", async () => {
  const w = worker({ host: "http://localhost:8080/" });
  await w.fire("install");
  assert.equal(w.stores.size, 0);
  const r = await w.request("app/main.js");
  assert.equal(r.handled, false);
});

test("other sites' addresses are left to the browser", async () => {
  const w = worker();
  await w.fire("install");
  const r = await w.request("https://api.themoviedb.org/3/tv/1");
  assert.equal(r.handled, false);
});
