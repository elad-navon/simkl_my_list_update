// TheTVDB's episode dates for the bridge's air-time check: logs in with the
// account's TheTVDB key and reads a show's episodes. What's done with them -
// which shows are checked, and when a date is held back or brought forward -
// is AirTimeChain.createTvdbCheck (air-time-chain.js), the same as the site's.
"use strict";

const TVDB_API = "https://api4.thetvdb.com/v4";
const DAY_MS = 86400000;
// As the site's: TheTVDB fixes dates of episodes days away, and an old copy
// holds an episode back to a day they've already dropped.
const CACHE_TTL_MS = 3 * 3600 * 1000;
const TIMEOUT_MS = 15000;

// createTvdbClient({ key, fetch, now }) -> { recentEpisodes, rejected }
// - recentEpisodes(tvdbId): the show's episodes on TheTVDB from a month back
//   on, as [{ season, episode, date }]; null if TheTVDB couldn't answer
// - rejected(): whether TheTVDB refused the key
function createTvdbClient({ key, fetch = (...a) => globalThis.fetch(...a), now = () => Date.now() }) {
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

  return { recentEpisodes, rejected: () => rejected };
}

module.exports = { createTvdbClient };
