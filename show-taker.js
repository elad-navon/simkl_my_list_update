// Takes newly watched episodes of one show into the library - what the
// computer's Emby bridge (tools/emby-bridge/emby-bridge.js) does with every
// episode Emby reports watched. Runs in Node (and in the browser as
// window.ShowTaker, though nothing there uses it now).
//
// Rules:
// - A newly watched episode moves a Plan to Watch / On Hold show to
//   Watching; a show not in the library is added as Watching; Completed and
//   Dropped shows keep their status.
// - Numbers are translated the way the import did (LibraryCore.mapWatched);
//   an episode that can't be placed is kept by its number, never dropped.
// - Every change is an ordinary library operation with an id made from the
//   episode and its watch time, so a rerun never records anything twice.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ShowTaker = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CREATE_STATUS = "watching";
  const MOVE_TO_WATCHING = ["plantowatch", "hold"];

  // One show with newly watched episodes goes into the library under the
  // rules above. createShowTaker({ core, store, adapter, prefix, by, episodeList })
  // - prefix: starts every operation id ("emby-bridge"), so the same
  //   episode from the same inbox is never recorded twice
  // - by: kept on every episode it marks ("emby"), to tell later what
  //   marked it
  // - episodeList(show): optional, the inbox's own episode list for the
  //   numbering check (mapWatched), or null
  // Returns takeShow(show, newly, summary) - show: { title, year, ids },
  // newly: [{ s, e, at, tvdbId }].
  function createShowTaker({ core, store, adapter, prefix, by, episodeList = async () => null }) {
    async function applyOrThrow(docId, op) {
      const outcome = await store.apply(docId, op);
      if (outcome === "error") throw new Error(store.status().error || "Not saved");
      if (outcome === "conflict") throw new Error("changed on another device meanwhile - waiting for your choice");
      return outcome; // "saved", or "queued" (goes out once back online)
    }

    return async function takeShow(show, newly, summary) {
      const ids = show.ids;
      let found = adapter.find(ids);
      const latestAt = newly.reduce((m, w) => (w.at > m ? w.at : m), "");

      if (!found) {
        await adapter.setStatus(ids, CREATE_STATUS, { title: show.title, year: show.year })
          .catch(e => { if (e.outcome !== "queued") throw e; });
        found = adapter.find(ids);
        if (!found) { summary.problems.push(`${show.title}: couldn't be added`); return; }
        summary.created.push(found.show.title);
      } else if (MOVE_TO_WATCHING.includes(found.show.status)) {
        await applyOrThrow(found.docId, { id: `${prefix}:${found.docId}:status:${latestAt}`, type: "setStatus", status: "watching", at: latestAt });
        summary.moved.push(found.show.title);
      }

      const eps = await adapter.episodes(found.docId);
      const mapping = core.mapWatched(newly, eps, await episodeList(show));
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
      const opId = `${prefix}:${found.docId}:${fresh.map(ep => `${ep.season}-${ep.episode}@${ep.at}`).join(",")}`;
      await applyOrThrow(found.docId, { id: opId, type: "setWatched", watched: true, at: latestAt, by, episodes: fresh });
      summary.added += fresh.filter(ep => ep.season !== 0).length;
      summary.shows.push(found.show.title);
    };
  }

  return { createShowTaker };
});
