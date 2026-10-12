// SIMKL auto-marking bridge: SIMKL is kept only as an inbox for episodes
// that something else marked there (the Emby plugin), never as the source of
// truth. Each run asks SIMKL what changed since the last run and copies the
// newly watched episodes into the library. Runs in the browser
// (window.SimklBridge) and in Node for tests.
//
// Rules:
// - Only episodes watched after the last run are taken (with a small
//   overlap): an episode un-marked in the library is never brought back,
//   and nothing flows back to SIMKL.
// - A newly watched episode moves a Plan to Watch / On Hold show to
//   Watching; a show not in the library is added as Watching; Completed and
//   Dropped shows keep their status.
// - Numbers are translated the way the import did (LibraryCore.mapWatched,
//   checked against SIMKL's own episode list and air dates); an episode that
//   can't be placed is kept by its number, never dropped.
// - Every change is an ordinary library operation with an id made from the
//   episode and its watch time, so two devices running at once (or a rerun)
//   never record anything twice.
// - "How far it has read" is kept in the library (meta "simklBridge"),
//   shared by every device. Without it, it starts from the import time of
//   the library (or from now) - never from the whole history.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SimklBridge = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const META = "simklBridge";
  const OVERLAP_MS = 10 * 60 * 1000; // re-read the edge: SIMKL's clock and ours differ a little
  const CREATE_STATUS = "watching";
  const MOVE_TO_WATCHING = ["plantowatch", "hold"];
  const listItems = data => (Array.isArray(data) ? data : ((data && data.shows) || []));

  // createSimklBridge({ core, store, adapter, backend, simkl, now })
  // - simkl.get(path, params): resolves to SIMKL's JSON (reads only)
  // - backend: getMeta(name) / setMeta(name, data)
  function createSimklBridge({ core, store, adapter, backend, simkl, now = () => Date.now() }) {
    // Where to start when no run has been recorded: the newest import time in
    // the library (the import read SIMKL just before that), else now.
    function startingPoint() {
      let latest = null;
      for (const show of store.view().values()) {
        if (show.importedAt && (!latest || show.importedAt > latest)) latest = show.importedAt;
      }
      return latest;
    }

    async function simklEpisodeList(simklId) {
      if (simklId == null) return null;
      const list = await simkl.get(`/tv/episodes/${simklId}`, { extended: "full" }).catch(() => null);
      return Array.isArray(list) ? list.filter(e => e.season != null && e.episode != null).map(e => ({
        season: e.season, episode: e.episode, date: e.date || null, title: e.title || null, keys: [`simklep:${e.season}-${e.episode}`],
      })) : null;
    }

    async function applyOrThrow(docId, op) {
      const outcome = await store.apply(docId, op);
      if (outcome === "error") throw new Error(store.status().error || "Not saved");
      if (outcome === "conflict") throw new Error("changed on another device meanwhile - waiting for your choice");
      return outcome; // "saved", or "queued" (goes out once back online)
    }

    // One show from SIMKL with newly watched episodes.
    async function takeShow(item, newly, summary) {
      const show = item.show || {};
      const sIds = show.ids || {};
      const ids = { simklLegacy: sIds.simkl, tmdb: sIds.tmdb != null ? Number(sIds.tmdb) : null, imdb: sIds.imdb || null, tvdb: sIds.tvdb || null };
      let found = adapter.find(ids);
      const latestAt = newly.reduce((m, w) => (w.at > m ? w.at : m), "");

      if (!found) {
        await adapter.setStatus(ids, CREATE_STATUS, { title: show.title, year: show.year })
          .catch(e => { if (e.outcome !== "queued") throw e; });
        found = adapter.find(ids);
        if (!found) { summary.problems.push(`${show.title}: couldn't be added`); return; }
        summary.created.push(found.show.title);
      } else if (MOVE_TO_WATCHING.includes(found.show.status)) {
        await applyOrThrow(found.docId, { id: `simkl-bridge:${found.docId}:status:${latestAt}`, type: "setStatus", status: "watching", at: latestAt });
        summary.moved.push(found.show.title);
      }

      const eps = await adapter.episodes(found.docId);
      const mapping = core.mapWatched(newly, eps, await simklEpisodeList(sIds.simkl));
      const episodes = mapping.map(m => {
        const tvdbKey = m.w.tvdbId ? [`tvdb:${m.w.tvdbId}`] : [];
        if (m.ep) return { key: m.ep.keys[0], keys: [...m.ep.keys, ...tvdbKey], season: m.ep.season, episode: m.ep.episode, at: m.w.at };
        if (m.method !== "special") summary.unplaced.push(`${found.show.title} ${core.episodeCode(m.w.s, m.w.e)}`);
        return { key: `num:${m.w.s}-${m.w.e}`, keys: [`num:${m.w.s}-${m.w.e}`, ...tvdbKey], season: m.w.s, episode: m.w.e, at: m.w.at };
      });
      const before = store.view().get(found.docId);
      const fresh = episodes.filter(ep => !Object.entries(before.watched || {}).some(([k, rec]) =>
        [k, ...(rec.keys || [])].some(x => ep.keys.includes(x))));
      if (!fresh.length) return;
      const opId = `simkl-bridge:${found.docId}:${fresh.map(ep => `${ep.season}-${ep.episode}@${ep.at}`).join(",")}`;
      await applyOrThrow(found.docId, { id: opId, type: "setWatched", watched: true, at: latestAt, episodes: fresh });
      summary.added += fresh.filter(ep => ep.season !== 0).length;
      summary.shows.push(found.show.title);
    }

    // One pass. Resolves to { added, shows, created, moved, unplaced,
    // problems, upToDate?, started? }.
    async function run() {
      const summary = { added: 0, shows: [], created: [], moved: [], unplaced: [], problems: [] };
      const meta = (await backend.getMeta(META)) || {};
      const since = meta.since || startingPoint();
      if (!since) {
        await backend.setMeta(META, { since: new Date(now()).toISOString(), checkedAt: new Date(now()).toISOString() });
        return { ...summary, started: true };
      }
      const activities = await simkl.get("/sync/activities");
      const latest = activities && activities.tv_shows && activities.tv_shows.all;
      if (!latest || Date.parse(latest) <= Date.parse(since)) return { ...summary, upToDate: true };

      const data = await simkl.get("/sync/all-items/shows", {
        date_from: since, extended: "full", episode_watched_at: "yes", episode_tvdb_id: "yes", include_all_episodes: "original",
      });
      const cutoff = Date.parse(since) - OVERLAP_MS;
      for (const item of listItems(data)) {
        const newly = [];
        for (const s of item.seasons || []) {
          for (const e of s.episodes || []) {
            if (e.number == null || !e.watched_at || Date.parse(e.watched_at) <= cutoff) continue;
            newly.push({ s: s.number, e: e.number, at: e.watched_at, tvdbId: (e.ids && e.ids.tvdb_id) || null });
          }
        }
        if (!newly.length) continue;
        try {
          await takeShow(item, newly, summary);
        } catch (e) {
          summary.problems.push(`${(item.show || {}).title || "?"}: ${e.message}`);
        }
      }
      // Only a clean pass moves the starting point on; otherwise the same
      // episodes are tried again next time (nothing is ever recorded twice).
      if (!summary.problems.length) {
        await backend.setMeta(META, { since: latest, checkedAt: new Date(now()).toISOString() });
      }
      return summary;
    }

    return { run };
  }

  return { createSimklBridge, META };
});
