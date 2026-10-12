// Episode source: every show's full episode list with air dates, from
// TVMaze (exact date + time when it knows the air time) and TMDB (date
// only), without SIMKL. Runs in the browser (window.EpisodeSource) and in
// Node for tests - fetch / tmdbGet / cache are passed in.
//
// Each episode comes back as:
//   { season, episode, date, hasTime, title, runtime, keys }
// `date` is a full ISO date-time only when the air time is really known,
// otherwise "YYYY-MM-DD" - never a made-up time. `keys` are the episode's
// stable ids in each source that has it ("tvmaze:123", "tmdb:456"); a TMDB
// key is only attached to a TVMaze episode when both the numbers and the
// air dates (within 2 days) agree.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EpisodeSource = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TVMAZE_BASE = "https://api.tvmaze.com";
  const DAY_MS = 86400000;
  const MATCH_WINDOW_DAYS = 2;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function dayDiff(a, b) {
    if (!a || !b) return null;
    const ta = Date.parse(a.slice(0, 10) + "T00:00:00Z");
    const tb = Date.parse(b.slice(0, 10) + "T00:00:00Z");
    return isNaN(ta) || isNaN(tb) ? null : Math.abs(ta - tb) / DAY_MS;
  }

  function localDate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Not aired yet by `now` (same rule as LibraryCore.isAired): undated, a
  // future moment, or a date-only episode from today on.
  function isUpcoming(ep, now) {
    if (!ep.date) return true;
    if (ep.date.length > 10) { const ts = Date.parse(ep.date); return isNaN(ts) || ts > now; }
    return ep.date >= localDate(now);
  }

  // `base` plus the episodes only `extra` knows about that haven't aired
  // yet - so a season the main source hasn't listed still shows up as
  // coming. Never adds a past episode (numbering between sources can
  // differ, and the past is the main source's to describe). With
  // afterBaseEnd, only episodes dated after the base's last dated episode.
  // An episode dated before the base's last dated one is never added either:
  // it contradicts the base (e.g. a second episode listed a day before the
  // first) and would wrongly become "the next episode".
  function appendUpcoming(base, extra, now, { afterBaseEnd = false } = {}) {
    const nums = new Set(base.map(e => `${e.season}-${e.episode}`));
    const baseDates = base.map(e => e.date && e.date.slice(0, 10)).filter(Boolean).sort();
    const lastBase = baseDates.length ? baseDates[baseDates.length - 1] : null;
    const added = (extra || []).filter(e => isUpcoming(e, now) && !nums.has(`${e.season}-${e.episode}`) &&
      (!lastBase || !e.date || (afterBaseEnd ? e.date.slice(0, 10) > lastBase : e.date.slice(0, 10) >= lastBase)));
    return { episodes: [...base, ...added], added: added.length };
  }

  // "TBA", "TBD", "Episode 3": a placeholder, not a title.
  function realTitle(name) {
    const t = String(name || "").trim();
    return !t || /^(TBA|TBD|TBC)$/i.test(t) || /^Episode\s+\d+$/i.test(t) ? null : t;
  }

  function fromTvmaze(ep) {
    if (ep.number == null || ep.season == null) return null; // specials
    const hasTime = !!(ep.airtime && ep.airstamp);
    return {
      season: ep.season, episode: ep.number,
      date: hasTime ? ep.airstamp : (ep.airdate || null),
      hasTime,
      title: realTitle(ep.name),
      runtime: ep.runtime || null,
      keys: [`tvmaze:${ep.id}`],
    };
  }

  function fromTmdb(season, ep) {
    return {
      season, episode: ep.episode_number,
      date: ep.air_date || null,
      hasTime: false,
      title: realTitle(ep.name),
      runtime: ep.runtime || null,
      keys: [`tmdb:${ep.id}`],
    };
  }

  // How long a show's TVMaze id (from a lookup) is trusted - it never
  // changes, the long expiry only bounds the cache.
  const LOOKUP_TTL_MS = 30 * DAY_MS;
  // With useUpdates, an episode list stays valid until TVMaze reports the
  // show as updated - TVMaze's update list covers the past week, so a copy
  // older than that is fetched again regardless.
  const UPDATES_WINDOW_MS = 6 * DAY_MS;

  // createEpisodeSource({ fetch, tmdbGet, cache, ttlMs, minGapMs, useUpdates })
  // - fetch: window.fetch (or a stand-in in tests)
  // - tmdbGet(path, params): resolves to TMDB JSON or null (404)
  // - cache: optional { get(key, ttlMs) -> value|undefined, set(key, value) };
  //   either may return a promise
  // - useUpdates: ask TVMaze once per session which shows changed this week
  //   (one request), and keep every other cached episode list - so a reload
  //   refetches only the shows that actually changed, not all of them.
  function createEpisodeSource({ fetch: fetchFn, tmdbGet, cache, ttlMs = 6 * 3600 * 1000, minGapMs = 520, useUpdates = false }) {
    const inFlight = new Map();
    let nextTvmazeAt = 0;
    let updatesPromise = null;

    function once(key, fn) {
      if (!inFlight.has(key)) inFlight.set(key, fn().finally(() => inFlight.delete(key)));
      return inFlight.get(key);
    }

    async function cached(key, fn, ttl = ttlMs) {
      if (cache) {
        const hit = await cache.get(key, ttl);
        if (hit !== undefined) return hit;
      }
      const value = await fn();
      if (cache && value !== undefined) await cache.set(key, value);
      return value;
    }

    // TVMaze allows about 20 calls per 10 seconds per address: one call at
    // a time, spaced out, and a 429 waits and retries (up to 3 times).
    async function tvmazeGet(path) {
      for (let attempt = 0; ; attempt++) {
        const now = Date.now();
        const at = Math.max(now, nextTvmazeAt);
        nextTvmazeAt = at + minGapMs;
        if (at > now) await sleep(at - now);
        let res;
        try {
          res = await fetchFn(`${TVMAZE_BASE}${path}`);
        } catch (e) {
          if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
          throw new Error(`TVMaze unreachable: ${e.message}`);
        }
        if (res.status === 404) return null;
        if (res.status === 429 && attempt < 3) { await sleep(2000 * 2 ** attempt); continue; }
        if (!res.ok) throw new Error(`TVMaze request failed (${res.status})`);
        return res.json();
      }
    }

    // The TVMaze show for a set of ids (IMDb first, then TheTVDB), or null.
    function lookupTvmaze(ids) {
      const key = `tvmaze-lookup:${ids.imdb || ""}:${ids.tvdb || ""}`;
      return once(key, () => cached(key, async () => {
        let show = null;
        if (ids.imdb) show = await tvmazeGet(`/lookup/shows?imdb=${encodeURIComponent(ids.imdb)}`);
        if (!show && ids.tvdb) show = await tvmazeGet(`/lookup/shows?thetvdb=${encodeURIComponent(ids.tvdb)}`);
        return show ? { id: show.id, name: show.name, premiered: show.premiered || null } : null;
      }, LOOKUP_TTL_MS));
    }

    // { tvmazeId: last update, in seconds } for the past week, or null if
    // TVMaze couldn't say (then the plain ttlMs expiry applies).
    function recentUpdates() {
      if (!updatesPromise) {
        updatesPromise = tvmazeGet("/updates/shows?since=week").catch(() => null);
      }
      return updatesPromise;
    }

    function tvmazeEpisodes(tvmazeId) {
      const key = `tvmaze-episodes2:${tvmazeId}`;
      const fetchList = async () => {
        const list = await tvmazeGet(`/shows/${tvmazeId}/episodes`);
        return { fetchedAt: Date.now(), episodes: (list || []).map(fromTvmaze).filter(Boolean) };
      };
      return once(key, async () => {
        if (useUpdates && cache) {
          const hit = await cache.get(key, UPDATES_WINDOW_MS);
          if (hit && hit.episodes) {
            const updates = await recentUpdates();
            const changedAt = updates ? updates[tvmazeId] : undefined;
            const fresh = updates
              ? !(changedAt && changedAt * 1000 > hit.fetchedAt)
              : Date.now() - hit.fetchedAt < ttlMs;
            if (fresh) return hit.episodes;
          }
          const value = await fetchList();
          await cache.set(key, value);
          return value.episodes;
        }
        return (await cached(key, fetchList)).episodes;
      });
    }

    function tmdbEpisodes(tmdbId) {
      const key = `tmdb-episodes:${tmdbId}`;
      return once(key, () => cached(key, async () => {
        const detail = await tmdbGet(`/tv/${tmdbId}`);
        if (!detail) return null;
        const out = [];
        for (const s of detail.seasons || []) {
          if (s.season_number == null || s.season_number === 0) continue;
          const season = await tmdbGet(`/tv/${tmdbId}/season/${s.season_number}`);
          for (const ep of (season && season.episodes) || []) out.push(fromTmdb(s.season_number, ep));
        }
        return out;
      }));
    }

    // Links each TVMaze episode to its TMDB twin (same numbers, air dates
    // within MATCH_WINDOW_DAYS) and reports where the two sources disagree.
    function linkSources(tvm, tmdb) {
      const tmdbByNum = new Map(tmdb.map(e => [`${e.season}-${e.episode}`, e]));
      const disagreements = [];
      const linked = tvm.map(e => {
        const twin = tmdbByNum.get(`${e.season}-${e.episode}`);
        if (!twin) return e;
        const diff = dayDiff(e.date, twin.date);
        if (diff != null && diff > MATCH_WINDOW_DAYS) {
          disagreements.push({ season: e.season, episode: e.episode, tvmaze: e.date, tmdb: twin.date });
          return e;
        }
        return { ...e, keys: [...e.keys, ...twin.keys], runtime: e.runtime || twin.runtime, title: e.title || twin.title };
      });
      const tvmNums = new Set(tvm.map(e => `${e.season}-${e.episode}`));
      const onlyInTmdb = tmdb.filter(e => !tvmNums.has(`${e.season}-${e.episode}`)).map(e => ({ season: e.season, episode: e.episode }));
      const onlyInTvmaze = tvm.filter(e => !tmdbByNum.has(`${e.season}-${e.episode}`)).map(e => ({ season: e.season, episode: e.episode }));
      return { episodes: linked, disagreements, onlyInTmdb, onlyInTvmaze };
    }

    // Both sources' own lists, unmerged:
    //   { tvmazeId, tvmaze: [...] | null, tmdb: [...] | null, errors }
    // A failing source is reported in `errors`, never thrown, so one bad
    // show can't break a whole list.
    async function getSourceLists(ids) {
      const errors = [];
      let tvmazeShow = null, tvm = null, tmdb = null;
      await Promise.all([
        (async () => {
          try {
            tvmazeShow = ids.tvmaze ? { id: ids.tvmaze }
              : (ids.imdb || ids.tvdb) ? await lookupTvmaze(ids) : null;
            if (tvmazeShow) tvm = await tvmazeEpisodes(tvmazeShow.id);
          } catch (e) { errors.push(e.message); }
        })(),
        (async () => {
          try {
            if (ids.tmdb != null) tmdb = await tmdbEpisodes(ids.tmdb);
          } catch (e) { errors.push(`TMDB: ${e.message}`); }
        })(),
      ]);
      return { tvmazeId: tvmazeShow ? tvmazeShow.id : null, tvmaze: tvm && tvm.length ? tvm : null, tmdb: tmdb && tmdb.length ? tmdb : null, errors };
    }

    // TMDB episodes, each linked to its TVMaze twin when numbers and dates
    // agree (the TMDB-first counterpart of linkSources).
    function linkTmdbFirst(tmdb, tvm) {
      const tvmByNum = new Map((tvm || []).map(e => [`${e.season}-${e.episode}`, e]));
      return tmdb.map(e => {
        const twin = tvmByNum.get(`${e.season}-${e.episode}`);
        const diff = twin ? dayDiff(e.date, twin.date) : null;
        if (!twin || (diff != null && diff > MATCH_WINDOW_DAYS)) return e;
        const linked = { ...e, keys: [...e.keys, ...twin.keys], title: e.title || twin.title, runtime: e.runtime || twin.runtime };
        // TMDB has dates only; TVMaze's exact air time for the same episode
        // (its date in UTC can be a day later than TMDB's local one).
        if (twin.hasTime && diff != null && diff <= 1) { linked.date = twin.date; linked.hasTime = true; }
        return linked;
      });
    }

    // getEpisodes(ids, { prefer }) ->
    //   { source: "tvmaze" | "tmdb" | "none", tvmazeId, episodes,
    //     disagreements, onlyInTmdb, onlyInTvmaze, errors }
    // TVMaze is the default (it has air times); `prefer: "tmdb"` pins a show
    // to TMDB's numbering when that's the one that matches its history.
    async function getEpisodes(ids, { prefer, now = Date.now() } = {}) {
      const lists = await getSourceLists(ids);
      const { tvmaze: tvm, tmdb, errors, tvmazeId } = lists;
      const empty = { disagreements: [], onlyInTmdb: [], onlyInTvmaze: [] };
      if (tmdb && (prefer === "tmdb" || !tvm)) {
        const { disagreements, onlyInTmdb, onlyInTvmaze } = tvm ? linkSources(tvm, tmdb) : empty;
        const filled = appendUpcoming(linkTmdbFirst(tmdb, tvm), tvm, now);
        return { source: "tmdb", tvmazeId, episodes: filled.episodes, upcomingFromOther: filled.added, disagreements, onlyInTmdb, onlyInTvmaze, errors };
      }
      if (tvm) {
        const linked = tmdb ? linkSources(tvm, tmdb) : { episodes: tvm, ...empty };
        const filled = appendUpcoming(linked.episodes, tmdb, now);
        return { source: "tvmaze", tvmazeId, ...linked, episodes: filled.episodes, upcomingFromOther: filled.added, errors };
      }
      return { source: "none", tvmazeId, episodes: [], upcomingFromOther: 0, ...empty, errors };
    }

    return { getEpisodes, getSourceLists, lookupTvmaze, linkSources };
  }

  // A simple in-memory cache with the { get(key, ttlMs), set } shape.
  function memoryCache() {
    const map = new Map();
    return {
      get(key, ttlMs) {
        const hit = map.get(key);
        return hit && Date.now() - hit.t < ttlMs ? hit.v : undefined;
      },
      set(key, v) { map.set(key, { t: Date.now(), v }); },
    };
  }

  return { createEpisodeSource, memoryCache, fromTvmaze, fromTmdb, appendUpcoming, isUpcoming, realTitle };
});
