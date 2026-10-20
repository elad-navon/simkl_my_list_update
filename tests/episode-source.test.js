const test = require("node:test");
const assert = require("node:assert/strict");
const { createEpisodeSource, memoryCache } = require("../episode-source.js");

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

// A fake TVMaze: `routes` maps a path to a body (or a function returning a
// response); every call is recorded.
function fakeFetch(routes) {
  const calls = [];
  const fn = async url => {
    const path = url.replace("https://api.tvmaze.com", "");
    calls.push(path);
    const r = routes[path];
    if (r === undefined) return jsonRes(404, null);
    return typeof r === "function" ? r(calls.filter(c => c === path).length) : jsonRes(200, r);
  };
  fn.calls = calls;
  return fn;
}

function fakeTmdb(shows) {
  const calls = [];
  const fn = async path => {
    calls.push(path);
    let m = /^\/tv\/(\d+)$/.exec(path);
    if (m) {
      const s = shows[m[1]];
      return s ? { seasons: Object.keys(s).map(n => ({ season_number: Number(n) })) } : null;
    }
    m = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(path);
    if (m) return { episodes: shows[m[1]][m[2]] };
    return null;
  };
  fn.calls = calls;
  return fn;
}

const TVM_EPISODES = [
  { id: 11, season: 1, number: 1, name: "Pilot", airdate: "2026-01-05", airtime: "21:00", airstamp: "2026-01-06T02:00:00+00:00", runtime: 50 },
  { id: 12, season: 1, number: 2, name: "Two", airdate: "2026-01-12", airtime: "", airstamp: "2026-01-12T12:00:00+00:00", runtime: 50 },
  { id: 13, season: 1, number: null, name: "Special", airdate: "2026-01-15", airtime: "", airstamp: null, runtime: 30 },
];

test("TVMaze episodes: exact time only when the air time is known; specials dropped", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5, name: "Show" }, "/shows/5/episodes": TVM_EPISODES }),
    tmdbGet: fakeTmdb({}), minGapMs: 0,
  });
  const r = await src.getEpisodes({ imdb: "tt1" });
  assert.equal(r.source, "tvmaze");
  assert.equal(r.tvmazeId, 5);
  assert.equal(r.episodes.length, 2);
  assert.equal(r.episodes[0].date, "2026-01-06T02:00:00+00:00");
  assert.equal(r.episodes[0].hasTime, true);
  assert.equal(r.episodes[1].date, "2026-01-12", "no air time -> date only, never a made-up time");
  assert.equal(r.episodes[1].hasTime, false);
  assert.deepEqual(r.episodes[0].keys, ["tvmaze:11"]);
});

test("TMDB ids are linked only when numbers and dates agree", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": TVM_EPISODES }),
    tmdbGet: fakeTmdb({ 77: { 1: [
      { id: 901, episode_number: 1, air_date: "2026-01-05", name: "Pilot", runtime: 52 },
      { id: 902, episode_number: 2, air_date: "2026-02-20", name: "Two" },
      { id: 903, episode_number: 3, air_date: "2026-01-19", name: "Three" },
    ] } }),
    minGapMs: 0,
  });
  const r = await src.getEpisodes({ tmdb: 77, imdb: "tt1" });
  assert.deepEqual(r.episodes[0].keys, ["tvmaze:11", "tmdb:901"]);
  assert.deepEqual(r.episodes[1].keys, ["tvmaze:12"], "dates 39 days apart: not linked");
  assert.deepEqual(r.disagreements, [{ season: 1, episode: 2, tvmaze: "2026-01-12", tmdb: "2026-02-20" }]);
  assert.deepEqual(r.onlyInTmdb, [{ season: 1, episode: 3 }]);
  assert.deepEqual(r.onlyInTvmaze, []);
});

test("Falls back to TMDB (date only) when TVMaze has no match", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({}),
    tmdbGet: fakeTmdb({ 77: { 0: [{ id: 900, episode_number: 1, air_date: "2025-01-01" }], 1: [{ id: 901, episode_number: 1, air_date: "2026-01-05", name: "Pilot" }] } }),
    minGapMs: 0,
  });
  const r = await src.getEpisodes({ tmdb: 77, imdb: "tt404" });
  assert.equal(r.source, "tmdb");
  assert.equal(r.episodes.length, 1, "season 0 (specials) skipped");
  assert.equal(r.episodes[0].date, "2026-01-05");
  assert.equal(r.episodes[0].hasTime, false);
  assert.deepEqual(r.episodes[0].keys, ["tmdb:901"]);
});

test("prefer: tmdb pins TMDB's numbering, still linked to TVMaze where dates agree", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": TVM_EPISODES }),
    tmdbGet: fakeTmdb({ 77: { 1: [
      { id: 901, episode_number: 1, air_date: "2026-01-05" },
      { id: 902, episode_number: 2, air_date: "2026-02-20" },
    ] } }),
    minGapMs: 0,
  });
  const r = await src.getEpisodes({ tmdb: 77, imdb: "tt1" }, { prefer: "tmdb" });
  assert.equal(r.source, "tmdb");
  assert.deepEqual(r.episodes.map(e => e.keys), [["tmdb:901", "tvmaze:11"], ["tmdb:902"]]);
  assert.equal(r.episodes[0].date, "2026-01-06T02:00:00+00:00", "TVMaze's exact time for the same episode");
  assert.equal(r.disagreements.length, 1);
  const lists = await src.getSourceLists({ tmdb: 77, imdb: "tt1" });
  assert.equal(lists.tvmaze.length, 2);
  assert.equal(lists.tmdb.length, 2);
});

test("appendUpcoming: adds only upcoming episodes the main source lacks", () => {
  const { appendUpcoming } = require("../episode-source.js");
  const NOWMS = Date.parse("2026-10-12T12:00:00Z");
  const base = [{ season: 5, episode: 10, date: "2026-03-01T01:00:00Z", keys: ["tvmaze:1"] }];
  const extra = [
    { season: 5, episode: 9, date: "2026-02-20", keys: ["tmdb:9"] },          // past: never added
    { season: 5, episode: 10, date: "2026-03-01", keys: ["tmdb:10"] },         // already there
    { season: 6, episode: 1, date: "2026-10-29", keys: ["tmdb:61"] },          // upcoming: added
    { season: 6, episode: 2, date: null, keys: ["tmdb:62"] },                  // undated: added (not aired)
  ];
  const r = appendUpcoming(base, extra, NOWMS);
  assert.deepEqual(r.episodes.map(e => `${e.season}-${e.episode}`), ["5-10", "6-1", "6-2"]);
  assert.equal(r.added, 2);
  const snapshot = [{ season: 1, episode: 1, date: "2026-11-05T19:00:00+02:00" }];
  const later = [{ season: 1, episode: 7, date: "2026-11-01" }, { season: 1, episode: 8, date: "2026-11-09" }];
  assert.deepEqual(appendUpcoming(snapshot, later, NOWMS, { afterBaseEnd: true }).episodes.map(e => e.episode), [1, 8]);
});

test("getEpisodes: a season TVMaze hasn't listed yet still comes from TMDB", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": TVM_EPISODES }),
    tmdbGet: fakeTmdb({ 77: { 1: [{ id: 901, episode_number: 1, air_date: "2026-01-05" }], 2: [{ id: 921, episode_number: 1, air_date: "2099-01-01" }] } }),
    minGapMs: 0,
  });
  const r = await src.getEpisodes({ tmdb: 77, imdb: "tt1" });
  assert.equal(r.source, "tvmaze");
  assert.equal(r.upcomingFromOther, 1);
  assert.deepEqual(r.episodes.at(-1).keys, ["tmdb:921"]);
});

test("No source at all is reported, not thrown", async () => {
  const src = createEpisodeSource({ fetch: fakeFetch({}), tmdbGet: fakeTmdb({}), minGapMs: 0 });
  const r = await src.getEpisodes({ tmdb: 1, imdb: "tt0" });
  assert.equal(r.source, "none");
  assert.deepEqual(r.episodes, []);
});

test("TheTVDB id is tried when the IMDb lookup finds nothing", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?thetvdb=999": { id: 5 }, "/shows/5/episodes": TVM_EPISODES }),
    tmdbGet: fakeTmdb({}), minGapMs: 0,
  });
  const r = await src.getEpisodes({ imdb: "tt0", tvdb: 999 });
  assert.equal(r.source, "tvmaze");
});

test("A 429 from TVMaze waits and retries", async () => {
  const fetch = fakeFetch({
    "/lookup/shows?imdb=tt1": n => (n === 1 ? jsonRes(429, null) : jsonRes(200, { id: 5 })),
    "/shows/5/episodes": TVM_EPISODES,
  });
  const src = createEpisodeSource({ fetch, tmdbGet: fakeTmdb({}), minGapMs: 0 });
  const r = await src.getEpisodes({ imdb: "tt1" });
  assert.equal(r.source, "tvmaze");
  assert.equal(fetch.calls.filter(c => c.startsWith("/lookup")).length, 2);
});

test("TVMaze errors are reported in `errors` and TMDB still answers", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?imdb=tt1": () => jsonRes(500, null) }),
    tmdbGet: fakeTmdb({ 77: { 1: [{ id: 901, episode_number: 1, air_date: "2026-01-05" }] } }),
    minGapMs: 0,
  });
  const r = await src.getEpisodes({ tmdb: 77, imdb: "tt1" });
  assert.equal(r.source, "tmdb");
  assert.equal(r.errors.length, 1);
});

test("Simultaneous requests for one show share a single fetch; the cache serves repeats", async () => {
  const fetch = fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": TVM_EPISODES });
  const tmdb = fakeTmdb({});
  const src = createEpisodeSource({ fetch, tmdbGet: tmdb, cache: memoryCache(), minGapMs: 0 });
  await Promise.all([src.getEpisodes({ imdb: "tt1" }), src.getEpisodes({ imdb: "tt1" })]);
  await src.getEpisodes({ imdb: "tt1" });
  assert.equal(fetch.calls.length, 2, "one lookup + one episode list");
});

test("A known TVMaze id skips the lookup", async () => {
  const fetch = fakeFetch({ "/shows/5/episodes": TVM_EPISODES });
  const src = createEpisodeSource({ fetch, tmdbGet: fakeTmdb({}), minGapMs: 0 });
  const r = await src.getEpisodes({ imdb: "tt1", tvmaze: 5 });
  assert.equal(r.episodes.length, 2);
  assert.deepEqual(fetch.calls, ["/shows/5/episodes"]);
});

// A cache whose answers are promises (like IndexedDB) and whose entries can
// be aged by hand.
function asyncCache() {
  const map = new Map();
  return {
    map,
    async get(key, ttl) { const h = map.get(key); return h && Date.now() - h.t < ttl ? h.v : undefined; },
    async set(key, v) { map.set(key, { t: Date.now(), v }); },
    age(key, ms) { const h = map.get(key); h.t -= ms; if (h.v && h.v.fetchedAt) h.v.fetchedAt -= ms; },
  };
}

test("With TVMaze's update list, a cached episode list is kept until TVMaze reports the show changed", async () => {
  const cache = asyncCache();
  const nowSec = Math.floor(Date.now() / 1000);
  let updates = {};
  const fetch = fakeFetch({
    "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": TVM_EPISODES,
    "/updates/shows?since=week": () => jsonRes(200, updates),
  });
  const make = () => createEpisodeSource({ fetch, tmdbGet: fakeTmdb({}), cache, minGapMs: 0, useUpdates: true });

  await make().getEpisodes({ imdb: "tt1" });
  assert.equal(fetch.calls.filter(c => c === "/shows/5/episodes").length, 1);

  // A day later (past the plain 6-hour expiry), nothing changed on TVMaze:
  // the next page load keeps the copy.
  cache.age("tvmaze-episodes2:5", 24 * 3600 * 1000);
  await make().getEpisodes({ imdb: "tt1" });
  assert.equal(fetch.calls.filter(c => c === "/shows/5/episodes").length, 1);

  // TVMaze reports the show updated after the copy was taken: fetched again.
  updates = { 5: nowSec };
  await make().getEpisodes({ imdb: "tt1" });
  assert.equal(fetch.calls.filter(c => c === "/shows/5/episodes").length, 2);
  assert.equal(fetch.calls.filter(c => c.startsWith("/updates")).length, 2, "asked once per session, only when there is a cached copy to check");
});

test("If TVMaze's update list can't be had, the plain expiry applies", async () => {
  const cache = asyncCache();
  const fetch = fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": TVM_EPISODES, "/updates/shows?since=week": () => jsonRes(500, null) });
  const make = () => createEpisodeSource({ fetch, tmdbGet: fakeTmdb({}), cache, minGapMs: 0, useUpdates: true });
  await make().getEpisodes({ imdb: "tt1" });
  await make().getEpisodes({ imdb: "tt1" });
  assert.equal(fetch.calls.filter(c => c === "/shows/5/episodes").length, 1, "fresh copy kept");
  cache.age("tvmaze-episodes2:5", 7 * 3600 * 1000);
  await make().getEpisodes({ imdb: "tt1" });
  assert.equal(fetch.calls.filter(c => c === "/shows/5/episodes").length, 2, "older than 6 hours: fetched again");
});

test("Placeholder titles (TBA, Episode 3) count as no title; a linked twin's title fills in", async () => {
  const { realTitle } = require("../episode-source.js");
  assert.equal(realTitle("TBA"), null);
  assert.equal(realTitle(" tbd "), null);
  assert.equal(realTitle("Episode 3"), null);
  assert.equal(realTitle("Scared Straight"), "Scared Straight");
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": [
      { id: 11, season: 1, number: 1, name: "TBA", airdate: "2026-01-05", airtime: "21:00", airstamp: "2026-01-06T02:00:00+00:00" },
    ] }),
    tmdbGet: fakeTmdb({ 77: { 1: [{ id: 901, episode_number: 1, air_date: "2026-01-05", name: "Scared Straight" }] } }),
    minGapMs: 0,
  });
  const r = await src.getEpisodes({ tmdb: 77, imdb: "tt1" });
  assert.equal(r.episodes[0].title, "Scared Straight");
});

test("TMDB numbering keeps TVMaze's exact air time for the same episode", async () => {
  const src = createEpisodeSource({
    fetch: fakeFetch({ "/lookup/shows?imdb=tt1": { id: 5 }, "/shows/5/episodes": [
      { id: 11, season: 1, number: 1, name: "Pilot", airdate: "2026-10-29", airtime: "20:30", airstamp: "2026-10-30T00:30:00+00:00" },
    ] }),
    tmdbGet: fakeTmdb({ 77: { 1: [{ id: 901, episode_number: 1, air_date: "2026-10-29", name: "Pilot" }] } }),
    minGapMs: 0,
  });
  const r = await src.getEpisodes({ tmdb: 77, imdb: "tt1" }, { prefer: "tmdb" });
  assert.equal(r.source, "tmdb");
  assert.equal(r.episodes[0].date, "2026-10-30T00:30:00+00:00");
  assert.equal(r.episodes[0].hasTime, true);
  assert.deepEqual(r.episodes[0].keys, ["tmdb:901", "tvmaze:11"]);
});

test("An episode from the other source dated before the main source's last one isn't added", () => {
  const { appendUpcoming } = require("../episode-source.js");
  const now = Date.parse("2026-10-12T12:00:00Z");
  const base = [{ season: 1, episode: 1, date: "2027-01-22" }];
  const extra = [{ season: 1, episode: 1, date: "2027-01-22" }, { season: 1, episode: 2, date: "2027-01-21" }, { season: 1, episode: 3, date: "2027-01-29" }];
  const r = appendUpcoming(base, extra, now);
  assert.deepEqual(r.episodes.map(e => e.episode), [1, 3]);
});

test("appendAfter: a snapshot keeps every later episode of the other source, aired or not", () => {
  const { appendAfter } = require("../episode-source.js");
  const snapshot = [
    { season: 6, episode: 25, date: "2024-03-01" }, { season: 6, episode: 26, date: "2024-03-08" },
    { season: 3, episode: 4, date: null }, // undated, inside the snapshot
  ];
  const other = [
    { season: 6, episode: 26, date: "2024-03-08" }, // the snapshot has it
    { season: 6, episode: 20, date: "2024-01-01" }, // before the snapshot's end
    { season: 7, episode: 1, date: "2026-10-10" },  // aired since: kept
    { season: 7, episode: 2, date: "2026-10-12" },
    { season: 7, episode: 3, date: null },          // undated, numbered after: kept
    { season: 5, episode: 30, date: null },         // undated, numbered before: not
  ];
  const r = appendAfter(snapshot, other);
  assert.deepEqual(r.episodes.slice(3).map(e => `${e.season}x${e.episode}`), ["7x1", "7x2", "7x3"]);
  assert.equal(r.added, 3);
});

// ---------------------------------------------------------------------
// holdForLaterDates: TheTVDB's later date wins for recent episodes
// ---------------------------------------------------------------------
const { holdForLaterDates } = require("../episode-source.js");
const NOW_OCT20 = Date.parse("2026-10-20T12:00:00Z");
const pim = [ // People I've Met as TVMaze listed it
  { season: 1, episode: 5, date: "2026-10-18T19:00:00+00:00" },
  { season: 1, episode: 6, date: "2026-10-19T19:00:00+00:00" },
  { season: 1, episode: 7, date: "2026-10-26T20:00:00+00:00" },
];

test("holdForLaterDates: an episode TheTVDB dates days later moves there, keeping its time", () => {
  const { episodes, moved } = holdForLaterDates(pim, [
    { season: 1, episode: 5, date: "2026-10-18" }, { season: 1, episode: 6, date: "2026-10-25" }, { season: 1, episode: 7, date: "2026-11-01" },
  ], NOW_OCT20);
  assert.equal(moved, 2);
  assert.equal(episodes[0].date, pim[0].date);
  assert.equal(episodes[1].date, "2026-10-25T19:00:00.000Z");
  assert.equal(episodes[1].heldBy, "tvdb");
  assert.equal(episodes[2].date, "2026-11-01T20:00:00.000Z");
});

test("holdForLaterDates: never earlier, never for a day apart, never for long-past episodes", () => {
  const { episodes, moved } = holdForLaterDates([
    { season: 1, episode: 1, date: "2026-10-19T19:00:00+00:00" },
    { season: 1, episode: 2, date: "2026-10-19T22:30:00+00:00" },
    { season: 1, episode: 3, date: "2026-08-01" },
    { season: 0, episode: 1, date: "2026-10-19" },
  ], [
    { season: 1, episode: 1, date: "2026-10-12" },
    { season: 1, episode: 2, date: "2026-10-20" },
    { season: 1, episode: 3, date: "2026-12-01" },
    { season: 0, episode: 1, date: "2026-12-01" },
  ], NOW_OCT20);
  assert.equal(moved, 0);
  assert.equal(episodes[3].date, "2026-10-19");
});

test("holdForLaterDates: a date-only episode takes TheTVDB's day; no second opinion changes nothing", () => {
  const { episodes } = holdForLaterDates([{ season: 2, episode: 1, date: "2026-10-19" }], [{ season: 2, episode: 1, date: "2026-10-25" }], NOW_OCT20);
  assert.equal(episodes[0].date, "2026-10-25");
  assert.deepEqual(holdForLaterDates(pim, null, NOW_OCT20).episodes, pim);
});
