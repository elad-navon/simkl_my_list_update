const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../library-core.js");
const { loadAppFunctions } = require("./app-helpers.js");

const app = loadAppFunctions([
  "airedMinusWatchedCount", "parseNextEpisode",
  "watchedEpisodeNumbersBySeason", "mostRecentWatchedAt",
]);

const DAY = 86400000;
const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = ms => new Date(ms).toISOString();
const localDate = ms => core.localDateStr(ms);

// An episode list as the episode source returns it.
function ep(season, episode, date, extraKeys = []) {
  return { season, episode, date, title: `S${season}E${episode}`, keys: [`tvmaze:${season * 100 + episode}`, ...extraKeys] };
}
function show(overrides = {}) {
  const s = core.createShow({ ids: { tmdb: 1, imdb: "tt1" }, title: "Test", year: 2024, status: "watching", now: NOW - 30 * DAY });
  return Object.assign(s, overrides);
}
function watched(season, episode, atMs, extra = {}) {
  return { [`tvmaze:${season * 100 + episode}`]: { s: season, e: episode, at: iso(atMs), keys: [`tvmaze:${season * 100 + episode}`], ...extra } };
}

// ---------------------------------------------------------------------------
test("isAired: exact time, date-only and missing dates", () => {
  assert.equal(core.isAired({ date: iso(NOW - 1000) }, NOW), true);
  assert.equal(core.isAired({ date: iso(NOW + 1000) }, NOW), false);
  assert.equal(core.isAired({ date: localDate(NOW - DAY) }, NOW), true, "yesterday, date only");
  assert.equal(core.isAired({ date: localDate(NOW) }, NOW), false, "today, date only: aired only from tomorrow");
  assert.equal(core.isAired({ date: localDate(NOW + DAY) }, NOW), false);
  assert.equal(core.isAired({ date: null }, NOW), false, "unknown date is not aired");
  assert.equal(core.isAired({}, NOW), false);
});

test("toSimklShape: counts, next episode and last watched", () => {
  const eps = [ep(1, 1, iso(NOW - 10 * DAY)), ep(1, 2, iso(NOW - 9 * DAY)), ep(1, 3, iso(NOW - 8 * DAY))];
  const item = core.toSimklShape(show({ watched: watched(1, 1, NOW - 5 * DAY) }), eps, NOW);
  assert.equal(item.status, "watching");
  assert.equal(item.total_episodes_count, 3);
  assert.equal(item.not_aired_episodes_count, 0);
  assert.equal(item.watched_episodes_count, 1);
  assert.equal(item.next_to_watch, "S01E02");
  assert.equal(item.last_watched, "S01E01");
  assert.equal(item.last_watched_at, iso(NOW - 5 * DAY));
  assert.deepEqual(item.seasons, [{ number: 1, episodes: [{ number: 1, watched_at: iso(NOW - 5 * DAY) }] }]);
  assert.equal(item.show.ids.tmdb, 1);
  assert.equal(item.show.ids.imdb, "tt1");
});

test("toSimklShape: specials are left out of every count", () => {
  const eps = [ep(0, 1, iso(NOW - 20 * DAY)), ep(1, 1, iso(NOW - 10 * DAY)), ep(1, 2, iso(NOW + 5 * DAY))];
  const item = core.toSimklShape(show({ watched: watched(0, 1, NOW - DAY) }), eps, NOW);
  assert.equal(item.total_episodes_count, 2);
  assert.equal(item.not_aired_episodes_count, 1);
  assert.equal(item.watched_episodes_count, 0);
  assert.equal(item.next_to_watch, "S01E01");
});

test("toSimklShape: next episode not aired yet -> no next_to_watch", () => {
  const eps = [ep(1, 1, iso(NOW - 10 * DAY)), ep(1, 2, iso(NOW + 2 * DAY))];
  const item = core.toSimklShape(show({ watched: watched(1, 1, NOW - DAY) }), eps, NOW);
  assert.equal(item.next_to_watch, null);
  assert.equal(item.not_aired_episodes_count, 1);
});

test("toSimklShape: a date-only episode airing today isn't counted as aired yet", () => {
  const eps = [ep(1, 1, localDate(NOW - 7 * DAY)), ep(1, 2, localDate(NOW))];
  const item = core.toSimklShape(show({ watched: watched(1, 1, NOW - DAY) }), eps, NOW);
  assert.equal(item.next_to_watch, null);
  assert.equal(item.not_aired_episodes_count, 1);
});

test("toSimklShape: watched out of order - next follows the latest in order, gaps still count", () => {
  const eps = [1, 2, 3, 4].map(n => ep(1, n, iso(NOW - (10 - n) * DAY)));
  const item = core.toSimklShape(show({ watched: watched(1, 3, NOW - DAY) }), eps, NOW);
  assert.equal(item.next_to_watch, "S01E04");
  assert.equal(app.airedMinusWatchedCount(item), 3, "E1, E2 and E4 remain");
});

test("toSimklShape: nothing watched -> the first aired episode", () => {
  const eps = [ep(1, 1, iso(NOW - 3 * DAY)), ep(1, 2, iso(NOW - 2 * DAY))];
  const item = core.toSimklShape(show(), eps, NOW);
  assert.equal(item.next_to_watch, "S01E01");
  assert.equal(item.last_watched, null);
  assert.equal(item.last_watched_at, null);
});

test("toSimklShape: a watched record matches by source key even when numbering differs", () => {
  const eps = [ep(1, 1, iso(NOW - 3 * DAY)), ep(1, 2, iso(NOW - 2 * DAY))];
  const rec = { "tvmaze:102": { s: 9, e: 9, at: iso(NOW - DAY), keys: ["tvmaze:102"] } };
  const item = core.toSimklShape(show({ watched: rec }), eps, NOW);
  assert.deepEqual(item.seasons, [{ number: 1, episodes: [{ number: 2, watched_at: iso(NOW - DAY) }] }]);
  assert.equal(item.next_to_watch, null, "E2 was the latest; nothing after it");
});

test("toSimklShape: falls back to season/episode only when no key matches", () => {
  const eps = [ep(1, 1, iso(NOW - 3 * DAY)), ep(1, 2, iso(NOW - 2 * DAY))];
  const rec = { "tmdb:999": { s: 1, e: 1, at: iso(NOW - DAY), keys: ["tmdb:999"] } };
  const item = core.toSimklShape(show({ watched: rec }), eps, NOW);
  assert.equal(item.watched_episodes_count, 1);
  assert.equal(item.next_to_watch, "S01E02");
});

test("toSimklShape: a watched episode missing from the episode list is still kept and counted", () => {
  const eps = [ep(1, 1, iso(NOW - 3 * DAY))];
  const item = core.toSimklShape(show({ watched: watched(2, 5, NOW - DAY) }), eps, NOW);
  assert.equal(item.watched_episodes_count, 1);
  assert.deepEqual(item.seasons.map(s => s.number), [2]);
  assert.equal(item.last_watched, "S02E05");
});

test("toSimklShape: a partial history keeps the source's watched count", () => {
  const eps = [1, 2, 3, 4, 5, 6].map(n => ep(1, n, iso(NOW - (20 - n) * DAY)));
  const s = show({ status: "dropped", watched: watched(1, 4, NOW - DAY, { partial: true }), watchedCountHint: 4 });
  const item = core.toSimklShape(s, eps, NOW);
  assert.equal(item.watched_episodes_count, 4);
  assert.equal(item.last_watched, "S01E04");
  assert.equal(item.seasons[0].episodes.length, 1, "nothing inferred about E1-E3");
});

test("toSimklShape: an episode with no date isn't aired and isn't next", () => {
  const eps = [ep(1, 1, iso(NOW - 3 * DAY)), ep(1, 2, null)];
  const item = core.toSimklShape(show({ watched: watched(1, 1, NOW - DAY) }), eps, NOW);
  assert.equal(item.not_aired_episodes_count, 1);
  assert.equal(item.next_to_watch, null);
});

test("toSimklShape: a watched episode counts as aired even without a date", () => {
  const eps = [ep(1, 1, null), ep(1, 2, null), ep(1, 3, null)];
  const item = core.toSimklShape(show({ watched: Object.assign({}, watched(1, 1, NOW - DAY), watched(1, 2, NOW - DAY)) }), eps, NOW);
  assert.equal(item.not_aired_episodes_count, 1, "only the unwatched, undated one");
  assert.equal(app.airedMinusWatchedCount(item), 0);
  assert.equal(item.next_to_watch, null, "an undated next episode isn't known to have aired");
});

// ---------------------------------------------------------------------------
test("app.js helpers read the new shape correctly", () => {
  const eps = [1, 2, 3, 4, 5].map(n => ep(1, n, iso(NOW - (10 - n) * DAY))).concat([ep(2, 1, iso(NOW + DAY))]);
  const rec = Object.assign({}, watched(1, 1, NOW - 4 * DAY), watched(1, 2, NOW - 2 * DAY));
  const item = core.toSimklShape(show({ watched: rec }), eps, NOW);
  assert.equal(app.airedMinusWatchedCount(item), 3);
  assert.deepEqual([...app.parseNextEpisode(item.next_to_watch)], [1, 3]);
  const bySeason = app.watchedEpisodeNumbersBySeason(item);
  assert.deepEqual([...bySeason[1]].sort(), [1, 2]);
  assert.equal(app.mostRecentWatchedAt(item), NOW - 2 * DAY);
});

// ---------------------------------------------------------------------------
test("applyOp: status change bumps rev; the same status again changes nothing", () => {
  const s = show();
  const r1 = core.applyOp(s, { id: "a", type: "setStatus", status: "hold", at: iso(NOW) });
  assert.equal(r1.changed, true);
  assert.equal(r1.show.status, "hold");
  assert.equal(r1.show.statusChangedAt, iso(NOW));
  assert.equal(r1.show.rev, s.rev + 1);
  const r2 = core.applyOp(r1.show, { id: "a", type: "setStatus", status: "hold", at: iso(NOW + 1) });
  assert.equal(r2.changed, false);
  assert.equal(r2.show.rev, r1.show.rev);
  assert.equal(s.status, "watching", "the input is never mutated");
});

test("applyOp: marking watched is idempotent and keeps the first watch time", () => {
  const s = show();
  const target = [{ key: "tvmaze:101", keys: ["tvmaze:101"], season: 1, episode: 1 }];
  const r1 = core.applyOp(s, { id: "w", type: "setWatched", watched: true, at: iso(NOW), episodes: target });
  assert.equal(r1.changed, true);
  const r2 = core.applyOp(r1.show, { id: "w", type: "setWatched", watched: true, at: iso(NOW + DAY), episodes: target });
  assert.equal(r2.changed, false);
  assert.equal(r2.show.watched["tvmaze:101"].at, iso(NOW));
  const r3 = core.applyOp(r2.show, { id: "u", type: "setWatched", watched: false, at: iso(NOW), episodes: target });
  assert.equal(r3.changed, true);
  assert.deepEqual(r3.show.watched, {});
});

test("applyOp: unwatching finds a record stored under a different key of the same episode", () => {
  const s = show({ watched: { "tmdb:55": { s: 1, e: 1, at: iso(NOW), keys: ["tmdb:55", "tvmaze:101"] } } });
  const r = core.applyOp(s, { id: "u", type: "setWatched", watched: false, at: iso(NOW), episodes: [{ key: "tvmaze:101", season: 1, episode: 1 }] });
  assert.equal(r.changed, true);
  assert.deepEqual(r.show.watched, {});
});

test("applyOp: remove and invalid operations", () => {
  assert.deepEqual(core.applyOp(show(), { id: "r", type: "remove" }), { show: null, changed: true });
  assert.throws(() => core.applyOp(show(), { id: "x", type: "setStatus", status: "nope" }));
  assert.throws(() => core.applyOp(null, { id: "x", type: "setStatus", status: "hold" }));
});

// ---------------------------------------------------------------------------
test("checkConflict: unchanged copy is never a conflict", () => {
  const s = show();
  assert.deepEqual(core.checkConflict(s, s, { type: "setStatus", status: "hold" }), { ok: true });
});

test("checkConflict: status changed elsewhere", () => {
  const base = show();
  const remote = Object.assign(show(), { rev: 1, status: "dropped" });
  assert.equal(core.checkConflict(base, remote, { type: "setStatus", status: "hold" }).ok, false);
  assert.equal(core.checkConflict(base, remote, { type: "setStatus", status: "dropped" }).ok, true, "same change both places");
});

test("checkConflict: episode changes merge unless they touch the same episode", () => {
  const base = show();
  const remote = Object.assign(show(), { rev: 1, watched: watched(1, 2, NOW) });
  const ep1 = [{ key: "tvmaze:101", season: 1, episode: 1 }];
  const ep2 = [{ key: "tvmaze:102", season: 1, episode: 2 }];
  assert.equal(core.checkConflict(base, remote, { type: "setWatched", watched: true, episodes: ep1 }).ok, true);
  assert.equal(core.checkConflict(base, remote, { type: "setWatched", watched: true, episodes: ep2 }).ok, true, "already marked the same way");
  assert.equal(core.checkConflict(base, remote, { type: "setWatched", watched: false, episodes: ep2 }).ok, false);
});

test("checkConflict: removals", () => {
  const base = show();
  const changed = Object.assign(show(), { rev: 1, status: "hold" });
  assert.equal(core.checkConflict(base, changed, { type: "remove" }).ok, false, "removing a copy changed elsewhere");
  assert.equal(core.checkConflict(base, null, { type: "remove" }).ok, true, "already removed");
  assert.equal(core.checkConflict(base, null, { type: "setStatus", status: "hold" }).ok, false, "editing a show removed elsewhere");
});

// ---------------------------------------------------------------------------
function tep(season, episode, date, title) { return { season, episode, date, title, keys: [`t:${season}-${episode}`] }; }

test("mapWatched: same number with agreeing dates maps directly", () => {
  const target = [tep(1, 1, "2026-01-05", "Pilot"), tep(1, 2, "2026-01-12", "Two")];
  const old = [tep(1, 1, "2026-01-06T02:00:00Z", "Pilot"), tep(1, 2, "2026-01-13T02:00:00Z", "Two")];
  const r = core.mapWatched([{ s: 1, e: 1 }, { s: 1, e: 2 }], target, old);
  assert.deepEqual(r.map(x => [x.method, x.ep && x.ep.episode]), [["number", 1], ["number", 2]]);
});

test("mapWatched: different numbering is translated by air date", () => {
  // The old service numbers season 2 continuously (S02E11...), the target restarts at 1.
  const target = [tep(2, 1, "2026-02-01"), tep(2, 2, "2026-02-08")];
  const old = [tep(2, 11, "2026-02-01"), tep(2, 12, "2026-02-08")];
  const r = core.mapWatched([{ s: 2, e: 11 }, { s: 2, e: 12 }], target, old);
  assert.deepEqual(r.map(x => [x.method, x.ep && x.ep.episode]), [["date", 1], ["date", 2]]);
});

test("mapWatched: a number that exists but points at another air date is re-mapped by date", () => {
  const target = [tep(1, 1, "2026-01-01"), tep(1, 2, "2026-01-08"), tep(1, 3, "2026-01-15")];
  const old = [tep(1, 2, "2026-01-15")]; // old S01E02 is the target's S01E03
  const r = core.mapWatched([{ s: 1, e: 2 }], target, old);
  assert.equal(r[0].method, "date");
  assert.equal(r[0].ep.episode, 3);
});

test("mapWatched: several episodes on one day - by title, then by order within the day", () => {
  const target = [tep(1, 1, "2026-03-01", "Auditions"), tep(1, 2, "2026-03-01", "Results"), tep(1, 3, "2026-03-02", "Final")];
  const oldTitled = [tep(1, 7, "2026-03-01", "Results")];
  assert.equal(core.mapWatched([{ s: 1, e: 7 }], target, oldTitled)[0].ep.episode, 2);
  const oldUntitled = [tep(1, 7, "2026-03-01", null), tep(1, 8, "2026-03-01", null), tep(1, 9, "2026-03-02", null)];
  const r = core.mapWatched([{ s: 1, e: 8 }], target, oldUntitled);
  // 2026-03-01 has 3 candidates within a day (incl. 03-02) on both sides: order decides.
  assert.equal(r[0].method, "date-order");
  assert.equal(r[0].ep.episode, 2);
});

test("mapWatched: never guesses - no date, no match, specials and duplicates are reported", () => {
  const target = [tep(1, 1, "2026-01-01"), tep(1, 2, "2026-01-08")];
  const old = [tep(1, 5, null), tep(1, 6, "2025-06-01"), tep(1, 1, "2026-01-01")];
  const r = core.mapWatched([{ s: 1, e: 5 }, { s: 1, e: 6 }, { s: 0, e: 1 }, { s: 1, e: 1 }, { s: 1, e: 1 }], target, old);
  assert.deepEqual(r.map(x => x.method), ["unmapped", "unmapped", "special", "number", "duplicate"]);
});

test("mapWatched: same season size but shifted dates -> by number (season-match)", () => {
  const target = [1, 2, 3].map(n => tep(1, n, `2026-01-0${n}`));
  const old = [1, 2, 3].map(n => tep(1, n, `2026-03-0${n}`)); // re-released later
  const r = core.mapWatched([{ s: 1, e: 2 }], target, old);
  assert.equal(r[0].method, "season-match");
  assert.equal(r[0].ep.episode, 2);
});

test("mapWatched: seasons split differently, same total -> by absolute position", () => {
  // Old: season 6 has 4 episodes; target: season 6 = 2, season 7 = 2. Dates differ.
  const target = [tep(6, 1, "2020-01-01"), tep(6, 2, "2020-01-08"), tep(7, 1, "2020-06-01"), tep(7, 2, "2020-06-08")];
  const old = [1, 2, 3, 4].map(n => tep(6, n, `2021-0${n}-15`));
  const r = core.mapWatched([{ s: 6, e: 3 }, { s: 6, e: 4 }], target, old);
  assert.deepEqual(r.map(x => [x.method, x.ep.season, x.ep.episode]), [["position", 7, 1], ["position", 7, 2]]);
});

test("mapWatched: without the old service's list, only exact numbers map", () => {
  const target = [tep(1, 1, "2026-01-01")];
  const r = core.mapWatched([{ s: 1, e: 1 }, { s: 1, e: 9 }], target, null);
  assert.deepEqual(r.map(x => x.method), ["number", "unmapped"]);
});

test("nextUpcoming: earliest not-yet-aired episode; a date-only episode today still counts", () => {
  const eps = [ep(1, 1, iso(NOW - DAY)), ep(1, 3, iso(NOW + 3 * DAY)), ep(1, 2, localDate(NOW)), ep(0, 1, iso(NOW + DAY)), ep(1, 4, null)];
  assert.equal(core.nextUpcoming(eps, NOW).episode, 2);
  assert.equal(core.nextUpcoming([ep(1, 1, iso(NOW - DAY))], NOW), null);
});

test("titlesAgree / dayDiff", () => {
  assert.equal(core.titlesAgree("The Office (US)", "the office us"), true);
  assert.equal(core.titlesAgree("Pilot", "Finale"), false);
  assert.equal(core.dayDiff("2026-01-01", "2026-01-03T23:00:00Z"), 2);
  assert.equal(core.dayDiff(null, "2026-01-01"), null);
});

test("showDocId: TMDB first, then a prefixed IMDb / TheTVDB id", () => {
  assert.equal(core.showDocId({ tmdb: 42, imdb: "tt1" }), "42");
  assert.equal(core.showDocId({ tmdb: null, imdb: "tt1" }), "imdb:tt1");
  assert.equal(core.showDocId({ tvdb: 99 }), "tvdb:99");
  assert.equal(core.showDocId({}), null);
  const s = core.createShow({ ids: { imdb: "tt5" }, title: "No TMDB", status: "completed", now: NOW });
  assert.equal(s.ids.tmdb, null);
});

test("applyOp: create adds a new show, or only sets the status of an existing one", () => {
  const fresh = core.createShow({ ids: { tmdb: 9 }, title: "New", status: "plantowatch", now: NOW });
  const r1 = core.applyOp(null, { id: "c1", type: "create", show: fresh });
  assert.equal(r1.changed, true);
  assert.equal(r1.show.rev, 1);
  assert.deepEqual(r1.show.appliedOps, ["c1"]);
  const existing = show({ status: "watching" });
  const r2 = core.applyOp(existing, { id: "c2", type: "create", show: fresh, at: iso(NOW) });
  assert.equal(r2.show.status, "plantowatch");
  assert.equal(Object.keys(r2.show.watched).length, Object.keys(existing.watched).length, "history untouched");
});

test("applyOp: an operation already applied (same id) is never applied twice", () => {
  const target = [{ key: "tvmaze:101", season: 1, episode: 1 }];
  const r1 = core.applyOp(show(), { id: "same", type: "setWatched", watched: true, at: iso(NOW), episodes: target });
  // Another device unmarks it, then the first device's retry of "same" arrives.
  const r2 = core.applyOp(r1.show, { id: "other", type: "setWatched", watched: false, at: iso(NOW), episodes: target });
  const retry = core.applyOp(r2.show, { id: "same", type: "setWatched", watched: true, at: iso(NOW), episodes: target });
  assert.equal(retry.changed, false);
  assert.deepEqual(retry.show.watched, {});
  assert.ok(r2.show.appliedOps.includes("same") && r2.show.appliedOps.includes("other"));
});

test("checkConflict: create and already-applied operations", () => {
  const fresh = core.createShow({ ids: { tmdb: 9 }, status: "plantowatch", now: NOW });
  const elsewhereSame = Object.assign(core.createShow({ ids: { tmdb: 9 }, status: "plantowatch", now: NOW }), { rev: 1 });
  const elsewhereOther = Object.assign(core.createShow({ ids: { tmdb: 9 }, status: "watching", now: NOW }), { rev: 1 });
  assert.equal(core.checkConflict(null, elsewhereSame, { type: "create", show: fresh }).ok, true);
  assert.equal(core.checkConflict(null, elsewhereOther, { type: "create", show: fresh }).ok, false);
  const applied = Object.assign(show(), { rev: 3, appliedOps: ["x"] });
  assert.equal(core.checkConflict(show(), applied, { id: "x", type: "remove" }).ok, true);
});

test("createShow validates its input", () => {
  assert.throws(() => core.createShow({ ids: {}, status: "watching", now: NOW }));
  assert.throws(() => core.createShow({ ids: { tmdb: 1 }, status: "bad", now: NOW }));
  const s = core.createShow({ ids: { tmdb: 7, simklLegacy: 99 }, title: "X", status: "plantowatch", now: NOW });
  assert.equal(s.schemaVersion, core.SCHEMA_VERSION);
  assert.equal(s.ids.simklLegacy, 99);
  assert.deepEqual(s.watched, {});
});

test("setStatus can carry the premiere auto-start mark, alone or with a status change", () => {
  const s = core.createShow({ ids: { tmdb: 1 }, title: "A", status: "plantowatch", now: Date.parse("2026-10-01T00:00:00Z") });
  let r = core.applyOp(s, { id: "a", type: "setStatus", status: "watching", at: "2026-10-02T00:00:00Z", autoStarted: "2026-10-01" });
  assert.equal(r.show.status, "watching");
  assert.equal(r.show.autoStarted, "2026-10-01");
  r = core.applyOp(r.show, { id: "b", type: "setStatus", status: "watching", at: "2026-10-03T00:00:00Z", autoStarted: "manual" });
  assert.equal(r.changed, true, "only the mark changed");
  assert.equal(r.show.autoStarted, "manual");
  r = core.applyOp(r.show, { id: "c", type: "setStatus", status: "watching", at: "2026-10-03T00:00:00Z" });
  assert.equal(r.changed, false);
  assert.equal(r.show.autoStarted, "manual", "left alone when not given");
});
