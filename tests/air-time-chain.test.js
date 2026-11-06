const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const EpisodeSource = require("../episode-source.js");
const { createAirTimeChain, createTvdbCheck, israeliShowInfo } = require("../air-time-chain.js");
const { createTvdbClient } = require("../tools/emby-bridge/tvdb-check.js");

const NOW = Date.parse("2026-11-06T12:00:00Z");
const DAY = 86400000;
const day = n => new Date(NOW + n * DAY).toISOString().slice(0, 10);
const ids = { tmdb: 1, tvdb: 101 };

// ---- The chain --------------------------------------------------------------
test("the steps run in order - yes, then SIMKL, then TheTVDB - each on what the one before returned", async () => {
  const seen = [];
  const step = name => async (_, eps) => { seen.push([name, eps.map(e => e.by || "")]); return eps.map(e => ({ ...e, by: `${e.by || ""}${name}` })); };
  const chain = createAirTimeChain({ tvdb: step("T"), simkl: step("S"), yes: step("Y") });
  const out = await chain(ids, [{ season: 1, episode: 1 }]);
  assert.deepEqual(seen, [["Y", [""]], ["S", ["Y"]], ["T", ["YS"]]]);
  assert.equal(out[0].by, "YST");
});

test("a step that fails or answers nonsense leaves the episodes as they were; the next still runs", async () => {
  const eps = [{ season: 1, episode: 1 }];
  const chain = createAirTimeChain({
    yes: async () => { throw new Error("yes is down"); },
    simkl: () => { throw new Error("thrown at once"); },
    tvdb: async () => "not a list",
  });
  assert.equal(await chain(ids, eps), eps);
  const after = createAirTimeChain({ yes: async () => { throw new Error("x"); }, tvdb: async (_, e) => e.map(x => ({ ...x, ok: true })) });
  assert.equal((await after(ids, eps))[0].ok, true);
});

test("missing steps are skipped", async () => {
  const eps = [{ season: 1, episode: 1 }];
  assert.equal(await createAirTimeChain({})(ids, eps), eps);
});

test("israeliShowInfo: by origin country or original language, with both names", () => {
  assert.deepEqual(israeliShowInfo({ origin_country: ["IL"], original_language: "en", name: "Fauda", original_name: "פאודה" }), { israeli: true, names: ["Fauda", "פאודה"] });
  assert.equal(israeliShowInfo({ origin_country: ["US"], original_language: "he", name: "x", original_name: "y" }).israeli, true);
  assert.equal(israeliShowInfo({ origin_country: ["US"], original_language: "en", name: "x", original_name: "x" }).israeli, false);
  assert.equal(israeliShowInfo(null), null);
});

// ---- TheTVDB's check ----------------------------------------------------------
function tvdbCheck({ check, tmdb = null, streaming = false, enabled = () => true }) {
  const calls = [];
  const fn = createTvdbCheck({
    EpisodeSource,
    source: { getSourceLists: async () => ({ tmdb }), streamingHome: async () => streaming },
    recentEpisodes: async id => { calls.push(id); return check; },
    enabled,
    now: () => NOW,
  });
  return { fn, calls };
}

test("TheTVDB two days later: the episode waits for their day", async () => {
  const { fn } = tvdbCheck({ check: [{ season: 1, episode: 2, date: day(3) }] });
  const out = await fn(ids, [{ season: 1, episode: 2, date: day(1) }]);
  assert.equal(out[0].date, day(3));
  assert.equal(out[0].heldBy, "tvdb");
});

test("a streaming show is never held back", async () => {
  const { fn } = tvdbCheck({ check: [{ season: 1, episode: 2, date: day(3) }], streaming: true });
  const out = await fn(ids, [{ season: 1, episode: 2, date: day(1) }]);
  assert.equal(out[0].date, day(1));
});

test("TheTVDB earlier, with TMDB agreeing: the episode comes forward", async () => {
  const { fn } = tvdbCheck({ check: [{ season: 1, episode: 2, date: day(1) }], tmdb: [{ season: 1, episode: 2, date: day(1) }] });
  const out = await fn(ids, [{ season: 1, episode: 2, date: day(4) }]);
  assert.equal(out[0].date, day(1));
});

test("TheTVDB isn't asked: no episode within two weeks, no TheTVDB id, or switched off", async () => {
  const far = tvdbCheck({ check: [] });
  await far.fn(ids, [{ season: 1, episode: 2, date: day(30) }]);
  assert.deepEqual(far.calls, []);
  const noId = tvdbCheck({ check: [] });
  await noId.fn({ tmdb: 1 }, [{ season: 1, episode: 2, date: day(1) }]);
  assert.deepEqual(noId.calls, []);
  const off = tvdbCheck({ check: [], enabled: () => false });
  await off.fn(ids, [{ season: 1, episode: 2, date: day(1) }]);
  assert.deepEqual(off.calls, []);
});

// ---- The bridge's TheTVDB client -----------------------------------------------
function fakeTvdb({ refuse = false } = {}) {
  const calls = [];
  let logins = 0;
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, options = {}) => {
    calls.push(url.replace("https://api4.thetvdb.com/v4", ""));
    if (url.endsWith("/login")) { logins++; return refuse ? json({}, 401) : json({ data: { token: `t${logins}` } }); }
    // The first token has run out: one 401, then the fresh one works.
    if (options.headers.Authorization === "Bearer t1") return json({}, 401);
    const page = Number(new URL(url).searchParams.get("page"));
    return json({
      data: { episodes: page === 0 ? [{ seasonNumber: 1, number: 1, aired: day(-60) }, { seasonNumber: 1, number: 2, aired: day(2) }] : [{ seasonNumber: 1, number: 3, aired: day(9) }] },
      links: { next: page === 0 ? "more" : null },
    });
  };
  return { fetch, calls };
}

test("bridge client: logs in, reads every page from a month back, signs in again once on a 401, keeps the list", async () => {
  const fake = fakeTvdb();
  const client = createTvdbClient({ key: "k", fetch: fake.fetch, now: () => NOW });
  const list = await client.recentEpisodes(101);
  assert.deepEqual(list, [{ season: 1, episode: 2, date: day(2) }, { season: 1, episode: 3, date: day(9) }]);
  assert.equal(fake.calls.filter(c => c === "/login").length, 2);
  const before = fake.calls.length;
  await client.recentEpisodes(101);
  assert.equal(fake.calls.length, before, "kept for a while, not asked again");
  assert.equal(client.rejected(), false);
});

test("bridge client: a refused key gives no list and says so", async () => {
  const client = createTvdbClient({ key: "bad", fetch: fakeTvdb({ refuse: true }).fetch, now: () => NOW });
  assert.equal(await client.recentEpisodes(101), null);
  assert.equal(client.rejected(), true);
});

// ---- Both sides use the chain ------------------------------------------------
// The bug this file came from: the bridge built its own chain without yes.
test("the site and the bridge both build their air times with the chain, yes included", () => {
  const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  for (const f of ["app/library.js", "tools/emby-bridge/run.js"]) {
    const src = read(f);
    assert.match(src, /AirTimeChain\.createAirTimeChain\(\{[^}]*yes:/, `${f}: the chain, with a yes step`);
    assert.match(src, /YesTimes\.createYesAirTimes\(/, `${f}: yes's step`);
  }
});
