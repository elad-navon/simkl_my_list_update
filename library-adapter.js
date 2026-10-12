// Library adapter: answers the questions app.js used to ask SIMKL - the
// lists by status, a show's episode list, a show's library status, and
// every library change - from the app's own library (LibraryStore) and
// outside episode lists (EpisodeSource), in SIMKL's own shapes, so the UI
// code keeps working as it is. Runs in the browser (window.LibraryAdapter)
// and in Node for tests.
//
// A library show's document id travels as item.show.ids.library (row.showId
// on the page), for menus, the episodes manager and de-duplication.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LibraryAdapter = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const OUTCOME_MESSAGES = {
    queued: "No connection - the change is kept on this device and will be saved once you're back online.",
    conflict: "Not saved - this show was changed on another device.",
    error: "Not saved",
  };

  // createLibraryAdapter({ core, store, source, appendUpcoming, showMeta, now, onProgress })
  // - core: LibraryCore; store: a LibraryStore (already loaded)
  // - source: an EpisodeSource; appendUpcoming: EpisodeSource.appendUpcoming
  // - showMeta(tmdbId): optional, resolves to { title, year, imdb, tvdb }
  //   from TMDB (English title) - fills in a show being added
  // - onProgress(done, total): optional, while episode lists load
  function createLibraryAdapter({ core, store, source, appendUpcoming, showMeta, now = () => Date.now(), onProgress }) {
    let episodeMemo = new Map(); // docId -> Promise<episodes>
    const failures = new Map();  // docId -> title, shows whose list couldn't load
    let progress = { done: 0, total: 0 };

    // The ids the episode source looks up a show by. A show added from a
    // TMDB search result carries only its TMDB id; TVMaze needs an IMDb or
    // TheTVDB one, so those come from TMDB's details when missing.
    async function sourceIds(show) {
      const ids = { tmdb: show.ids.tmdb, imdb: show.ids.imdb || null, tvdb: show.ids.tvdb || null, tvmaze: show.ids.tvmaze || null };
      if (!ids.imdb && !ids.tvdb && !ids.tvmaze && ids.tmdb != null && showMeta) {
        const meta = await showMeta(ids.tmdb).catch(() => null);
        if (meta) { ids.imdb = meta.imdb || null; ids.tvdb = meta.tvdb || null; }
      }
      return ids;
    }

    // The show's episode list. Which source fits the show's history was
    // decided at import: TVMaze (default, has air times), TMDB, or a fixed
    // snapshot of the old service's list (still topped up with episodes
    // announced since, from the outside sources).
    async function loadEpisodes(docId, show) {
      const ids = await sourceIds(show);
      try {
        if (show.episodeSource === "snapshot" && Array.isArray(show.snapshotEpisodes)) {
          const res = await source.getEpisodes(ids, { now: now() });
          return appendUpcoming(show.snapshotEpisodes, res.episodes, now(), { afterBaseEnd: true }).episodes;
        }
        const res = await source.getEpisodes(ids, { prefer: show.episodeSource === "tmdb" ? "tmdb" : undefined, now: now() });
        if (!res.episodes.length && res.errors && res.errors.length) failures.set(docId, show.title);
        else failures.delete(docId);
        return res.episodes;
      } catch (e) {
        failures.set(docId, show.title);
        return [];
      }
    }

    function episodesFor(docId, show) {
      if (!episodeMemo.has(docId)) {
        progress.total++;
        episodeMemo.set(docId, loadEpisodes(docId, show).then(eps => {
          progress.done++;
          if (onProgress) onProgress(progress.done, progress.total);
          return eps;
        }));
      }
      return episodeMemo.get(docId);
    }

    // SIMKL's /sync/all-items item for one library show.
    function itemFor(docId, show, episodes) {
      const item = core.toSimklShape(show, episodes, now());
      item.show.ids.library = docId;
      // SIMKL's show runtime was only a fallback for TMDB's per-episode
      // runtimes; the episode list's own average plays the same part.
      item.show.runtime = core.averageRuntime(episodes);
      item.autoStarted = show.autoStarted == null ? null : show.autoStarted;
      return item;
    }

    function idsMatch(docId, show, ids) {
      if (!ids) return false;
      if (ids.library != null && String(ids.library) === docId) return true;
      const own = show.ids || {};
      // simklLegacy: the show's SIMKL id (the auto-marking bridge).
      if (ids.simklLegacy != null && own.simklLegacy != null && String(ids.simklLegacy) === String(own.simklLegacy)) return true;
      return (ids.tmdb != null && own.tmdb != null && String(ids.tmdb) === String(own.tmdb)) ||
        (!!ids.imdb && ids.imdb === own.imdb) ||
        (!!ids.tvdb && own.tvdb != null && String(ids.tvdb) === String(own.tvdb));
    }

    function findDoc(ids) {
      for (const [docId, show] of store.view()) {
        if (idsMatch(docId, show, ids)) return { docId, show };
      }
      return null;
    }

    async function run(docId, op) {
      const outcome = await store.apply(docId, op);
      if (outcome === "saved") return outcome;
      const status = store.status();
      const detail = outcome === "conflict" && status.conflict ? status.conflict.reason
        : outcome === "error" && status.error ? status.error : null;
      const err = new Error(detail ? `Not saved: ${detail}` : OUTCOME_MESSAGES[outcome]);
      err.outcome = outcome;
      throw err;
    }

    const iso = () => new Date(now()).toISOString();

    return {
      // A fresh look at the episode lists (each refresh of the page) - the
      // episode source's own cache still spares repeat downloads.
      reset() {
        episodeMemo = new Map();
        progress = { done: 0, total: 0 };
      },
      failures: () => [...failures.values()],

      // The library show matching any of these ids: { docId, show } or null.
      find: ids => findDoc(ids),
      // A library show's episode list (the episode source's shape).
      episodes(docId) {
        const show = store.view().get(String(docId));
        return show ? episodesFor(String(docId), show) : Promise.resolve([]);
      },

      // Like GET /sync/all-items/shows/{status}. A show's episode list is
      // needed for its counts and next episode; withEpisodes: false skips
      // it where only the last watched episode matters (Recently Watched's
      // dropped shows).
      async items(status, { withEpisodes = true } = {}) {
        const shows = [...store.view()].filter(([, show]) => show.status === status);
        return Promise.all(shows.map(async ([docId, show]) =>
          itemFor(docId, show, withEpisodes ? await episodesFor(docId, show) : [])));
      },

      // Like GET /tv/episodes/{id}: [{ season, episode, date, title, runtime }], or
      // null for a show that isn't in the library or has no list.
      async showEpisodes(docId) {
        const show = store.view().get(String(docId));
        if (!show) return null;
        const eps = await episodesFor(String(docId), show);
        return eps.length ? eps.map(e => ({ season: e.season, episode: e.episode, date: e.date || null, title: e.title || null, runtime: e.runtime || null })) : null;
      },

      // Like findShowLibraryStatus: { status, item } or null.
      async findStatus(ids) {
        const found = findDoc(ids);
        if (!found) return null;
        const eps = await episodesFor(found.docId, found.show);
        return { status: found.show.status, item: itemFor(found.docId, found.show, eps) };
      },

      // Adds a show with this status, or moves it there if it's already in
      // the library. extra: { title, year, autoStarted }.
      async setStatus(ids, status, extra = {}) {
        const found = findDoc(ids);
        if (found) {
          return run(found.docId, { type: "setStatus", status, at: iso(), autoStarted: extra.autoStarted });
        }
        const meta = ids.tmdb != null && showMeta ? await showMeta(ids.tmdb).catch(() => null) : null;
        const fullIds = {
          tmdb: ids.tmdb != null ? ids.tmdb : null,
          imdb: ids.imdb || (meta && meta.imdb) || null,
          tvdb: ids.tvdb || (meta && meta.tvdb) || null,
          simklLegacy: ids.simklLegacy != null ? ids.simklLegacy : null,
        };
        const docId = core.showDocId(fullIds);
        if (!docId) throw new Error("This show has no TMDB, IMDb or TheTVDB id, so it can't be added.");
        const year = Number((meta && meta.year) || extra.year) || null;
        const show = core.createShow({ ids: fullIds, title: (meta && meta.title) || extra.title, year, status, now: now() });
        if (extra.autoStarted !== undefined) show.autoStarted = extra.autoStarted;
        return run(docId, { type: "create", show, at: iso() });
      },

      async remove(docId) {
        if (!store.view().has(String(docId))) throw new Error("This show isn't in your list.");
        return run(String(docId), { type: "remove" });
      },

      // Marks episodes (by their number within `season`, as shown on the
      // page) watched or not watched. A watched record is found the same
      // way the page placed it - by a shared episode key, else by number -
      // so un-marking always clears what is shown.
      async setWatched(docId, season, episodeNumbers, watched) {
        docId = String(docId);
        const show = store.view().get(docId);
        if (!show) throw new Error("This show isn't in your list.");
        const eps = (await episodesFor(docId, show)).filter(core.isRegular);
        const shownAs = new Map(); // "s-e" -> [record keys]
        for (const [key, rec] of Object.entries(show.watched || {})) {
          const found = core.findEpisodeForRecord(rec, key, eps);
          const s = found ? found.ep.season : rec.s, e = found ? found.ep.episode : rec.e;
          const k = `${s}-${e}`;
          if (!shownAs.has(k)) shownAs.set(k, []);
          shownAs.get(k).push(key);
        }
        const targets = [];
        for (const n of episodeNumbers) {
          const recordKeys = shownAs.get(`${season}-${n}`) || [];
          if (watched) {
            if (recordKeys.length) continue; // already watched
            const ep = eps.find(e => e.season === season && e.episode === n);
            const keys = ep && ep.keys && ep.keys.length ? ep.keys : [`num:${season}-${n}`];
            targets.push({ key: keys[0], keys, season, episode: n });
          } else {
            for (const key of recordKeys) {
              targets.push({ key, keys: show.watched[key].keys || [key], season, episode: n });
            }
          }
        }
        if (!targets.length) return "saved";
        return run(docId, { type: "setWatched", watched, at: iso(), episodes: targets });
      },
    };
  }

  // A key-value cache in IndexedDB (browser only), with an in-memory layer
  // in front: the { get(key, ttlMs), set(key, value) } shape EpisodeSource
  // takes. Episode lists are far too big for localStorage's small quota,
  // which the rest of the app's caches already share. `persist(key)` picks
  // what is written to disk; the rest stays in memory for the session.
  // Any IndexedDB failure just leaves the memory layer working.
  // A browser that never answers (seen with blocked or broken storage) must
  // not hold the page up: every IndexedDB step gives up after a moment.
  const IDB_TIMEOUT_MS = 3000;
  function idbCache({ name = "tv-library-cache", persist = () => true } = {}) {
    const mem = new Map();
    let dbPromise = null;
    function db() {
      if (!dbPromise) {
        dbPromise = new Promise(resolve => {
          setTimeout(() => resolve(null), IDB_TIMEOUT_MS);
          try {
            const req = indexedDB.open(name, 1);
            req.onupgradeneeded = () => req.result.createObjectStore("kv");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
          } catch (e) { resolve(null); }
        });
      }
      return dbPromise;
    }
    function idbGet(d, key) {
      return new Promise(resolve => {
        setTimeout(() => resolve(undefined), IDB_TIMEOUT_MS);
        try {
          const req = d.transaction("kv").objectStore("kv").get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
      });
    }
    return {
      async get(key, ttlMs) {
        let hit = mem.get(key);
        if (!hit && persist(key)) {
          const d = await db();
          if (d) hit = await idbGet(d, key);
          if (hit) mem.set(key, hit);
        }
        return hit && Date.now() - hit.t < ttlMs ? hit.v : undefined;
      },
      async set(key, v) {
        const entry = { t: Date.now(), v };
        mem.set(key, entry);
        if (!persist(key)) return;
        const d = await db();
        if (!d) return;
        try { d.transaction("kv", "readwrite").objectStore("kv").put(entry, key); } catch (e) { /* memory copy still serves */ }
      },
    };
  }

  return { createLibraryAdapter, idbCache, OUTCOME_MESSAGES };
});
