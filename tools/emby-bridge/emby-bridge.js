// Emby auto-marking bridge: marks episodes watched on Emby (on this
// computer's Emby server) in the library, without SIMKL. Runs in Node,
// next to Emby (run.js); this file is the logic, testable with a fake Emby.
//
// Each pass (once a minute):
// - Live: what's playing now (Emby's sessions). An episode is marked once
//   at least `threshold` (90%, as SIMKL does) of it was played, at that
//   moment - while it plays, not only once it's stopped, as Emby marks it.
// - Safety net: episodes Emby itself marked played since the last pass
//   (its own rule - stopping past 90%, or marked by hand) - so a watch
//   while this bridge wasn't running still gets in, with its real time.
// Either way the episode goes in under the SIMKL bridge's rules
// (simkl-bridge.js createShowTaker): matched by the series' TMDB / IMDb /
// TheTVDB ids, Plan to Watch / On Hold move to Watching, a series not in
// the library is added as Watching, nothing is recorded twice (the record
// says it came from Emby: by "emby"). How far the safety net has read is
// kept in the library (meta "embyBridge"); without it, it starts from now -
// never from the whole history.
// The library is read only when there's something to mark.
//
// It also tells the site what's on (meta "emby", for the "now watching"
// ribbon on the top cards): the episodes open on a TV right now, playing or
// paused, each with its position to the minute. Written only when that
// changes, or every minute while something is on (so the site can tell a
// stale report - the computer went off - from a live one).
"use strict";

const { createShowTaker } = require("../../simkl-bridge.js");

const META = "embyBridge";
const NOW_META = "emby";
const TICKS_PER_SEC = 1e7;
const OVERLAP_MS = 10 * 60 * 1000;
// A series that couldn't be marked is tried again after this long (each try
// reads the whole library, so not every minute).
const RETRY_MS = 30 * 60 * 1000;

// The episodes an Emby item stands for (a file can hold several: E01-E02).
function episodesOf(item) {
  if (item.ParentIndexNumber == null || item.IndexNumber == null) return [];
  const last = item.IndexNumberEnd != null && item.IndexNumberEnd > item.IndexNumber ? item.IndexNumberEnd : item.IndexNumber;
  const tvdb = item.ProviderIds && (item.ProviderIds.Tvdb || item.ProviderIds.tvdb);
  const out = [];
  for (let e = item.IndexNumber; e <= last; e++) {
    out.push({ s: item.ParentIndexNumber, e, tvdbId: last === item.IndexNumber && tvdb ? String(tvdb) : null });
  }
  return out;
}

function seriesIds(series) {
  const p = (series && series.ProviderIds) || {};
  const pick = k => p[k] || p[k.toLowerCase()] || p[k.toUpperCase()] || null;
  const tmdb = pick("Tmdb");
  return { tmdb: tmdb != null && !isNaN(Number(tmdb)) ? Number(tmdb) : null, imdb: pick("Imdb"), tvdb: pick("Tvdb") };
}

// createEmbyBridge({ core, store, adapter, backend, emby, now, threshold })
// - emby.sessions(): what's playing now - [{ item, positionTicks }] (the
//   configured user's only)
// - emby.playedSince(iso): episodes marked played since then, each with
//   UserData.LastPlayedDate
// - emby.series(id): a series item (Name, ProductionYear, ProviderIds)
// - backend: getMeta(name) / setMeta(name, data)
function createEmbyBridge({ core, store, adapter, backend, emby, now = () => Date.now(), threshold = 0.9 }) {
  const takeShow = createShowTaker({ core, store, adapter, prefix: "emby-bridge", by: "emby" });
  const handled = new Set(); // this session: what was already taken in
  const retryAt = new Map();  // key -> when a failed one may be tried again
  const seriesCache = new Map();
  let since = null;

  async function seriesFor(id) {
    if (!seriesCache.has(id)) seriesCache.set(id, emby.series(id));
    return seriesCache.get(id);
  }

  const waiting = key => handled.has(key) || (retryAt.get(key) || 0) > now();

  // ---- what's on, for the site ----
  let lastNow = null, lastNowAt = 0;
  async function entryFor(item, positionTicks, paused) {
    if (!item || item.Type !== "Episode" || !item.SeriesId || !item.RunTimeTicks) return null;
    const ids = seriesIds(await seriesFor(item.SeriesId));
    const found = adapter.find(ids);
    return {
      docId: found ? found.docId : null, ...ids, title: item.SeriesName || null,
      s: item.ParentIndexNumber, e: item.IndexNumber,
      pos: Math.floor((positionTicks || 0) / TICKS_PER_SEC / 60) * 60, len: Math.round(item.RunTimeTicks / TICKS_PER_SEC),
      ...(paused ? { paused: true } : {}),
    };
  }
  async function reportNow(sessions) {
    const playing = [];
    for (const s of sessions) {
      const e = await entryFor(s.item, s.positionTicks, s.paused).catch(() => null);
      if (e) playing.push(e);
    }
    const state = JSON.stringify({ playing });
    if (state === lastNow && !(playing.length && now() - lastNowAt >= 55000)) return;
    await backend.setMeta(NOW_META, { playing, updatedAt: new Date(now()).toISOString() });
    lastNow = state;
    lastNowAt = now();
  }

  // One pass. Resolves to { added, shows, created, moved, unplaced,
  // problems, live: [...], started? }.
  async function run() {
    const summary = { added: 0, shows: [], created: [], moved: [], unplaced: [], problems: [], live: [] };
    const nowIso = new Date(now()).toISOString();
    if (since == null) {
      const meta = (await backend.getMeta(META)) || {};
      since = meta.since || null;
      if (!since) {
        since = nowIso;
        await backend.setMeta(META, { since, checkedAt: nowIso });
        summary.started = true;
      }
    }

    // What to take in: [{ item, at, how }].
    const take = [];
    const sessions = (await emby.sessions()) || [];
    await reportNow(sessions).catch(e => summary.problems.push(`now watching: ${e.message}`));
    for (const s of sessions) {
      const item = s.item;
      if (!item || item.Type !== "Episode" || !item.RunTimeTicks) continue;
      const share = (s.positionTicks || 0) / item.RunTimeTicks;
      summary.live.push({ series: item.SeriesName, s: item.ParentIndexNumber, e: item.IndexNumber, share });
      const key = `live:${item.Id}`;
      if (share >= threshold && !waiting(key)) take.push({ item, at: nowIso, key, how: `live ${Math.round(share * 100)}%` });
    }
    const cutoff = Date.parse(since) - OVERLAP_MS;
    let newest = since;
    for (const item of (await emby.playedSince(new Date(cutoff).toISOString())) || []) {
      const at = item.UserData && item.UserData.LastPlayedDate;
      if (!at || Date.parse(at) <= cutoff) continue;
      if (at > newest) newest = at;
      const key = `played:${item.Id}:${at}`;
      // Already marked this session (live, at 90%): Emby's own mark later
      // needs no second look at the library.
      if (handled.has(`done:${item.Id}`)) { handled.add(key); continue; }
      if (!waiting(key)) take.push({ item, at: new Date(Date.parse(at)).toISOString(), key, how: "played" });
    }
    if (!take.length) {
      if (newest !== since) { since = newest; await backend.setMeta(META, { since, checkedAt: nowIso }); }
      return summary;
    }

    // Something to mark: a fresh look at the library first.
    await store.load();
    if (adapter.reset) adapter.reset();
    const bySeries = new Map();
    for (const t of take) {
      if (!t.item.SeriesId) { handled.add(t.key); continue; }
      if (!bySeries.has(t.item.SeriesId)) bySeries.set(t.item.SeriesId, []);
      bySeries.get(t.item.SeriesId).push(t);
    }
    for (const [seriesId, list] of bySeries) {
      const label = list[0].item.SeriesName || "?";
      try {
        const series = await seriesFor(seriesId);
        const ids = seriesIds(series);
        if (ids.tmdb == null && !ids.imdb && !ids.tvdb) throw new Error("Emby has no TMDB / IMDb / TheTVDB id for this series");
        const newly = [];
        for (const t of list) for (const ep of episodesOf(t.item)) newly.push({ ...ep, at: t.at });
        const before = summary.added;
        await takeShow({ title: (series && series.Name) || label, year: series && series.ProductionYear, ids }, newly, summary);
        if (summary.added > before) summary.marked = (summary.marked || []).concat(list.map(t =>
          `${label} ${core.episodeCode(t.item.ParentIndexNumber, t.item.IndexNumber)} (${t.how})`));
        list.forEach(t => { handled.add(t.key); handled.add(`done:${t.item.Id}`); });
      } catch (e) {
        summary.problems.push(`${label}: ${e.message}`);
        list.forEach(t => retryAt.set(t.key, now() + RETRY_MS));
      }
    }
    // Only a clean pass moves the starting point on; otherwise the same
    // episodes are tried again next time (nothing is ever recorded twice).
    if (!summary.problems.length && newest !== since) {
      since = newest;
      await backend.setMeta(META, { since, checkedAt: nowIso });
    }
    return summary;
  }

  return { run };
}

module.exports = { createEmbyBridge, episodesOf, seriesIds, META, NOW_META };
