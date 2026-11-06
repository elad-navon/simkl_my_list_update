// tools/emby-bridge/airing-next.js: the phone widget's Airing Next, worked out
// by the computer's bridge and written to the account (meta "airingNext").
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../library-core.js");
const { createAiringNext } = require("../tools/emby-bridge/airing-next.js");

const NOW = Date.parse("2026-11-07T12:00:00Z");
const H = 3600000, DAY = 24 * H;
const at = ms => new Date(NOW + ms).toISOString();
const ep = (s, e, when, extra = {}) => ({ season: s, episode: e, date: when, title: `S${s}E${e}`, ...extra });

// The adapter's two questions: the lists by status, a show's episodes.
function world({ watching = [], plan = [], episodes = {}, failItems = false }) {
  const item = (id, status, extra = {}) => ({ status, show: { title: `Show ${id}`, runtime: 45, ids: { library: String(id), tmdb: id } }, ...extra });
  return {
    async items(status) {
      if (failItems) throw new Error("library unreadable");
      return status === "watching" ? watching.map(w => item(w.id, "watching", w.extra)) : plan.map(p => item(p.id, "plantowatch", p.extra));
    },
    async showEpisodes(docId) { return episodes[docId] || []; },
  };
}
function backend(saved = null) {
  const writes = [];
  return { writes, async getMeta() { return saved; }, async setMeta(name, data) { writes.push({ name, data }); } };
}
const run = async (w, b = backend(), opts = {}) => {
  const airing = createAiringNext({ core, adapter: w, backend: b, tmdbGet: opts.tmdbGet || null, now: () => NOW });
  return { airing, b, r: await airing.run(opts.run) };
};

test("a watched show: its next episodes, soonest first, up to four - none aired, no specials", async () => {
  const { r } = await run(world({
    watching: [{ id: 1 }],
    episodes: { 1: [
      ep(1, 1, at(-10 * DAY)),            // aired
      ep(0, 1, at(1 * DAY)),              // a special
      ep(1, 4, at(4 * DAY)), ep(1, 2, at(2 * DAY)), ep(1, 3, at(3 * DAY)),
      ep(1, 5, at(5 * DAY)), ep(1, 6, at(6 * DAY)),
      ep(1, 7, null),                     // no date yet
    ] },
  }));
  assert.equal(r.shows.length, 1);
  assert.deepEqual(r.shows[0].eps.map(e => `${e.s}x${e.e}`), ["1x2", "1x3", "1x4", "1x5"]);
  assert.equal(r.shows[0].key, "1");
  assert.equal("tmdb" in r.shows[0], false, "only what the phone needs");
});

test("an episode on the air now is still listed; it leaves once over (the site's aired rule)", async () => {
  const w = world({ watching: [{ id: 1 }], episodes: { 1: [ep(1, 2, at(-20 * 60000), { runtime: 45 }), ep(1, 3, at(7 * DAY))] } });
  assert.deepEqual((await run(w)).r.shows[0].eps.map(e => e.e), [2, 3]);
  const later = world({ watching: [{ id: 1 }], episodes: { 1: [ep(1, 2, at(-50 * 60000), { runtime: 45 }), ep(1, 3, at(7 * DAY))] } });
  assert.deepEqual((await run(later)).r.shows[0].eps.map(e => e.e), [3]);
});

test("badges as on the site: series premiere, season premiere, season finale", async () => {
  const { r } = await run(world({
    watching: [{ id: 1 }, { id: 2 }],
    episodes: {
      1: [ep(1, 1, at(1 * DAY)), ep(1, 2, at(2 * DAY))],
      2: [ep(3, 9, at(-7 * DAY)), ep(3, 10, at(1 * DAY)), ep(4, 1, at(30 * DAY))],
    },
  }));
  const by = Object.fromEntries(r.shows.map(s => [s.key, s.eps.map(e => e.badge)]));
  assert.deepEqual(by["1"], ["SERIES PREMIERE", "SEASON FINALE"]);
  assert.deepEqual(by["2"], ["SEASON FINALE", "SEASON PREMIERE"]);
});

test("a placeholder title is no title; no runtime of its own: the show's", async () => {
  const { r } = await run(world({ watching: [{ id: 1 }], episodes: { 1: [ep(1, 2, at(DAY), { title: "Episode 2" }), ep(1, 3, at(2 * DAY), { runtime: 52 })] } }));
  assert.deepEqual(r.shows[0].eps.map(e => [e.title, e.runtime]), [[null, 45], ["S1E3", 52]]);
});

test("Plan to Watch: only a show whose next episode is the series premiere, with that one episode", async () => {
  const { r } = await run(world({
    plan: [{ id: 5 }, { id: 6 }],
    episodes: { 5: [ep(1, 1, at(3 * DAY)), ep(1, 2, at(10 * DAY))], 6: [ep(2, 1, at(3 * DAY))] },
  }));
  assert.deepEqual(r.shows.map(s => [s.key, s.plan, s.eps.length]), [["5", true, 1]]);
});

test("a show both watched and planned is listed once, as watched; nothing to come, not listed", async () => {
  const { r } = await run(world({
    watching: [{ id: 1 }, { id: 2 }, { id: 3, extra: { not_aired_episodes_count: 0 } }],
    plan: [{ id: 1 }],
    episodes: { 1: [ep(1, 1, at(DAY))], 2: [ep(1, 1, at(-DAY))], 3: [ep(1, 1, at(DAY))] },
  }));
  assert.deepEqual(r.shows.map(s => [s.key, s.plan]), [["1", false]]);
});

test("written only when the list changed - also against what's already in the account", async () => {
  const w = world({ watching: [{ id: 1 }], episodes: { 1: [ep(1, 2, at(DAY))] } });
  const { airing, b, r } = await run(w);
  assert.equal(r.written, true);
  assert.equal(b.writes.length, 1);
  const doc = JSON.parse(b.writes[0].data.json);
  assert.equal(doc.v, 1);
  assert.equal(doc.generatedAt, new Date(NOW).toISOString());
  assert.equal((await airing.run()).written, false, "the same list: not written again");
  // A fresh start (the bridge restarted) with the same list already saved.
  const again = await run(w, backend({ json: b.writes[0].data.json }));
  assert.equal(again.r.written, false);
  assert.equal(again.b.writes.length, 0);
});

test("a dry run works the list out but never writes", async () => {
  const { r, b } = await run(world({ watching: [{ id: 1 }], episodes: { 1: [ep(1, 2, at(DAY))] } }), backend(), { run: { dryRun: true } });
  assert.equal(r.written, false);
  assert.equal(r.shows.length, 1);
  assert.equal(b.writes.length, 0);
});

test("the library unreadable: an error, and the good document stays", async () => {
  const b = backend();
  const airing = createAiringNext({ core, adapter: world({ failItems: true }), backend: b, now: () => NOW });
  await assert.rejects(airing.run(), /library unreadable/);
  assert.equal(b.writes.length, 0);
});

test("the picture: TMDB's own backdrop when English, else the first English one, else a Hebrew one", async () => {
  const backdrops = {
    1: { backdrop_path: "/own.jpg", images: { backdrops: [{ file_path: "/en1.jpg", iso_639_1: "en" }, { file_path: "/own.jpg", iso_639_1: null }] } },
    2: { backdrop_path: "/he.jpg", images: { backdrops: [{ file_path: "/he.jpg", iso_639_1: "he" }, { file_path: "/en.jpg", iso_639_1: "en" }] } },
    3: { backdrop_path: null, images: { backdrops: [{ file_path: "/heb.jpg", iso_639_1: "he" }] } },
  };
  const { r } = await run(world({ watching: [{ id: 1 }, { id: 2 }, { id: 3 }], episodes: { 1: [ep(1, 2, at(DAY))], 2: [ep(1, 2, at(DAY))], 3: [ep(1, 2, at(DAY))] } }),
    backend(), { tmdbGet: async p => backdrops[p.split("/")[2]] });
  assert.deepEqual(r.shows.map(s => s.art.replace("https://image.tmdb.org/t/p/w780", "")), ["/own.jpg", "/en.jpg", "/heb.jpg"]);
});

test("TMDB away: the picture it had is kept", async () => {
  let up = true;
  const w = world({ watching: [{ id: 1 }], episodes: { 1: [ep(1, 2, at(30 * DAY))] } });
  let clock = NOW;
  const airing = createAiringNext({ core, adapter: w, backend: backend(), now: () => clock,
    tmdbGet: async () => { if (!up) throw new Error("down"); return { backdrop_path: "/a.jpg", images: { backdrops: [{ file_path: "/a.jpg", iso_639_1: "en" }] } }; } });
  assert.match((await airing.run()).shows[0].art, /\/a\.jpg$/);
  up = false;
  clock += 8 * DAY; // the kept picture is old enough to be asked for again
  assert.match((await airing.run()).shows[0].art, /\/a\.jpg$/);
});
