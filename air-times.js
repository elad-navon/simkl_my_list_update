// Air times from SIMKL: the episode lists (episode-source.js) know only the
// date of many streaming episodes; SIMKL often knows the hour. While this
// browser is connected to SIMKL (the auto-marking bridge), a show with a
// date-only episode coming up soon gets SIMKL's episode list, and each
// date-only episode takes SIMKL's time when:
//   - the time is a real one: SIMKL's midnight (in its own timezone) means
//     "some time that day", the same as no time;
//   - SIMKL's date (in its own timezone) is within a day of the date already
//     known - a US evening release is the next day elsewhere; a bigger gap
//     is a disagreement, and the known date stays as it is.
// Nothing else changes, and without SIMKL the lists stay date-only. Runs in
// the browser (window.AirTimes) and in Node for tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AirTimes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY_MS = 86400000;
  // Which date-only episodes make a show worth asking SIMKL about: from
  // yesterday (a US date can be a day behind the local one) to 3 days ahead.
  const WINDOW_BEFORE_DAYS = 1;
  const WINDOW_AFTER_DAYS = 3;
  // A show's SIMKL list is fetched again after this long, when needed...
  const FRESH_MS = 6 * 3600 * 1000;
  // ...and kept this long, so an episode keeps its time after it airs (the
  // page orders shows by when their latest episode came out).
  const KEEP_MS = 30 * DAY_MS;
  const LOOKUP_TTL_MS = 30 * DAY_MS;
  const TIMEOUT_MS = 8000;

  function localDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function dayDiff(a, b) {
    const ta = Date.parse(a.slice(0, 10) + "T00:00:00Z");
    const tb = Date.parse(b.slice(0, 10) + "T00:00:00Z");
    return isNaN(ta) || isNaN(tb) ? null : Math.abs(ta - tb) / DAY_MS;
  }

  const isDateOnly = ep => !!ep.date && ep.date.length === 10 && !ep.hasTime;

  // Whether any date-only episode falls in the window around today.
  function needsAirTimes(episodes, now) {
    const from = localDate(now - WINDOW_BEFORE_DAYS * DAY_MS);
    const to = localDate(now + WINDOW_AFTER_DAYS * DAY_MS);
    return (episodes || []).some(ep => isDateOnly(ep) && ep.date >= from && ep.date <= to);
  }

  // SIMKL's time for an episode, as a full ISO date-time, or null when it
  // has none worth taking: missing, unreadable, or midnight in SIMKL's own
  // timezone ("2026-10-21T00:00:00-04:00").
  function realTime(date) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(date || "");
    if (!m || (m[2] === "00" && m[3] === "00")) return null;
    const ts = Date.parse(date);
    return isNaN(ts) ? null : { day: m[1], iso: new Date(ts).toISOString() };
  }

  // The episodes, each date-only one with SIMKL's time where the rules
  // above allow it. `timed`: SIMKL's /tv/episodes list.
  function applyAirTimes(episodes, timed) {
    const byNum = new Map();
    for (const t of timed || []) {
      if (t && t.type === "episode" && t.season != null && t.episode != null) byNum.set(`${t.season}-${t.episode}`, t);
    }
    if (!byNum.size) return episodes;
    let changed = 0;
    const out = episodes.map(ep => {
      if (!isDateOnly(ep)) return ep;
      const twin = byNum.get(`${ep.season}-${ep.episode}`);
      const time = twin && realTime(twin.date);
      if (!time) return ep;
      const diff = dayDiff(time.day, ep.date);
      if (diff == null || diff > 1) return ep;
      changed++;
      return { ...ep, date: time.iso, hasTime: true, timeFrom: "simkl" };
    });
    return changed ? out : episodes;
  }

  // createSimklAirTimes({ get, cache, connected, now })
  // - get(path, params): a SIMKL GET (JSON or null for 404)
  // - cache: { get(key, ttlMs), set(key, value) }, either may be async
  // - connected(): whether SIMKL may be asked right now
  // Returns enrich(ids, episodes) -> Promise<episodes>; it never throws and
  // never holds the list up for more than a few seconds.
  function createSimklAirTimes({ get, cache, connected = () => true, now = () => Date.now(), timeoutMs = TIMEOUT_MS }) {
    const inFlight = new Map();

    // The show's SIMKL id: the one kept from the import, else looked up by
    // its other ids (asked of SIMKL only when `needed`).
    async function simklId(ids, needed) {
      if (ids.simklLegacy != null) return ids.simklLegacy;
      const query = ids.imdb ? { imdb: ids.imdb } : ids.tmdb != null ? { tmdb: ids.tmdb, type: "show" } : ids.tvdb ? { tvdb: ids.tvdb } : null;
      if (!query) return null;
      const key = `simkl-lookup:${Object.values(query)[0]}`;
      const hit = await cache.get(key, LOOKUP_TTL_MS);
      if (hit !== undefined || !needed) return hit === undefined ? null : hit;
      const found = await get("/search/id", query);
      const hitShow = (found || []).find(r => r && r.ids && r.ids.simkl != null);
      const id = hitShow ? hitShow.ids.simkl : null;
      await cache.set(key, id);
      return id;
    }

    // SIMKL's episode list for a show: a copy from the last FRESH_MS, else a
    // new one when `needed`, else whatever copy is still kept.
    async function simklEpisodes(id, needed) {
      const key = `simkl-episodes:${id}`;
      const fresh = await cache.get(key, FRESH_MS);
      if (fresh !== undefined) return fresh;
      if (needed) {
        if (!inFlight.has(key)) {
          inFlight.set(key, (async () => {
            const list = await get(`/tv/episodes/${id}`, { extended: "full" });
            const slim = (list || []).filter(e => e && e.type === "episode")
              .map(e => ({ type: "episode", season: e.season, episode: e.episode, date: e.date || null }));
            await cache.set(key, slim);
            return slim;
          })().finally(() => inFlight.delete(key)));
        }
        try { return await inFlight.get(key); } catch (e) { /* fall back to the kept copy */ }
      }
      const kept = await cache.get(key, KEEP_MS);
      return kept === undefined ? null : kept;
    }

    return async function enrich(ids, episodes) {
      if (!episodes || !episodes.length || !connected()) return episodes;
      const needed = needsAirTimes(episodes, now());
      const work = (async () => {
        const id = await simklId(ids, needed);
        if (id == null) return episodes;
        return applyAirTimes(episodes, await simklEpisodes(id, needed));
      })();
      let timer;
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(episodes), timeoutMs); });
      try {
        return await Promise.race([work.catch(() => episodes), timeout]);
      } finally {
        clearTimeout(timer);
      }
    };
  }

  return { createSimklAirTimes, applyAirTimes, needsAirTimes, realTime };
});
