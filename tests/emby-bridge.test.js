const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../library-core.js");
const { createLibraryStore, memoryBackend } = require("../library-store.js");
const { appendAfter } = require("../episode-source.js");
const { createLibraryAdapter } = require("../library-adapter.js");
const { createEmbyBridge, episodesOf } = require("../tools/emby-bridge/emby-bridge.js");

const NOW = Date.parse("2026-10-15T20:00:00Z");
const DAY = 86400000;
const MIN = 60000;
const iso = ms => new Date(ms).toISOString();
const TICKS_PER_MIN = 60 * 1e7;

// Library episode lists (TVMaze-style keys) by TMDB id.
const ep = (s, e, id) => ({ season: s, episode: e, date: iso(NOW - (10 - e) * DAY), hasTime: true, title: `E${e}`, keys: [`tvmaze:${id}`] });
const LISTS = {
  1: [ep(1, 1, 101), ep(1, 2, 102), ep(1, 3, 103), ep(1, 4, 104)],
  2: [ep(1, 1, 201), ep(1, 2, 202)],
};

function libShow(tmdb, status, watched = {}) {
  const s = core.createShow({ ids: { tmdb, imdb: `tt${tmdb}` }, title: `Show ${tmdb}`, status, now: NOW - 100 * DAY });
  s.watched = watched;
  return s;
}

// Emby's items: an episode of series `sid` (TMDB id `tmdb`).
const SERIES = { s1: { Name: "Show 1", ProductionYear: 2024, ProviderIds: { Tmdb: "1", Imdb: "tt1" } },
  s2: { Name: "Show 2", ProductionYear: 2024, ProviderIds: { Tmdb: "2" } },
  s9: { Name: "Brand New", ProductionYear: 2026, ProviderIds: { Tmdb: "9" } } };
const embyEp = (id, sid, s, e, extra = {}) => ({ Id: id, Type: "Episode", SeriesId: sid, SeriesName: SERIES[sid].Name,
  ParentIndexNumber: s, IndexNumber: e, RunTimeTicks: 45 * TICKS_PER_MIN, ProviderIds: {}, ...extra });

function fakeEmby() {
  const state = { sessions: [], played: [], calls: [] };
  return {
    state,
    async sessions() { state.calls.push("sessions"); return state.sessions; },
    async playedSince(since) { state.calls.push(`played:${since}`); return state.played; },
    async series(id) { state.calls.push(`series:${id}`); return SERIES[id]; },
  };
}

async function setup(docs, { clock } = {}) {
  const backend = memoryBackend(docs);
  let loads = 0;
  const loadAll = backend.loadAll.bind(backend);
  backend.loadAll = async () => { loads++; return loadAll(); };
  const store = createLibraryStore({ core, backend, storage: null, sleep: async () => {} });
  await store.load();
  loads = 0;
  const source = { async getEpisodes(ids) { return { source: "tvmaze", episodes: LISTS[ids.tmdb] || [], errors: [] }; } };
  const now = clock || (() => NOW);
  const adapter = createLibraryAdapter({ core, store, source, appendAfter, now });
  const emby = fakeEmby();
  const bridge = createEmbyBridge({ core, store, adapter, backend, emby, now });
  return { backend, store, emby, bridge, loads: () => loads };
}

test("episodesOf: one file can hold several episodes", () => {
  assert.deepEqual(episodesOf({ ParentIndexNumber: 2, IndexNumber: 3, ProviderIds: { Tvdb: "77" } }), [{ s: 2, e: 3, tvdbId: "77" }]);
  assert.deepEqual(episodesOf({ ParentIndexNumber: 1, IndexNumber: 1, IndexNumberEnd: 2 }).map(x => x.e), [1, 2]);
  assert.deepEqual(episodesOf({ IndexNumber: 1 }), []);
});

test("first run: starts from now, never from the whole history", async () => {
  const { bridge, backend, emby } = await setup({ 1: libShow(1, "watching") });
  emby.state.played = [embyEp("old", "s1", 1, 1, { UserData: { LastPlayedDate: iso(NOW - 300 * DAY) } })];
  const r = await bridge.run();
  assert.equal(r.started, true);
  assert.equal(backend.meta.get("embyBridge").since, iso(NOW));
  assert.deepEqual(backend.docs.get("1").watched, {});
});

test("live: an episode is marked once 90% of it was played, not before", async () => {
  const { bridge, backend, emby, loads } = await setup({ 1: libShow(1, "watching") });
  await bridge.run(); // starts the read point
  emby.state.sessions = [{ item: embyEp("e2", "s1", 1, 2), positionTicks: 40 * TICKS_PER_MIN }]; // 89%
  let r = await bridge.run();
  assert.equal(r.added, 0);
  assert.equal(loads(), 0, "nothing to mark: the library isn't read");
  assert.equal(Math.round(r.live[0].share * 100), 89);
  emby.state.sessions = [{ item: embyEp("e2", "s1", 1, 2), positionTicks: 41 * TICKS_PER_MIN }]; // 91%
  r = await bridge.run();
  assert.equal(r.added, 1);
  const rec = backend.docs.get("1").watched["tvmaze:102"];
  assert.equal(rec.by, "emby");
  assert.equal(rec.at, iso(NOW));
  // Still playing a minute later: nothing more, and no second read.
  const before = loads();
  r = await bridge.run();
  assert.equal(r.added, 0);
  assert.equal(loads(), before);
});

test("safety net: an episode Emby marked played while the bridge wasn't watching, with its real time", async () => {
  const { bridge, backend, emby } = await setup({ 1: libShow(1, "watching") });
  await bridge.run();
  const playedAt = iso(NOW + 5 * MIN);
  emby.state.played = [embyEp("e3", "s1", 1, 3, { UserData: { LastPlayedDate: playedAt } })];
  const r = await bridge.run();
  assert.equal(r.added, 1);
  assert.equal(backend.docs.get("1").watched["tvmaze:103"].at, playedAt);
  assert.equal(backend.meta.get("embyBridge").since, playedAt);
});

test("marked live, then played by Emby: recorded once", async () => {
  const { bridge, backend, emby } = await setup({ 1: libShow(1, "watching") });
  await bridge.run();
  emby.state.sessions = [{ item: embyEp("e2", "s1", 1, 2), positionTicks: 42 * TICKS_PER_MIN }];
  await bridge.run();
  emby.state.sessions = [];
  emby.state.played = [embyEp("e2", "s1", 1, 2, { UserData: { LastPlayedDate: iso(NOW + MIN) } })];
  const r = await bridge.run();
  assert.equal(r.added, 0);
  assert.equal(Object.keys(backend.docs.get("1").watched).length, 1);
});

test("Plan to Watch moves to Watching; a series not in the library is added as Watching", async () => {
  const { bridge, backend, emby } = await setup({ 2: libShow(2, "plantowatch") });
  await bridge.run();
  emby.state.played = [
    embyEp("a", "s2", 1, 1, { UserData: { LastPlayedDate: iso(NOW + MIN) } }),
    embyEp("b", "s9", 1, 1, { UserData: { LastPlayedDate: iso(NOW + MIN) } }),
  ];
  const r = await bridge.run();
  assert.equal(backend.docs.get("2").status, "watching");
  assert.deepEqual(r.created, ["Brand New"]);
  assert.equal(backend.docs.get("9").status, "watching");
});

test("an episode the library doesn't list is kept by its number, never dropped", async () => {
  const { bridge, backend, emby } = await setup({ 1: libShow(1, "watching") });
  await bridge.run();
  emby.state.played = [embyEp("x", "s1", 3, 7, { UserData: { LastPlayedDate: iso(NOW + MIN) } })];
  const r = await bridge.run();
  assert.deepEqual(r.unplaced, ["Show 1 S03E07"]);
  assert.ok(backend.docs.get("1").watched["num:3-7"]);
});

test("a series that can't be marked is retried later, not every minute", async () => {
  let t = NOW;
  const { bridge, emby, loads } = await setup({ 1: libShow(1, "watching") }, { clock: () => t });
  await bridge.run();
  SERIES.bad = { Name: "No Ids", ProviderIds: {} };
  emby.state.played = [{ ...embyEp("z", "s1", 1, 1), SeriesId: "bad", SeriesName: "No Ids", UserData: { LastPlayedDate: iso(NOW + MIN) } }];
  t = NOW + 2 * MIN;
  let r = await bridge.run();
  assert.equal(r.problems.length, 1);
  const after = loads();
  t = NOW + 3 * MIN;
  r = await bridge.run();
  assert.equal(r.problems.length, 0);
  assert.equal(loads(), after, "not read again within the retry wait");
  t = NOW + 40 * MIN;
  r = await bridge.run();
  assert.equal(r.problems.length, 1, "tried again after the wait");
  delete SERIES.bad;
});

test("now watching: what's playing goes to the site, to the minute, with the library show", async () => {
  let t = NOW;
  const { bridge, backend, emby } = await setup({ 1: libShow(1, "watching") }, { clock: () => t });
  emby.state.sessions = [{ item: embyEp("e2", "s1", 1, 2), positionTicks: 23.6 * TICKS_PER_MIN }];
  await bridge.run();
  const m = backend.meta.get("emby");
  assert.equal(m.playing.length, 1);
  assert.deepEqual({ docId: m.playing[0].docId, s: m.playing[0].s, e: m.playing[0].e, pos: m.playing[0].pos, len: m.playing[0].len },
    { docId: "1", s: 1, e: 2, pos: 23 * 60, len: 45 * 60 });
  assert.equal(m.updatedAt, iso(NOW));
  // Still on a minute later (paused, same position): written again, so the
  // site knows it's live.
  emby.state.sessions = [{ item: embyEp("e2", "s1", 1, 2), positionTicks: 23.6 * TICKS_PER_MIN, paused: true }];
  t = NOW + MIN;
  await bridge.run();
  assert.equal(backend.meta.get("emby").updatedAt, iso(NOW + MIN));
  assert.equal(backend.meta.get("emby").playing[0].paused, true);
});

test("now watching: stopped partway shows Emby's resume point; nothing on, nothing rewritten", async () => {
  let t = NOW;
  const { bridge, backend, emby } = await setup({ 1: libShow(1, "watching") }, { clock: () => t });
  emby.resume = async () => [embyEp("e3", "s1", 1, 3, { UserData: { PlaybackPositionTicks: 12.2 * TICKS_PER_MIN } })];
  await bridge.run();
  const first = backend.meta.get("emby");
  assert.deepEqual(first.playing, []);
  assert.equal(first.resume[0].pos, 12 * 60);
  t = NOW + 5 * MIN;
  await bridge.run();
  assert.equal(backend.meta.get("emby").updatedAt, first.updatedAt, "unchanged: not written again");
});

test("marked live, then Emby marks it played: the library isn't read a second time", async () => {
  const { bridge, emby, loads } = await setup({ 1: libShow(1, "watching") });
  await bridge.run();
  emby.state.sessions = [{ item: embyEp("e2", "s1", 1, 2), positionTicks: 42 * TICKS_PER_MIN }];
  await bridge.run();
  const after = loads();
  emby.state.sessions = [];
  emby.state.played = [embyEp("e2", "s1", 1, 2, { UserData: { LastPlayedDate: iso(NOW + MIN) } })];
  await bridge.run();
  assert.equal(loads(), after);
});
