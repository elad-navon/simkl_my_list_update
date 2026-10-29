const test = require("node:test");
const assert = require("node:assert/strict");
const { createSimklAirTimes, applyAirTimes, needsAirTimes, realTime } = require("../air-times.js");
const { memoryCache } = require("../episode-source.js");
const core = require("../library-core.js");
const { createLibraryStore, memoryBackend } = require("../library-store.js");
const { appendAfter } = require("../episode-source.js");
const { createLibraryAdapter } = require("../library-adapter.js");

const DAY = 86400000;
// Noon local time, so local dates around it are unambiguous in any timezone.
const NOW = (() => { const d = new Date(2026, 9, 14, 12, 0, 0); return d.getTime(); })();
const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const day = n => localDate(NOW + n * DAY);

const dateOnly = (season, episode, d) => ({ season, episode, date: day(d), hasTime: false, title: `E${episode}`, runtime: 45, keys: [`tvmaze:${season * 100 + episode}`] });
const timed = (season, episode, iso) => ({ season, episode, date: iso, hasTime: true, title: `E${episode}`, runtime: 45, keys: [`tvmaze:${season * 100 + episode}`] });
const simkl = (season, episode, date) => ({ type: "episode", season, episode, date });

test("realTime: a real time comes back as an ISO moment; SIMKL's midnight is no time", () => {
  assert.deepEqual(realTime("2026-10-13T19:00:00-04:00"), { day: "2026-10-13", iso: "2026-10-13T23:00:00.000Z" });
  assert.equal(realTime("2026-10-21T00:00:00-04:00"), null);
  assert.equal(realTime("2026-10-21"), null);
  assert.equal(realTime(null), null);
  assert.equal(realTime("garbage"), null);
});

test("applyAirTimes: a date-only episode takes SIMKL's time on the same or the next day", () => {
  const eps = [dateOnly(1, 1, 0), dateOnly(1, 2, 1)];
  const out = applyAirTimes(eps, [
    simkl(1, 1, `${day(0)}T21:00:00-04:00`),  // same day in SIMKL's zone
    simkl(1, 2, `${day(0)}T19:00:00-04:00`),  // the evening before (US date)
  ]);
  assert.equal(out[0].hasTime, true);
  assert.equal(out[0].date, new Date(`${day(0)}T21:00:00-04:00`).toISOString());
  assert.equal(out[0].timeFrom, "simkl");
  assert.equal(out[1].hasTime, true);
  assert.equal(out[0].title, "E1");
  assert.deepEqual(out[0].keys, ["tvmaze:101"]);
});

test("applyAirTimes: midnight, a date two days off, or a missing episode change nothing", () => {
  const eps = [dateOnly(1, 1, 0), dateOnly(1, 2, 3), dateOnly(1, 3, 5)];
  const out = applyAirTimes(eps, [
    simkl(1, 1, `${day(0)}T00:00:00-04:00`),
    simkl(1, 2, `${day(5)}T20:00:00-05:00`),
  ]);
  assert.equal(out, eps);
});

test("applyAirTimes: an episode with a known time keeps it", () => {
  const known = timed(1, 1, "2026-10-14T01:00:00+00:00");
  const out = applyAirTimes([known], [simkl(1, 1, "2026-10-13T19:00:00-04:00")]);
  assert.equal(out[0], known);
});

test("needsAirTimes: only a date-only episode from yesterday to 3 days ahead", () => {
  assert.equal(needsAirTimes([dateOnly(1, 1, 0)], NOW), true);
  assert.equal(needsAirTimes([dateOnly(1, 1, -1)], NOW), true);
  assert.equal(needsAirTimes([dateOnly(1, 1, 3)], NOW), true);
  assert.equal(needsAirTimes([dateOnly(1, 1, -2), dateOnly(1, 2, 4)], NOW), false);
  assert.equal(needsAirTimes([timed(1, 1, new Date(NOW + 3600000).toISOString())], NOW), false);
});

function fakeSimkl(lists, { lookup = {}, fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async get(path, params) {
      calls.push(path);
      if (fail) throw new Error("SIMKL unreachable");
      let m;
      if ((m = /^\/tv\/episodes\/(\d+)$/.exec(path))) return lists[m[1]] || null;
      if (path === "/search/id") return lookup[params.imdb] ? [{ ids: { simkl: lookup[params.imdb] } }] : [];
      throw new Error("unexpected " + path);
    },
  };
}

test("enrich: asks SIMKL only when needed, then keeps the list for a refresh", async () => {
  const api = fakeSimkl({ 7: [simkl(1, 2, `${day(0)}T21:00:00-04:00`)] });
  const enrich = createSimklAirTimes({ get: api.get, cache: memoryCache(), now: () => NOW });
  const eps = [dateOnly(1, 1, -7), dateOnly(1, 2, 0)];
  const out = await enrich({ simklLegacy: 7 }, eps);
  assert.equal(out[1].hasTime, true);
  assert.equal(out[0].hasTime, false);
  await enrich({ simklLegacy: 7 }, eps);
  assert.deepEqual(api.calls, ["/tv/episodes/7"]);
  // Nothing coming up date-only: SIMKL isn't asked.
  const quiet = fakeSimkl({});
  const enrich2 = createSimklAirTimes({ get: quiet.get, cache: memoryCache(), now: () => NOW });
  const far = [dateOnly(1, 1, -7), dateOnly(1, 2, 20)];
  assert.equal(await enrich2({ simklLegacy: 7 }, far), far);
  assert.deepEqual(quiet.calls, []);
});

test("enrich: a show without a SIMKL id is looked up by IMDb id once", async () => {
  const api = fakeSimkl({ 9: [simkl(1, 1, `${day(1)}T03:00:00-04:00`)] }, { lookup: { tt9: 9 } });
  const cache = memoryCache();
  const enrich = createSimklAirTimes({ get: api.get, cache, now: () => NOW });
  const out = await enrich({ imdb: "tt9" }, [dateOnly(1, 1, 1)]);
  assert.equal(out[0].hasTime, true);
  await enrich({ imdb: "tt9" }, [dateOnly(1, 1, 1)]);
  assert.deepEqual(api.calls, ["/search/id", "/tv/episodes/9"]);
});

test("enrich: once aired, the episode keeps the time from the copy already fetched", async () => {
  const api = fakeSimkl({ 7: [simkl(1, 2, `${day(0)}T21:00:00-04:00`)] });
  const cache = memoryCache();
  let now = NOW;
  const enrich = createSimklAirTimes({ get: api.get, cache, now: () => now });
  await enrich({ simklLegacy: 7 }, [dateOnly(1, 2, 0)]);
  now = NOW + 5 * DAY; // out of the window: not asked again, the copy still serves
  const out = await enrich({ simklLegacy: 7 }, [dateOnly(1, 2, 0)]);
  assert.equal(out[0].hasTime, true);
  assert.equal(api.calls.length, 1);
});

test("enrich: not connected, SIMKL failing or hanging - the list comes back as it was", async () => {
  const eps = [dateOnly(1, 2, 0)];
  const off = fakeSimkl({ 7: [simkl(1, 2, `${day(0)}T21:00:00-04:00`)] });
  const e1 = createSimklAirTimes({ get: off.get, cache: memoryCache(), connected: () => false, now: () => NOW });
  assert.equal(await e1({ simklLegacy: 7 }, eps), eps);
  assert.deepEqual(off.calls, []);

  const broken = fakeSimkl({}, { fail: true });
  const e2 = createSimklAirTimes({ get: broken.get, cache: memoryCache(), now: () => NOW });
  assert.equal(await e2({ simklLegacy: 7 }, eps), eps);

  const hanging = { get: () => new Promise(() => {}) };
  const e3 = createSimklAirTimes({ get: hanging.get, cache: memoryCache(), now: () => NOW, timeoutMs: 50 });
  assert.equal(await e3({ simklLegacy: 7 }, eps), eps);
});

test("adapter: the episode lists pass through airTimes, with the show's SIMKL id", async () => {
  const s = core.createShow({ ids: { tmdb: 5, imdb: "tt5", simklLegacy: 77 }, title: "Show 5", year: 2024, status: "watching", now: NOW - 100 * DAY });
  const store = createLibraryStore({ core, backend: memoryBackend({ 5: s }), storage: null, sleep: async () => {} });
  await store.load();
  const source = { async getEpisodes() { return { source: "tvmaze", episodes: [dateOnly(1, 1, 0)], errors: [] }; } };
  const seen = [];
  const airTimes = async (ids, eps) => { seen.push(ids); return eps.map(e => ({ ...e, date: `${e.date}T18:00:00.000Z`, hasTime: true })); };
  const adapter = createLibraryAdapter({ core, store, source, appendAfter, airTimes, now: () => NOW });
  const eps = await adapter.showEpisodes("5");
  assert.equal(eps[0].date, `${day(0)}T18:00:00.000Z`);
  assert.equal(seen[0].simklLegacy, 77);
  assert.equal(seen[0].imdb, "tt5");
});

// ---- Times shared through the account (the bridge -> the phone app) ----
const { sharedKey, takenTimes, applySharedTimes } = require("../air-times.js");
const { createSharedAirTimes } = require("../tools/emby-bridge/shared-air-times.js");

test("sharedKey: TMDB first, then IMDb, then TheTVDB", () => {
  assert.equal(sharedKey({ tmdb: 5, imdb: "tt1", tvdb: "9" }), "tmdb:5");
  assert.equal(sharedKey({ tmdb: null, imdb: "tt1", tvdb: "9" }), "imdb:tt1");
  assert.equal(sharedKey({ tvdb: "9" }), "tvdb:9");
  assert.equal(sharedKey({}), null);
});

test("takenTimes / applySharedTimes: SIMKL's times on one side are the same times on the other", () => {
  const eps = [dateOnly(1, 1, 0), dateOnly(1, 2, 1), timed(1, 3, `${day(2)}T20:00:00.000Z`)];
  const enriched = applyAirTimes(eps, [simkl(1, 1, `${day(0)}T21:00:00-04:00`)]);
  const times = takenTimes(enriched);
  assert.deepEqual(times, { "1-1": enriched[0].date });
  assert.equal(takenTimes(eps), null);
  const out = applySharedTimes(eps, times);
  assert.deepEqual(out[0], enriched[0]);
  assert.equal(out[1], eps[1]); // no time for it: unchanged
  assert.equal(out[2], eps[2]); // already timed: unchanged
});

test("applySharedTimes: a time far from the episode's date is left out; nothing shared, nothing changes", () => {
  const eps = [dateOnly(1, 1, 0)];
  assert.equal(applySharedTimes(eps, { "1-1": new Date(NOW + 5 * DAY).toISOString() }), eps);
  assert.equal(applySharedTimes(eps, null), eps);
  assert.equal(applySharedTimes(eps, { "1-1": "garbage" }), eps);
});

test("createSharedAirTimes: records what enrich took, writes only on a change, drops week-old times", async () => {
  const docs = {};
  const backend = { getMeta: async n => docs[n] || null, setMeta: async (n, d) => { docs[n] = d; } };
  let now = NOW;
  const shared = createSharedAirTimes({ AirTimes: require("../air-times.js"), backend, now: () => now });
  await shared.load();
  const iso = new Date(NOW + 3600000).toISOString();
  const enrich = shared.recording(async (ids, eps) => eps.map(e => ({ ...e, date: iso, hasTime: true, timeFrom: "simkl" })));
  await enrich({ tmdb: 7 }, [dateOnly(2, 4, 0)]);
  assert.equal(await shared.save(), true);
  assert.deepEqual(JSON.parse(docs.airTimes.json).shows, { "tmdb:7": { "2-4": iso } });
  assert.equal(await shared.save(), false);
  now = NOW + 8 * DAY;
  assert.equal(await shared.save(), true);
  assert.deepEqual(JSON.parse(docs.airTimes.json).shows, {});
});
