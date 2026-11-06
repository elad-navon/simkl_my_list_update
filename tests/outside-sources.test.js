const test = require("node:test");
const assert = require("node:assert/strict");
const { createTmdbClient, createMdblist, createImageSources, metahubImages } = require("../outside-sources.js");

// A kept-copy store like the page's (readPersistedCache / writePersistedCache).
function persisted(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { m, read: async key => (m.has(key) ? m.get(key) : undefined), write: (key, v) => { m.set(key, v); } };
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// ---- TMDB ---------------------------------------------------------------------
test("TMDB: one request per show even when asked twice at once; the answer is kept", async () => {
  const calls = [];
  const store = persisted();
  const tmdb = createTmdbClient({ get: async (p, params) => { calls.push([p, params]); return { id: 1, name: "A" }; }, persisted: store });
  const [a, b] = await Promise.all([tmdb.getShow(1), tmdb.getShow(1)]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].append_to_response, "images,external_ids,content_ratings");
  assert.deepEqual(store.m.get("tmdbshow2:1"), { id: 1, name: "A" });
});

test("TMDB: a kept copy answers without a request; a failure is null and isn't kept", async () => {
  let calls = 0;
  const store = persisted({ "tmdbseason:5:2": { episodes: [] } });
  const tmdb = createTmdbClient({ get: async () => { calls++; throw new Error("down"); }, persisted: store });
  assert.deepEqual(await tmdb.getSeason(5, 2), { episodes: [] });
  assert.equal(calls, 0);
  assert.equal(await tmdb.getCredits(9), null);
  assert.equal(store.m.has("tmdbcredits:9"), false);
});

// ---- MDBList --------------------------------------------------------------------
test("MDBList: the four ratings, by source; unknown to MDBList is kept as nothing", async () => {
  const store = persisted();
  const md = createMdblist({
    fetch: async url => (url.includes("tt404") ? json({}, 404)
      : json({ ratings: [{ source: "imdb", value: 8.1 }, { source: "tomatoes", value: 91 }, { source: "trakt", value: null }] })),
    key: () => "k", persisted: store,
  });
  assert.deepEqual(await md.get("tt1"), { imdb: 8.1, tomatoes: 91, popcorn: null, trakt: null });
  assert.deepEqual(await md.get("tt404"), { imdb: null, tomatoes: null, popcorn: null, trakt: null });
  assert.ok(store.m.has("mdblist:tt404"));
});

test("MDBList: a refused key is said once and stops every request until a new key", async () => {
  let calls = 0, said = 0;
  const md = createMdblist({ fetch: async () => { calls++; return json({}, 401); }, key: () => "bad", persisted: persisted(), onRejected: () => said++ });
  await Promise.all([md.get("tt1"), md.get("tt2")]);
  await md.get("tt3");
  assert.equal(said, 1);
  assert.equal(md.disabled, true);
  assert.ok(calls <= 2, "nothing asked once refused");
  md.disabled = false;
  await md.get("tt4");
  assert.ok(calls >= 3, "asked again with a new key");
});

test("MDBList: at most five requests at a time; no key, no request", async () => {
  let active = 0, most = 0;
  const md = createMdblist({
    fetch: async () => { active++; most = Math.max(most, active); await new Promise(r => setTimeout(r, 5)); active--; return json({ ratings: [] }); },
    key: () => "k", persisted: persisted(),
  });
  await Promise.all(Array.from({ length: 12 }, (_, i) => md.get(`tt${i}`)));
  assert.equal(most, 5);
  const none = createMdblist({ fetch: async () => { throw new Error("asked"); }, key: () => "", persisted: persisted() });
  assert.equal(await none.get("tt1"), null);
});

// ---- The picker's extra pictures ------------------------------------------------
function imageSources({ fetch, tvmaze, store = persisted(), tokens = { v: null }, keys = { fanart: "f", tvdb: "t" }, rejected = [] }) {
  return createImageSources({
    fetchWithTimeout: fetch || (async () => json({}, 500)),
    tvmazeGet: tvmaze || (async () => json({}, 500)),
    persisted: store,
    fanartKey: () => keys.fanart,
    tvdbKey: () => keys.tvdb,
    tokenStore: { read: () => tokens.v, write: v => { tokens.v = v; } },
    onRejected: name => rejected.push(name),
    now: () => 1000,
  });
}

test("TVMaze and Metahub: posters and backgrounds resized, TheTVDB id noted, kept a week", async () => {
  const store = persisted();
  const src = imageSources({
    store,
    tvmaze: async url => (url.includes("lookup") ? json({ id: 7, externals: { thetvdb: 555 } })
      : json([
        { type: "poster", resolutions: { original: { url: "https://tvm/p.jpg" } } },
        { type: "background", resolutions: { original: { url: "https://tvm/b.jpg" } } },
        { type: "banner", resolutions: { original: { url: "https://tvm/x.jpg" } } },
      ])),
  });
  const out = await src.keyless("tt123");
  assert.equal(out.tvdbId, 555);
  assert.deepEqual(out.poster.map(p => p.src), ["TVMaze", "Metahub"]);
  assert.deepEqual(out.banner.map(p => p.src), ["TVMaze", "Metahub"]);
  assert.match(out.poster[0].url, /^https:\/\/wsrv\.nl\/.*w=342.*tvm%2Fp\.jpg/);
  assert.ok(store.m.has("extraimages2:tt123"));
});

test("TVMaze's picture list not there: shown but not kept; the lookup failing: nothing", async () => {
  const store = persisted();
  const partial = imageSources({ store, tvmaze: async url => (url.includes("lookup") ? json({ id: 7, externals: {} }) : json({}, 500)) });
  const out = await partial.keyless("tt1");
  assert.deepEqual(out.poster.map(p => p.src), ["Metahub"]);
  assert.equal(store.m.has("extraimages2:tt1"), false);
  const down = imageSources({ store, tvmaze: async () => json({}, 503) });
  assert.deepEqual((await down.keyless("tt2")).poster, []);
});

test("Fanart.tv: English posters by likes, backgrounds and thumbs as banners, the small preview as the tile", async () => {
  const src = imageSources({
    fetch: async () => json({
      tvposter: [{ url: "https://assets.fanart.tv/fanart/a.jpg", lang: "en", likes: "2" }, { url: "https://assets.fanart.tv/fanart/b.jpg", lang: "en", likes: "9" },
        { url: "https://assets.fanart.tv/fanart/c.jpg", lang: "de", likes: "50" }],
      showbackground: [{ url: "https://assets.fanart.tv/fanart/bg.jpg", likes: "1" }],
      tvthumb: [{ url: "https://assets.fanart.tv/fanart/th.jpg", likes: "3" }],
    }),
  });
  const out = await src.fanart(42);
  assert.deepEqual(out.poster.map(p => p.thumb), ["https://assets.fanart.tv/preview/b.jpg", "https://assets.fanart.tv/preview/a.jpg"]);
  assert.deepEqual(out.banner.map(p => p.thumb), ["https://assets.fanart.tv/preview/th.jpg", "https://assets.fanart.tv/preview/bg.jpg"]);
});

test("a refused Fanart.tv key: said once, no more requests until reset", async () => {
  let calls = 0;
  const rejected = [];
  const src = imageSources({ rejected, fetch: async () => { calls++; return json({}, 401); } });
  await src.fanart(1);
  await src.fanart(2);
  assert.deepEqual(rejected, ["Fanart.tv"]);
  assert.equal(calls, 1);
  assert.equal(src.rejected("fanart"), true);
  src.resetRejected();
  await src.fanart(3);
  assert.equal(calls, 2);
});

test("TheTVDB: the kept token is used; on a 401 one fresh login and a retry; English pictures by score", async () => {
  const seen = [];
  const tokens = { v: { key: "t", token: "old", at: 900 } };
  const src = imageSources({
    tokens,
    fetch: async (url, opts = {}) => {
      seen.push(`${url.replace("https://api4.thetvdb.com/v4", "")} ${(opts.headers || {}).Authorization || ""}`.trim());
      if (url.endsWith("/login")) return json({ data: { token: "new" } });
      if (opts.headers.Authorization === "Bearer old") return json({}, 401);
      const type = new URL(url).searchParams.get("type");
      return json({ data: { artworks: type === "2"
        ? [{ image: "https://tvdb/p1.jpg", language: "eng", score: 1 }, { image: "https://tvdb/p2.jpg", language: null, score: 5 }, { image: "https://tvdb/p3.jpg", language: "heb", score: 99 }]
        : [{ image: "https://tvdb/b1.jpg", thumbnail: "https://tvdb/b1_t.jpg", score: 0 }] } });
    },
  });
  const out = await src.tvdb(77);
  assert.equal(seen.filter(s => s === "/login").length, 1, "one login for both lists");
  assert.equal(tokens.v.token, "new");
  assert.deepEqual(out.poster.map(p => p.url.includes("p2") ? "p2" : "p1"), ["p2", "p1"]);
  assert.equal(out.banner[0].thumb, "https://tvdb/b1_t.jpg");
});

test("Metahub: only for a real IMDb id", () => {
  assert.equal(metahubImages("tt42").poster.length, 1);
  assert.deepEqual(metahubImages("nonsense"), { poster: [], banner: [] });
});
