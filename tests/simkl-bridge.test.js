const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../library-core.js");
const { createLibraryStore, memoryBackend } = require("../library-store.js");
const { appendAfter } = require("../episode-source.js");
const { createLibraryAdapter } = require("../library-adapter.js");
const { createSimklBridge } = require("../simkl-bridge.js");

const NOW = Date.parse("2026-10-12T12:00:00Z");
const DAY = 86400000;
const iso = d => new Date(NOW + d * DAY).toISOString();
const IMPORTED = iso(-1);

// Library episode lists (TVMaze-style keys) by TMDB id.
const ep = (s, e, d, id) => ({ season: s, episode: e, date: iso(d), hasTime: true, title: `E${e}`, keys: [`tvmaze:${id}`] });
const LISTS = {
  1: [ep(1, 1, -30, 101), ep(1, 2, -20, 102), ep(1, 3, -10, 103)],
  2: [ep(1, 1, -5, 201), ep(1, 2, -3, 202)],
  3: [ep(1, 1, -400, 301), ep(1, 2, -399, 302)],
  // Numbered from 1 in season 2 here; SIMKL numbers season 2 on from 11.
  5: [ep(2, 1, -9, 501), ep(2, 2, -2, 502)],
  9: [ep(1, 1, -2, 901)],
};

function libShow(tmdb, simkl, status, watched = {}) {
  const s = core.createShow({ ids: { tmdb, imdb: `tt${tmdb}`, simklLegacy: simkl }, title: `Show ${tmdb}`, status, now: NOW - 100 * DAY });
  s.watched = watched;
  s.importedAt = IMPORTED;
  return s;
}

// A fake SIMKL: `changed` is what /sync/all-items returns for date_from;
// `activity` is the latest tv_shows activity time.
function fakeSimkl({ activity, changed = [], episodes = {} }) {
  const calls = [];
  return {
    calls,
    async get(path, params) {
      calls.push({ path, params });
      if (path === "/sync/activities") return { all: activity, tv_shows: { all: activity } };
      if (path === "/sync/all-items/shows") return changed;
      const m = /^\/tv\/episodes\/(\d+)$/.exec(path);
      if (m) return episodes[m[1]] || [];
      throw new Error(`unexpected ${path}`);
    },
  };
}
const item = (title, simkl, tmdb, status, eps) => ({
  show: { title, year: 2024, ids: { simkl, tmdb: String(tmdb), imdb: `tt${tmdb}` } }, status,
  seasons: [...new Set(eps.map(x => x[0]))].map(n => ({ number: n, episodes: eps.filter(x => x[0] === n).map(x => ({ number: x[1], watched_at: x[2] })) })),
});

async function setup(docs, simklOpts) {
  const backend = memoryBackend(docs);
  const store = createLibraryStore({ core, backend, storage: null, sleep: async () => {} });
  await store.load();
  const source = { async getEpisodes(ids) { return { source: "tvmaze", episodes: LISTS[ids.tmdb] || [], errors: [] }; } };
  const showMeta = async id => ({ title: `TMDB ${id}`, year: "2024", imdb: `tt${id}`, tvdb: null });
  const adapter = createLibraryAdapter({ core, store, source, appendAfter, showMeta, now: () => NOW });
  const simkl = fakeSimkl(simklOpts);
  const bridge = createSimklBridge({ core, store, adapter, backend, simkl, now: () => NOW });
  return { backend, store, adapter, simkl, bridge };
}

test("nothing new on SIMKL: one small request, nothing written", async () => {
  const { bridge, simkl, backend } = await setup({ 1: libShow(1, 11, "watching") }, { activity: iso(-2) });
  const r = await bridge.run();
  assert.equal(r.upToDate, true);
  assert.deepEqual(simkl.calls.map(c => c.path), ["/sync/activities"]);
  assert.equal(backend.docs.get("1").rev, 0);
});

test("an episode watched after the import is added, with its real watch time; the read point moves on", async () => {
  const { bridge, backend, simkl } = await setup({ 1: libShow(1, 11, "watching") }, {
    activity: iso(0),
    changed: [item("Show 1", 11, 1, "watching", [[1, 1, iso(-40)], [1, 2, iso(-0.5)]])],
    episodes: { 11: [{ season: 1, episode: 1, date: iso(-30) }, { season: 1, episode: 2, date: iso(-20) }] },
  });
  const r = await bridge.run();
  assert.equal(r.added, 1);
  const w = backend.docs.get("1").watched;
  assert.deepEqual(Object.keys(w), ["tvmaze:102"], "S01E01 was watched long before the import - not taken again");
  assert.equal(w["tvmaze:102"].at, iso(-0.5));
  assert.equal(simkl.calls[1].params.date_from, IMPORTED, "starts from the import");
  assert.equal(backend.meta.get("simklBridge").since, iso(0));
});

test("an episode un-marked in the library isn't brought back by a later run", async () => {
  const { bridge, backend, adapter, simkl } = await setup({ 1: libShow(1, 11, "watching") }, {
    activity: iso(0), changed: [item("Show 1", 11, 1, "watching", [[1, 2, iso(-0.5)]])],
  });
  await bridge.run();
  await adapter.setWatched("1", 1, [2], false);
  // SIMKL still lists it (with its old time) when something else changes later.
  simkl.calls.length = 0;
  Object.assign(simkl, fakeSimkl({ activity: iso(0.5), changed: [item("Show 1", 11, 1, "watching", [[1, 2, iso(-0.5)]])] }));
  await bridge.run();
  assert.deepEqual(backend.docs.get("1").watched, {});
});

test("Plan to Watch and On Hold move to Watching; Completed and Dropped keep their status", async () => {
  const { bridge, backend } = await setup({
    1: libShow(1, 11, "plantowatch"), 2: libShow(2, 12, "hold"), 3: libShow(3, 13, "completed"),
  }, {
    activity: iso(0),
    changed: [
      item("Show 1", 11, 1, "watching", [[1, 1, iso(-0.2)]]),
      item("Show 2", 12, 2, "watching", [[1, 1, iso(-0.2)]]),
      item("Show 3", 13, 3, "completed", [[1, 2, iso(-0.2)]]),
    ],
  });
  const r = await bridge.run();
  assert.equal(backend.docs.get("1").status, "watching");
  assert.equal(backend.docs.get("2").status, "watching");
  assert.equal(backend.docs.get("3").status, "completed");
  assert.equal(r.added, 3);
  assert.deepEqual(r.moved.sort(), ["Show 1", "Show 2"]);
});

test("a show that isn't in the library is added as Watching, with its SIMKL id kept", async () => {
  const { bridge, backend } = await setup({ 1: libShow(1, 11, "watching") }, {
    activity: iso(0), changed: [item("New one", 19, 9, "watching", [[1, 1, iso(-0.1)]])],
  });
  const r = await bridge.run();
  const doc = backend.docs.get("9");
  assert.equal(doc.status, "watching");
  assert.equal(doc.title, "TMDB 9");
  assert.equal(doc.ids.simklLegacy, 19);
  assert.deepEqual(Object.keys(doc.watched), ["tvmaze:901"]);
  assert.deepEqual(r.created, ["TMDB 9"]);
});

test("SIMKL's numbering is translated by air date, as in the import", async () => {
  const { bridge, backend } = await setup({ 5: libShow(5, 15, "watching") }, {
    activity: iso(0),
    changed: [item("Show 5", 15, 5, "watching", [[2, 12, iso(-0.3)]])],
    episodes: { 15: [{ season: 2, episode: 11, date: iso(-9) }, { season: 2, episode: 12, date: iso(-2) }] },
  });
  await bridge.run();
  const rec = backend.docs.get("5").watched["tvmaze:502"];
  assert.ok(rec, "SIMKL S02E12 is this list's S02E02");
  assert.deepEqual([rec.s, rec.e], [2, 2]);
});

test("two devices (or a rerun) never record anything twice", async () => {
  const docs = { 1: libShow(1, 11, "watching") };
  const opts = { activity: iso(0), changed: [item("Show 1", 11, 1, "watching", [[1, 3, iso(-0.1)]])] };
  const a = await setup(docs, opts);
  // A second device: its own store and bridge, the same database.
  const storeB = createLibraryStore({ core, backend: a.backend, storage: null, sleep: async () => {} });
  await storeB.load();
  const adapterB = createLibraryAdapter({ core, store: storeB, source: { async getEpisodes(ids) { return { episodes: LISTS[ids.tmdb], errors: [] }; } }, appendAfter, now: () => NOW });
  const bridgeB = createSimklBridge({ core, store: storeB, adapter: adapterB, backend: a.backend, simkl: fakeSimkl(opts), now: () => NOW });
  await Promise.all([a.bridge.run(), bridgeB.run()]);
  await a.bridge.run();
  const doc = a.backend.docs.get("1");
  assert.deepEqual(Object.keys(doc.watched), ["tvmaze:103"]);
  assert.equal(doc.rev, 1, "written once");
});

test("a library that wasn't imported starts from now - never from the whole history", async () => {
  const fresh = core.createShow({ ids: { tmdb: 1 }, title: "A", status: "watching", now: NOW });
  const { bridge, backend, simkl } = await setup({ 1: fresh }, { activity: iso(0) });
  const r = await bridge.run();
  assert.equal(r.started, true);
  assert.equal(backend.meta.get("simklBridge").since, iso(0));
  assert.equal(simkl.calls.length, 0);
});

test("a failed show leaves the read point where it was, so it's tried again", async () => {
  const { bridge, backend } = await setup({ 1: libShow(1, 11, "watching") }, {
    activity: iso(0), changed: [item("Show 1", 11, 1, "watching", [[1, 2, iso(-0.5)]])],
  });
  backend.setOffline(false);
  const realTransact = backend.transact;
  backend.transact = () => Promise.reject(new Error("The database refused access (security rules)."));
  const r = await bridge.run();
  assert.equal(r.problems.length, 1);
  assert.equal(backend.meta.get("simklBridge"), undefined);
  backend.transact = realTransact;
});
