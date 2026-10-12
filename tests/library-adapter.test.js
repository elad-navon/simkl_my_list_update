const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../library-core.js");
const { createLibraryStore, memoryBackend } = require("../library-store.js");
const { appendUpcoming } = require("../episode-source.js");
const { createLibraryAdapter } = require("../library-adapter.js");

const NOW = Date.parse("2026-10-12T12:00:00Z");
const DAY = 86400000;
const iso = d => new Date(NOW + d * DAY).toISOString();
const date = d => iso(d).slice(0, 10);

// Episode lists by TMDB id, as the episode source would return them.
function ep(season, episode, d, { time = true, title, key } = {}) {
  return {
    season, episode, date: d == null ? null : time ? iso(d) : date(d), hasTime: time && d != null,
    title: title || `E${episode}`, runtime: 40, keys: [key || `tvmaze:${season * 100 + episode}`],
  };
}
const EPISODES = {
  1: [ep(1, 1, -30), ep(1, 2, -20), ep(1, 3, -10), ep(1, 4, 3)],
  2: [ep(1, 1, -5), ep(1, 2, 0, { time: false }), ep(1, 3, 7, { time: false })],
  3: [ep(1, 1, -40), ep(2, 1, 30)],
};

function fakeSource(lists = EPISODES) {
  const calls = [];
  return {
    calls,
    async getEpisodes(ids, opts = {}) {
      calls.push({ ids, prefer: opts.prefer });
      const episodes = lists[ids.tmdb];
      if (episodes === "fail") return { source: "none", episodes: [], errors: ["TVMaze unreachable"] };
      return { source: "tvmaze", episodes: episodes || [], errors: [] };
    },
  };
}

function show(tmdb, status, watched = {}, extra = {}) {
  const s = core.createShow({ ids: { tmdb, imdb: `tt${tmdb}` }, title: `Show ${tmdb}`, year: 2024, status, now: NOW - 100 * DAY });
  s.watched = watched;
  return Object.assign(s, extra);
}
const W = (s, e, at, key) => ({ [key || `tvmaze:${s * 100 + e}`]: { s, e, at, keys: [key || `tvmaze:${s * 100 + e}`] } });

async function setup(docs, { lists, showMeta, backendHook } = {}) {
  const backend = memoryBackend(docs);
  if (backendHook) backendHook(backend);
  const store = createLibraryStore({ core, backend, storage: null, sleep: async () => {} });
  await store.load();
  const source = fakeSource(lists);
  const adapter = createLibraryAdapter({ core, store, source, appendUpcoming, showMeta, now: () => NOW });
  return { backend, store, source, adapter };
}

test("items come back in SIMKL's all-items shape, keyed by the library document id", async () => {
  const { adapter } = await setup({
    1: show(1, "watching", { ...W(1, 1, iso(-29)), ...W(1, 2, iso(-19)) }),
    2: show(2, "plantowatch"),
    3: show(3, "watching"),
  });
  const items = await adapter.items("watching");
  assert.equal(items.length, 2);
  const a = items.find(i => i.show.ids.library === "1");
  assert.equal(a.status, "watching");
  assert.equal(a.next_to_watch, "S01E03");
  assert.equal(a.watched_episodes_count, 2);
  assert.equal(a.total_episodes_count, 4);
  assert.equal(a.not_aired_episodes_count, 1);
  assert.equal(a.show.ids.tmdb, 1);
  assert.equal(a.show.ids.imdb, "tt1");
  assert.equal(a.show.runtime, 40);
  assert.deepEqual(a.seasons, [{ number: 1, episodes: [{ number: 1, watched_at: iso(-29) }, { number: 2, watched_at: iso(-19) }] }]);
  assert.equal(a.last_watched, "S01E02");
});

test("dropped shows need no episode list (Recently Watched reads only the last watched one)", async () => {
  const { adapter, source } = await setup({ 1: show(1, "dropped", W(1, 2, iso(-3))) });
  const [d] = await adapter.items("dropped", { withEpisodes: false });
  assert.equal(d.last_watched, "S01E02");
  assert.equal(d.last_watched_at, iso(-3));
  assert.equal(source.calls.length, 0);
});

test("a date-only episode airing today is not aired yet; tomorrow it is", async () => {
  const { adapter } = await setup({ 2: show(2, "watching", W(1, 1, iso(-4))) });
  let [item] = await adapter.items("watching");
  assert.equal(item.next_to_watch, null, "S01E02 airs today with no time - not available yet");
  assert.equal(item.not_aired_episodes_count, 2);
  const later = createLibraryAdapter({
    core, store: { view: () => new Map([["2", show(2, "watching", W(1, 1, iso(-4)))]]) },
    source: fakeSource(), appendUpcoming, now: () => NOW + DAY,
  });
  [item] = await later.items("watching");
  assert.equal(item.next_to_watch, "S01E02");
});

test("showEpisodes gives the episode cache's { season, episode, date, title } list", async () => {
  const { adapter } = await setup({ 2: show(2, "watching") });
  const eps = await adapter.showEpisodes("2");
  assert.deepEqual(eps[1], { season: 1, episode: 2, date: date(0), title: "E2", runtime: 40 });
  assert.equal(await adapter.showEpisodes("999"), null, "not in the library");
});

test("one episode list request per show per refresh, shared by every caller", async () => {
  const { adapter, source } = await setup({ 1: show(1, "watching") });
  await Promise.all([adapter.items("watching"), adapter.showEpisodes("1"), adapter.findStatus({ tmdb: 1 })]);
  assert.equal(source.calls.length, 1);
  adapter.reset();
  await adapter.showEpisodes("1");
  assert.equal(source.calls.length, 2, "a refresh asks again (the source's own cache decides about the network)");
});

test("the episode source chosen at import is used: TMDB numbering, or the fixed snapshot", async () => {
  const snapshot = [ep(1, 1, -40, { key: "simkl:1" }), ep(1, 2, -39, { key: "simkl:2" })];
  const { adapter, source } = await setup({
    1: show(1, "watching", {}, { episodeSource: "tmdb" }),
    3: show(3, "watching", W(1, 1, iso(-40), "simkl:1"), { episodeSource: "snapshot", snapshotEpisodes: snapshot }),
  });
  await adapter.items("watching");
  assert.equal(source.calls.find(c => c.ids.tmdb === 1).prefer, "tmdb");
  const eps = await adapter.showEpisodes("3");
  assert.deepEqual(eps.map(e => `${e.season}-${e.episode}`), ["1-1", "1-2", "2-1"],
    "the snapshot, plus the upcoming episode the outside source announced");
});

test("a show whose list couldn't load is reported, not silently empty", async () => {
  const { adapter } = await setup({ 1: show(1, "watching") }, { lists: { 1: "fail" } });
  await adapter.items("watching");
  assert.deepEqual(adapter.failures(), ["Show 1"]);
});

test("findStatus matches by document id, TMDB, IMDb or TheTVDB id", async () => {
  const { adapter } = await setup({ 1: show(1, "hold"), "imdb:tt9": core.createShow({ ids: { imdb: "tt9", tvdb: 99 }, title: "No TMDB", status: "completed", now: NOW }) });
  assert.equal((await adapter.findStatus({ tmdb: "1" })).status, "hold");
  assert.equal((await adapter.findStatus({ library: "1" })).status, "hold");
  assert.equal((await adapter.findStatus({ imdb: "tt1" })).status, "hold");
  assert.equal((await adapter.findStatus({ tvdb: "99" })).item.show.ids.library, "imdb:tt9");
  assert.equal(await adapter.findStatus({ tmdb: 5 }), null);
});

test("adding a show from search stores TMDB's English title and outside ids", async () => {
  const showMeta = async id => ({ title: "Shtisel", year: "2013", imdb: "tt2", tvdb: 22 });
  const { adapter, backend } = await setup({}, { showMeta });
  assert.equal(await adapter.setStatus({ tmdb: 2 }, "plantowatch", { title: "שטיסל", year: "2013" }), "saved");
  const doc = backend.docs.get("2");
  assert.equal(doc.title, "Shtisel");
  assert.equal(doc.year, 2013);
  assert.deepEqual([doc.ids.tmdb, doc.ids.imdb, doc.ids.tvdb], [2, "tt2", 22]);
  assert.equal(doc.status, "plantowatch");
});

test("changing the status of a show already in the library; autoStarted travels with it", async () => {
  const { adapter, backend } = await setup({ 1: show(1, "plantowatch") });
  await adapter.setStatus({ library: "1", tmdb: 1 }, "watching", { title: "Show 1", autoStarted: "2026-10-01" });
  assert.equal(backend.docs.get("1").status, "watching");
  assert.equal(backend.docs.get("1").autoStarted, "2026-10-01");
  const [item] = await adapter.items("watching");
  assert.equal(item.autoStarted, "2026-10-01");
  await adapter.setStatus({ library: "1" }, "plantowatch", { autoStarted: "manual" });
  assert.equal(backend.docs.get("1").autoStarted, "manual");
});

test("marking episodes stores the episode's source keys; un-marking clears what the page shows", async () => {
  const legacy = { "num:1-2": { s: 1, e: 2, at: iso(-19) } }; // a record kept by number only
  const { adapter, backend } = await setup({ 1: show(1, "watching", { ...W(1, 1, iso(-29)), ...legacy }) });
  await adapter.setWatched("1", 1, [3], true);
  assert.deepEqual(backend.docs.get("1").watched["tvmaze:103"].keys, ["tvmaze:103"]);
  assert.equal(await adapter.setWatched("1", 1, [1], true), "saved", "already watched: nothing to do");
  assert.equal(backend.docs.get("1").rev, 1, "no write for it");
  await adapter.setWatched("1", 1, [2, 3], false);
  assert.deepEqual(Object.keys(backend.docs.get("1").watched), ["tvmaze:101"]);
});

test("remove deletes the show", async () => {
  const { adapter, backend } = await setup({ 1: show(1, "watching") });
  await adapter.remove("1");
  assert.equal(backend.docs.has("1"), false);
  await assert.rejects(adapter.remove("1"), /isn't in your list/);
});

test("a change that isn't confirmed is never reported as saved", async () => {
  const { adapter, backend, store } = await setup({ 1: show(1, "watching") });
  backend.setOffline(true);
  await assert.rejects(adapter.setStatus({ library: "1" }, "hold"), e => e.outcome === "queued" && /back online/.test(e.message));
  assert.equal(store.view().get("1").status, "hold", "shown as pending");
  backend.setOffline(false);
  await store.retry();
  assert.equal(backend.docs.get("1").status, "hold");

  backend.docs.set("1", core.applyOp(backend.docs.get("1"), { id: "other", type: "setStatus", status: "dropped", at: iso(0) }).show);
  await assert.rejects(adapter.setStatus({ library: "1" }, "completed"), e => e.outcome === "conflict" && /another device/.test(e.message));
  assert.equal(backend.docs.get("1").status, "dropped", "nothing overwritten");
});
