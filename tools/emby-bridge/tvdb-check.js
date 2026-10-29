// TheTVDB as a second opinion on air dates, as the site does it
// (withTvdbAirCheck in app.js): a show with an episode out in the past two
// weeks or due in the next two has TheTVDB's dates looked up; an episode they
// put days later waits for that day (EpisodeSource.holdForLaterDates), one they
// put days earlier - with TMDB agreeing - comes forward to it
// (advanceToEarlierDates). Without it the widget's dates were TVMaze's raw
// ones and could differ from the app's. Without the key, or the show's
// TheTVDB id, nothing changes.
//
// `inner`: SIMKL's times first (AirTimes.createSimklAirTimes), as on the site.
"use strict";

const TVDB_API = "https://api4.thetvdb.com/v4";
const DAY_MS = 86400000;
const CHECK_NEAR_MS = 14 * DAY_MS;
// As the site's: TheTVDB fixes dates of episodes days away, and an old copy
// holds an episode back to a day they've already dropped.
const CACHE_TTL_MS = 3 * 3600 * 1000;
const TIMEOUT_MS = 15000;

// createTvdbCheck({ key, EpisodeSource, source, inner, fetch, now })
// Returns airTimes(ids, episodes) for createLibraryAdapter.
function createTvdbCheck({ key, EpisodeSource, source, inner, fetch = (...a) => globalThis.fetch(...a), now = () => Date.now() }) {
  let token = null;
  let loginPending = null;
  let rejected = false;
  const cache = new Map(); // tvdbId -> { at, list }

  async function timed(url, options) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try { return await fetch(url, { ...options, signal: ctl.signal }); } finally { clearTimeout(timer); }
  }

  async function login() {
    const res = await timed(`${TVDB_API}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apikey: key }),
    });
    if (res.status === 401 || res.status === 403) { rejected = true; return null; }
    if (!res.ok) return null;
    return ((await res.json()).data || {}).token || null;
  }

  async function getToken(fresh) {
    if (token && !fresh) return token;
    if (!loginPending) loginPending = login().finally(() => { loginPending = null; });
    token = await loginPending;
    return token;
  }

  // The show's episodes on TheTVDB from a month back on, as
  // [{ season, episode, date }]; null if TheTVDB couldn't answer.
  async function recentEpisodes(tvdbId) {
    const hit = cache.get(tvdbId);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.list;
    let tok = await getToken(false);
    if (!tok) return null;
    const since = new Date(now() - 30 * DAY_MS).toISOString().slice(0, 10);
    const out = [];
    for (let page = 0; page < 20; page++) {
      const url = `${TVDB_API}/series/${tvdbId}/episodes/default?page=${page}`;
      let res = await timed(url, { headers: { Authorization: `Bearer ${tok}` } });
      if (res.status === 401 && (tok = await getToken(true))) {
        res = await timed(url, { headers: { Authorization: `Bearer ${tok}` } });
      }
      if (res.status === 404) break; // not in their database
      if (!res.ok) return null;
      const body = await res.json();
      for (const ep of ((body.data || {}).episodes) || []) {
        if (ep.aired && ep.aired >= since) out.push({ season: ep.seasonNumber, episode: ep.number, date: ep.aired });
      }
      if (!body.links || !body.links.next) break;
    }
    cache.set(tvdbId, { at: now(), list: out });
    return out;
  }

  return async function airTimes(ids, listed) {
    const eps = inner ? await inner(ids, listed).catch(() => listed) : listed;
    if (!key || rejected || !ids.tvdb) return eps;
    const at = now();
    const near = eps.some(ep => ep.date && ep.season && Math.abs(Date.parse(ep.date.length > 10 ? ep.date : ep.date + "T00:00:00") - at) < CHECK_NEAR_MS);
    if (!near) return eps;
    const check = await recentEpisodes(ids.tvdb).catch(() => null);
    if (!check) return eps;
    const held = EpisodeSource.holdForLaterDates(eps, check, at).episodes;
    const tmdb = ids.tmdb != null ? ((await source.getSourceLists(ids).catch(() => null)) || {}).tmdb : null;
    return tmdb ? EpisodeSource.advanceToEarlierDates(held, check, tmdb, at).episodes : held;
  };
}

module.exports = { createTvdbCheck };
