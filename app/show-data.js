"use strict";

// What's known about each show: TMDB / MDBList caches, ratings, episode
// counts and runtimes, images, and the rows My List, Recently Watched and Plan
// to Watch are drawn from.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// ---------------------------------------------------------------------
// TMDB - per-episode runtimes
// ---------------------------------------------------------------------
async function tmdbGet(path, params) {
  const { tmdbKey } = getConfig();
  const p = new URLSearchParams({ api_key: tmdbKey, ...(params || {}) });
  let res;
  try {
    res = await fetch(`${TMDB_BASE}${path}?${p}`);
  } catch (e) {
    throw new Error("Network/CORS error reaching TMDB: " + e.message);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDB request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------
// Persistent (localStorage-backed) layer for the per-show API caches
// below. The in-memory Maps in each class already dedupe concurrent
// requests within one page load; this adds a second layer so a page
// RELOAD/reopen can skip the network entirely for anything fetched
// recently, instead of re-fetching every show from scratch every time.
// Each entry is timestamped and expires after its own TTL - short enough
// that "next episode" dates/ratings/images don't go stale for long, but
// long enough that a reload a few minutes (or hours) later is instant.
// Only successful (non-null) results are persisted; a failed fetch
// resolves to null in-memory as before but is never written to storage,
// so a transient network error doesn't "poison" the cache.
// ---------------------------------------------------------------------
const API_CACHE_PREFIX = "simkl_apicache:";
const CACHE_TTL_TMDB_SHOW_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_TMDB_SEASON_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_RECENT_SHOW_MS = 3 * 60 * 60 * 1000; // ratings of shows in their first month, see isRecentShow
const RECENT_SHOW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// True for a show whose first episode aired within the last 30 days (or is
// still upcoming). `firstAirDate` is TMDB's "YYYY-MM-DD" first_air_date.
function isRecentShow(firstAirDate) {
  if (!firstAirDate) return false;
  const t = new Date(firstAirDate + "T00:00:00").getTime();
  return !isNaN(t) && Date.now() - t < RECENT_SHOW_WINDOW_MS;
}
const CACHE_TTL_TMDB_EPISODE_IDS_MS = 7 * 24 * 60 * 60 * 1000; // an episode's IMDb id never changes
const CACHE_TTL_TMDB_CREDITS_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_TMDB_PERSON_IDS_MS = 7 * 24 * 60 * 60 * 1000; // a person's IMDb id never changes

// The cache lives in IndexedDB (LibraryAdapter.idbCache): localStorage's
// ~5 million characters held a fraction of it - the shows' full image
// lists and the seasons' casts alone are megabytes - so every load evicted
// the oldest entries (the small TheTVDB and rating ones among them) and the
// next load fetched them all again. A read resolves to the value, or
// undefined if missing or older than ttlMs.
let apiCache = null;
function apiCacheStore() {
  if (!apiCache) apiCache = LibraryAdapter.idbCache({ name: "tv-api-cache" });
  return apiCache;
}
function readPersistedCache(key, ttlMs) {
  return Promise.resolve(apiCacheStore().get(key, ttlMs)).catch(() => undefined);
}
function writePersistedCache(key, value) {
  Promise.resolve(apiCacheStore().set(key, value)).catch(() => {});
}

// Once per load: the old copies in localStorage go (they only took the
// space settings need), and a while after the page is up, entries past the
// longest time any of them is used (7 days) are deleted from IndexedDB.
const MAX_PERSISTED_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function prunePersistedCache() {
  try {
    const old = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(API_CACHE_PREFIX)) old.push(key);
    }
    old.forEach(key => localStorage.removeItem(key));
  } catch (e) {
    // localStorage unavailable - nothing to remove
  }
  setTimeout(() => { Promise.resolve(apiCacheStore().prune(MAX_PERSISTED_CACHE_AGE_MS)).catch(() => {}); }, 30000);
}


// TMDB's details, seasons, credits and ids, kept per their own time
// (outside-sources.js). `new TmdbCache()` as always.
function TmdbCache() {
  return OutsideSources.createTmdbClient({
    get: tmdbGet,
    persisted: { read: readPersistedCache, write: writePersistedCache },
    ttl: { show: CACHE_TTL_TMDB_SHOW_MS, season: CACHE_TTL_TMDB_SEASON_MS, episodeIds: CACHE_TTL_TMDB_EPISODE_IDS_MS,
      credits: CACHE_TTL_TMDB_CREDITS_MS, personIds: CACHE_TTL_TMDB_PERSON_IDS_MS },
  });
}

function latestNetwork(showDetail) {
  // TMDB lists ALL networks a show has ever aired on when it moved between
  // them over the years, not just the current one - e.g. an Israeli show
  // that aired on Channel 2, then Reshet 13, then Channel 12 lists all
  // three, oldest first. The first entry is the original network, not the
  // current one, so use the last entry instead.
  const list = showDetail && showDetail.networks;
  return list && list.length ? list[list.length - 1] : null;
}

// TMDB's content_ratings.results is one entry per country ("US": "TV-MA",
// "GB": "15", etc.) - US is what every other age-rating badge in US-style
// media UIs shows, so prefer it and fall back to whichever country has a
// non-empty rating first rather than showing nothing.
function extractContentRating(showDetail) {
  const results = showDetail && showDetail.content_ratings && showDetail.content_ratings.results;
  if (!results || !results.length) return null;
  const us = results.find(r => r.iso_3166_1 === "US" && r.rating);
  if (us) return us.rating;
  const any = results.find(r => r.rating);
  return any ? any.rating : null;
}

// "Action & Adventure and Crime" (TMDB's own genre list style, e.g. on a
// show's themoviedb.org page) rather than a plain comma list.
function joinGenreNames(names) {
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function extractGenreLabel(showDetail) {
  const genres = showDetail && showDetail.genres;
  if (!genres || !genres.length) return null;
  return joinGenreNames(genres.map(g => g.name).filter(Boolean));
}

function normalizeNetworkName(name) {
  // Some networks get referred to with or without a trailing channel
  // number depending on the source/show - e.g. Israeli "Reshet"/"Reshet 13"
  // or "Keshet"/"Keshet 12" are the same network. Stripping a trailing
  // " <number>" and lowercasing lets those forms match the same
  // LOCAL_NETWORK_LOGOS entry regardless of exact formatting.
  return (name || "").trim().replace(/\s+\d+$/, "").trim().toLowerCase();
}

function findLocalNetworkLogo(networkName) {
  // A single network can also show up under different names entirely
  // depending on the source - e.g. "Reshet" (TMDB, English) vs "רשת"
  // (Hebrew) - so each entry lists every name variant it should
  // match, not just one.
  const key = normalizeNetworkName(networkName);
  if (!key) return null;
  const entry = LOCAL_NETWORK_LOGOS.find(e => e.names.some(n => normalizeNetworkName(n) === key));
  return entry ? entry.logo : null;
}

function resolveNetworkLogoUrl(networkName, tmdbLogoPath) {
  if (tmdbLogoPath) return TMDB_LOGO_BASE + tmdbLogoPath;
  return findLocalNetworkLogo(networkName);
}

// Rotten Tomatoes (critics + audience) and Trakt come from MDBList, which
// aggregates them behind one request per show. Needs a free API key from
// mdblist.com (Settings); without one this quietly returns nothing and the
// rest of the ratings still work.
const CACHE_TTL_MDBLIST_MS = 24 * 60 * 60 * 1000;
// MDBList's ratings (outside-sources.js); `mdblistCache.disabled` after a
// refused key, until a new one is saved.
const mdblistCache = OutsideSources.createMdblist({
  fetch: (...args) => fetch(...args),
  key: () => getConfig().mdblistKey,
  persisted: { read: readPersistedCache, write: writePersistedCache },
  ttlMs: CACHE_TTL_MDBLIST_MS,
  recentTtlMs: CACHE_TTL_RECENT_SHOW_MS,
  onRejected: () => showToast("MDBList rejected the API key - check it in Settings.", true),
});

// Called right after a key is saved in Settings: one small request that says
// whether MDBList accepts it (any known show works for that).
async function checkMdblistKey(key) {
  try {
    const res = await fetch(`https://api.mdblist.com/imdb/show/tt0903747?apikey=${encodeURIComponent(key)}`);
    if (res.ok) showToast("MDBList key saved and accepted");
    else if (res.status === 401 || res.status === 403) showToast("MDBList rejected this key - check that it was copied in full.", true);
    else showToast(`MDBList key saved, but the check failed (${res.status}).`, true);
  } catch (e) {
    showToast("MDBList key saved, but MDBList couldn't be reached to check it.", true);
  }
}

// One object per show: imdb / tmdb are out of 10; the RT scores and
// Trakt are percentages. null = no score from that source.
function buildRatings(tmdbVote, mdb) {
  const pos = v => (typeof v === "number" && isFinite(v) && v > 0) ? v : null;
  return {
    imdb: pos(mdb && mdb.imdb),
    tmdb: pos(tmdbVote),
    rtCritics: pos(mdb && mdb.tomatoes),
    rtAudience: pos(mdb && mdb.popcorn),
    trakt: pos(mdb && mdb.trakt),
  };
}

async function loadRatings(tmdbVote, imdbId, recent) {
  const mdb = await mdblistCache.get(imdbId, recent);
  return buildRatings(tmdbVote, mdb);
}

function showAverageRuntime(showDetail) {
  if (!showDetail) return 0;
  const ert = showDetail.episode_run_time || [];
  if (ert.length) return ert.reduce((a, b) => a + b, 0) / ert.length;
  return (showDetail.last_episode_to_air || {}).runtime || 0;
}

function averageEpisodeRuntime(showDetail, fallbackRuntime) {
  // Used only as a last-resort per-episode fallback when TMDB has no exact
  // runtime for a specific remaining episode (see estimateRemainingMinutes)
  // - never as a flat multiplier for the whole remaining count, since
  // TMDB's overall-series average can be way off for shows whose episode
  // length changed a lot across seasons (e.g. Stranger Things' later
  // seasons run much longer than its early ones).
  return (showDetail && showAverageRuntime(showDetail)) || fallbackRuntime || 0;
}

function watchedEpisodeNumbersBySeason(item) {
  const result = {};
  for (const season of item.seasons || []) {
    const num = season.number;
    result[num] = new Set((season.episodes || []).map(e => e.number).filter(n => n != null));
  }
  return result;
}

// Most recent watched_at timestamp across all of a show's watched episodes
// (null if none are timestamped) - used to keep an old, already-ended show
// near the top of My List while you're actively rewatching/catching up on
// it, since its next episode's own air date is from years ago otherwise.
function mostRecentWatchedAt(item) {
  let latest = null;
  for (const season of item.seasons || []) {
    for (const ep of season.episodes || []) {
      if (!ep.watched_at) continue;
      const ts = new Date(ep.watched_at).getTime();
      if (!isNaN(ts) && (latest == null || ts > latest)) latest = ts;
    }
  }
  return latest;
}

async function estimateRemainingMinutes(item, tmdbId, showId, cache, episodeCache, remainingCount, fallbackRuntime) {
  // The library's aggregate count (remainingCount, passed in) is always the
  // authoritative number of remaining episodes - this function only
  // estimates how long they'll take to watch, as accurately as possible:
  // it identifies the SPECIFIC remaining episodes via the show's episode
  // list (air dates) and watched records, then prices each one using TMDB's
  // exact per-episode runtime where available, falling back to the show's
  // average only for the specific episodes TMDB doesn't have.
  // Returns { totalMinutes, nextEpisodeMinutes }.
  const showDetail = tmdbId ? await cache.getShow(tmdbId) : null; // never throws (see TmdbCache)
  const avgRuntime = averageEpisodeRuntime(showDetail, fallbackRuntime);

  if (remainingCount <= 0) return { totalMinutes: 0, nextEpisodeMinutes: 0, episodes: [] };

  // "season-episode" -> exact TMDB runtime + title, wherever TMDB has them.
  const tmdbEpisodeMap = new Map();
  if (showDetail) {
    for (const seasonInfo of showDetail.seasons || []) {
      const seasonNum = seasonInfo.season_number;
      if (seasonNum == null || seasonNum === 0) continue;
      const seasonDetail = await cache.getSeason(tmdbId, seasonNum);
      if (!seasonDetail) continue;
      for (const ep of seasonDetail.episodes || []) {
        const title = ep.name && !/^Episode\s+\d+$/i.test(ep.name.trim()) ? ep.name.trim() : null;
        tmdbEpisodeMap.set(`${seasonNum}-${ep.episode_number}`, { runtime: ep.runtime || null, title });
      }
    }
  }

  // Identify which specific episodes are remaining, via the episode list,
  // oldest (i.e. the very next one to watch) first. Also record each
  // season's highest known episode number, so every remaining episode
  // (not just the next one) can carry its own premiere/finale badge.
  let identifiedEpisodes = [];
  const seasonMaxEpisode = new Map();
  let showEpisodes = null;
  if (showId) {
    showEpisodes = await episodeCache.get(showId);
    if (showEpisodes) {
      for (const ep of showEpisodes) {
        if (ep.season == null || ep.season === 0 || ep.episode == null) continue;
        const prevMax = seasonMaxEpisode.get(ep.season);
        if (prevMax == null || ep.episode > prevMax) seasonMaxEpisode.set(ep.season, ep.episode);
      }
      const watchedBySeason = watchedEpisodeNumbersBySeason(item);
      const now = Date.now();
      identifiedEpisodes = showEpisodes
        .filter(ep => ep.season != null && ep.season !== 0 && ep.episode != null && ep.date)
        .filter(ep => episodeHasAired(ep, now, fallbackRuntime))
        .map(ep => ({ season: ep.season, episode: ep.episode, ts: episodeTimestamp(ep.date) }))
        .filter(ep => !isNaN(ep.ts))
        .filter(ep => !(watchedBySeason[ep.season] || new Set()).has(ep.episode))
        .sort((a, b) => a.ts - b.ts);
    }
  }

  // Season 1 episode 1 is a series premiere, any other season's episode 1
  // is a season premiere, and an episode matching its season's known max
  // is a season finale - same rule as the single "next episode" badge
  // elsewhere, just applied to every remaining episode here.
  function episodeBadge(season, episode) {
    if (season == null || episode == null) return null;
    if (episode === 1) return season === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
    const maxEp = seasonMaxEpisode.get(season);
    return maxEp != null && episode === maxEp ? "SEASON FINALE" : null;
  }

  // Price up to remainingCount identified episodes with their exact (or
  // per-episode-fallback) runtime; if we couldn't identify enough specific
  // episodes to match the aggregate count, pad the remainder with the
  // average so the count itself is still fully accounted for. The full
  // per-episode breakdown (used by the "episodes left" modal) is built
  // alongside the same totals so both always agree.
  let minutes = 0;
  const useCount = Math.min(identifiedEpisodes.length, remainingCount);
  const episodes = [];
  for (let i = 0; i < useCount; i++) {
    const { season, episode } = identifiedEpisodes[i];
    const info = tmdbEpisodeMap.get(`${season}-${episode}`);
    const runtime = (info && info.runtime) || avgRuntime;
    minutes += runtime;
    episodes.push({ season, episode, title: info ? info.title : null, runtime, badge: episodeBadge(season, episode) });
  }
  const padCount = remainingCount - useCount;
  minutes += padCount * avgRuntime;
  for (let i = 0; i < padCount; i++) {
    episodes.push({ season: null, episode: null, title: null, runtime: avgRuntime, badge: null });
  }

  const nextEpisodeMinutes = episodes.length ? episodes[0].runtime : avgRuntime;
  const allEpisodes = listAllEpisodes(item, showEpisodes, tmdbEpisodeMap, avgRuntime, episodes, fallbackRuntime, episodeBadge);

  return { totalMinutes: minutes, nextEpisodeMinutes, episodes, allEpisodes };
}

// Every episode of the show (specials excluded), in order, for the top
// card's episodes modal: each one "watched", "left" (aired, not watched) or
// "future" (not aired yet). The aired rule matches the episodes manager's:
// a watched episode aired whatever its date says, and an undated one before
// the last aired one did air too. Without a per-episode watched list, the
// last watched code marks everything up to it, same as the manager.
function listAllEpisodes(item, showEpisodes, tmdbEpisodeMap, avgRuntime, episodesLeft, fallbackRuntime, episodeBadge) {
  if (!showEpisodes || !showEpisodes.length) return null;
  const now = Date.now();
  const eps = showEpisodes
    .filter(ep => ep.season != null && ep.season !== 0 && ep.episode != null)
    .map(ep => ({ season: ep.season, episode: ep.episode, date: ep.date || null, listTitle: ep.title, aired: episodeHasAired(ep, now, fallbackRuntime) }))
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  if (!eps.length) return null;

  const watched = watchedEpisodeNumbersBySeason(item);
  const hasWatchedDetail = Array.isArray(item.seasons) && item.seasons.length > 0;
  const lastWatched = /^S(\d+)E(\d+)$/i.exec(item.last_watched || "");
  const isWatched = ep => hasWatchedDetail
    ? !!(watched[ep.season] && watched[ep.season].has(ep.episode))
    : !!lastWatched && (ep.season < Number(lastWatched[1]) || (ep.season === Number(lastWatched[1]) && ep.episode <= Number(lastWatched[2])));

  let lastAired = null;
  for (const ep of eps) if (ep.aired) lastAired = ep;
  const leftRuntime = new Map(episodesLeft.filter(e => e.season != null).map(e => [`${e.season}-${e.episode}`, e.runtime]));

  return eps.map(ep => {
    const key = `${ep.season}-${ep.episode}`;
    const info = tmdbEpisodeMap.get(key);
    const listTitle = ep.listTitle && !/^Episode\s+\d+$/i.test(String(ep.listTitle).trim()) ? String(ep.listTitle).trim() : null;
    const done = isWatched(ep);
    const aired = done || ep.aired || (!ep.date && !!lastAired && (ep.season < lastAired.season || (ep.season === lastAired.season && ep.episode < lastAired.episode)));
    return {
      season: ep.season, episode: ep.episode,
      title: (info && info.title) || listTitle,
      runtime: leftRuntime.get(key) || (info && info.runtime) || avgRuntime,
      status: done ? "watched" : aired ? "left" : "future",
      date: ep.date,
      badge: episodeBadge(ep.season, ep.episode),
    };
  });
}

function airedMinusWatchedCount(item) {
  const total = item.total_episodes_count || 0;
  const notAired = item.not_aired_episodes_count || 0;
  const watched = item.watched_episodes_count || 0;
  return Math.max(Math.max(total - notAired, 0) - watched, 0);
}

function formatTime(minutes) {
  minutes = Math.round(minutes);
  return [Math.floor(minutes / 60), minutes % 60];
}

// Single-episode runtime for the episodes-left modal - stays as plain
// minutes under an hour, switches to "1h 02m" (zero-padded) above it.
function formatEpisodeRuntime(minutes) {
  minutes = Math.round(minutes);
  if (minutes < 60) return `${minutes}m`;
  const [h, m] = formatTime(minutes);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function todayLocalDateStr() {
  // Returns today's date as YYYY-MM-DD using the browser's LOCAL calendar
  // day - NOT new Date().toISOString(), which returns the UTC date and
  // can be a day behind/ahead of the user's actual local day (e.g. for
  // timezones east of UTC like Israel, during the first few hours after
  // local midnight the UTC date is still "yesterday").
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseNextEpisode(nextToWatch) {
  if (!nextToWatch) return [null, null];
  const m = /S(\d+)E(\d+)/i.exec(nextToWatch);
  if (!m) return [null, null];
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

// ---------------------------------------------------------------------
// Build rows (mirrors the Python core logic)
// ---------------------------------------------------------------------
// { [tmdbId]: { posterPath, bannerPath, panelPosterPath, panelBannerPath } } -
// the top panel's picks and the bottom panels' (panel...) apart, so a
// banner with the show's name can go on the big top card and a clean one
// on the small bottom rows. A show moving between them takes that side's.
const LS_IMAGE_OVERRIDES = "simkl_image_overrides";
const IMAGE_AREA_KEYS = {
  top: { poster: "posterPath", banner: "bannerPath" },
  panel: { poster: "panelPosterPath", banner: "panelBannerPath" },
};
// Where a card's picks belong: the top panel ("main") or the bottom ones.
function imageAreaOf(source) {
  return source === "main" ? "top" : "panel";
}

function getImageOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_IMAGE_OVERRIDES) || "{}");
  } catch (e) {
    return {};
  }
}

// Picks saved before the two sides were apart applied to both: the bottom
// panels start from them too (once), then each side changes on its own.
(function splitImageOverrides() {
  try {
    if (localStorage.getItem(LS_IMAGE_OVERRIDES + "_split")) return;
    const overrides = getImageOverrides();
    for (const entry of Object.values(overrides)) {
      if (!entry) continue;
      if (entry.posterPath && entry.panelPosterPath == null) entry.panelPosterPath = entry.posterPath;
      if (entry.bannerPath && entry.panelBannerPath == null) entry.panelBannerPath = entry.bannerPath;
    }
    safeSetItem(LS_IMAGE_OVERRIDES, JSON.stringify(overrides));
    safeSetItem(LS_IMAGE_OVERRIDES + "_split", "1");
  } catch (e) {
    // Not split this time - the bottom panels show TMDB's picks until it is.
  }
})();

// Remembers a manually-picked poster/banner (from clicking to cycle) so it
// survives a refresh instead of resetting to TMDB's default pick. Not
// critical to the click actually succeeding - a QuotaExceededError here
// (from the API cache filling the origin's whole localStorage quota, when
// it still lived there - see readPersistedCache) used to
// bubble all the way up and abort the in-progress cycle before it ever
// touched the DOM: the flip-out/flip-in classes would still get added and
// stripped by the old cycling code's cleanup, so it visibly flashed through
// the motion of changing, while the image itself silently never did.
function saveImageOverride(tmdbId, mode, path, area = "top") {
  if (!tmdbId) return;
  try {
    const overrides = getImageOverrides();
    const entry = overrides[tmdbId] || {};
    entry[IMAGE_AREA_KEYS[area][mode === "banner" ? "banner" : "poster"]] = path;
    overrides[tmdbId] = entry;
    safeSetItem(LS_IMAGE_OVERRIDES, JSON.stringify(overrides));
  } catch (e) {
    // Doesn't persist across a reload this time, but the cycle itself
    // (row state + the visible DOM patch) must still go through.
  }
}

function computeImages(showDetail, tmdbId, area = "top") {
  // Shared by getMyListRows and getAiringNextRows - returns the initial
  // poster/banner URLs plus the full filtered candidate lists (for the
  // per-card cycle button). Prefers English or no-language artwork; if a
  // show has NEITHER for posters or backdrops, falls back to Hebrew
  // (some Israeli shows only have Hebrew-text artwork on TMDB) - decided
  // independently for posters vs. backdrops, since a show might have an
  // English poster but only a Hebrew backdrop, or vice versa.
  const out = {
    posterUrl: null, bannerUrl: null,
    posterPaths: [], backdropPaths: [],
    posterIndex: 0, bannerIndex: 0,
  };
  if (!showDetail) return out;

  const imgs = showDetail.images || {};
  const isEnglishOrNoLang = p => p.iso_639_1 === "en" || p.iso_639_1 == null;
  const isHebrew = p => p.iso_639_1 === "he";

  const enPosters = (imgs.posters || []).filter(isEnglishOrNoLang);
  const enBackdrops = (imgs.backdrops || []).filter(isEnglishOrNoLang);

  out.posterPaths = (enPosters.length ? enPosters : (imgs.posters || []).filter(isHebrew))
    .map(p => p.file_path).filter(Boolean);
  out.backdropPaths = (enBackdrops.length ? enBackdrops : (imgs.backdrops || []).filter(isHebrew))
    .map(p => p.file_path).filter(Boolean);

  // Prefer TMDB's own primary pick as the starting image, but only if it
  // actually made it into the (English/no-language, or Hebrew-fallback)
  // list above - otherwise start from the first result in that list.
  if (showDetail.poster_path && out.posterPaths.includes(showDetail.poster_path)) {
    out.posterIndex = out.posterPaths.indexOf(showDetail.poster_path);
  }
  if (out.posterPaths.length) out.posterUrl = TMDB_IMAGE_BASE + out.posterPaths[out.posterIndex];

  if (showDetail.backdrop_path && out.backdropPaths.includes(showDetail.backdrop_path)) {
    out.bannerIndex = out.backdropPaths.indexOf(showDetail.backdrop_path);
  }
  if (out.backdropPaths.length) out.bannerUrl = TMDB_BACKDROP_BASE + out.backdropPaths[out.bannerIndex];

  // A manually-picked poster/banner from a previous session (clicking to
  // cycle) takes over from TMDB's default pick, as long as that path is
  // still among this show's current images.
  if (tmdbId) {
    const entry = getImageOverrides()[tmdbId];
    const keys = IMAGE_AREA_KEYS[area];
    const saved = entry && { posterPath: entry[keys.poster], bannerPath: entry[keys.banner] };
    if (saved) {
      // A pick from another source (see fetchExtraImages) is saved as a full
      // URL and isn't one of TMDB's candidates (index -1).
      if (saved.posterPath && /^https?:/.test(saved.posterPath)) {
        out.posterIndex = -1;
        out.posterUrl = saved.posterPath;
      } else if (saved.posterPath && out.posterPaths.includes(saved.posterPath)) {
        out.posterIndex = out.posterPaths.indexOf(saved.posterPath);
        out.posterUrl = TMDB_IMAGE_BASE + saved.posterPath;
      }
      if (saved.bannerPath && /^https?:/.test(saved.bannerPath)) {
        out.bannerIndex = -1;
        out.bannerUrl = saved.bannerPath;
      } else if (saved.bannerPath && out.backdropPaths.includes(saved.bannerPath)) {
        out.bannerIndex = out.backdropPaths.indexOf(saved.bannerPath);
        out.bannerUrl = TMDB_BACKDROP_BASE + saved.bannerPath;
      }
    }
  }

  return out;
}

async function getRecentlyWatchedEpisodes(items, cache, episodeCache, droppedItems) {
  // Scans every currently-"watching" show (even ones you've fully caught
  // up on, which wouldn't otherwise appear in My List) for watched
  // episodes with a timestamp, and returns the 10 most recent - at most
  // one entry per show (its single most recently watched episode), so
  // binge-watching several episodes of the same show in a row doesn't
  // crowd out everything else. Recently dropped shows are folded into the
  // same pool (flagged so the render side can badge them "DROPPED") rather
  // than disappearing the instant their status changes - they still
  // compete on recency with everything else for one of the 10 slots.
  const candidates = [];
  for (const item of items) {
    if (item.status !== "watching") continue;
    const show = item.show || {};
    for (const season of item.seasons || []) {
      for (const ep of season.episodes || []) {
        if (!ep.watched_at) continue;
        candidates.push({
          title: show.title || "Unknown",
          season: season.number,
          episode: ep.number,
          watchedAt: ep.watched_at,
          tmdbId: (show.ids || {}).tmdb,
          showId: (show.ids || {}).library,
          imdbId: (show.ids || {}).imdb,
        });
      }
    }
  }
  for (const item of droppedItems || []) {
    if (item.status !== "dropped") continue;
    // Dropped shows are read without their episode list (see
    // getDroppedShows) - just a last_watched_at timestamp and a
    // "S01E06"-style last_watched code for the single most recent episode,
    // which is all Recently Watched needs anyway.
    if (!item.last_watched_at || !item.last_watched) continue;
    const match = /^S(\d+)E(\d+)$/i.exec(item.last_watched);
    if (!match) continue;
    const show = item.show || {};
    candidates.push({
      title: show.title || "Unknown",
      season: Number(match[1]),
      episode: Number(match[2]),
      watchedAt: item.last_watched_at,
      tmdbId: (show.ids || {}).tmdb,
      showId: (show.ids || {}).library,
      imdbId: (show.ids || {}).imdb,
      dropped: true,
    });
  }
  candidates.sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));

  const seenShows = new Set();
  const deduped = [];
  for (const c of candidates) {
    const showKey = c.showId != null ? `show:${c.showId}` : `title:${c.title}`;
    if (seenShows.has(showKey)) continue;
    seenShows.add(showKey);
    deduped.push(c);
  }
  const top = deduped.slice(0, 10);

  await Promise.all(top.map(async c => {
    Object.assign(c, computeImages(null));
    c.network = null;
    c.networkLogoPath = null;
    c.episodeTitle = null;
    let tmdbLogoPath = null;
    let firstAirDate = null;
    if (c.tmdbId) {
      const showDetail = await cache.getShow(c.tmdbId); // cached, no extra request if already fetched
      Object.assign(c, computeImages(showDetail, c.tmdbId, "panel"));
      const network = latestNetwork(showDetail);
      c.network = network ? network.name : null;
      tmdbLogoPath = network ? network.logo_path : null;
      firstAirDate = showDetail ? showDetail.first_air_date : null;
    }
    c.networkLogoPath = resolveNetworkLogoUrl(c.network, tmdbLogoPath);

    // Episode title: prefer the episode list's title if it has one, else TMDB's -
    // same fallback order used for My List / Airing Next.
    // Season/series premiere and season finale badges, same rule used
    // everywhere else (episode 1 -> premiere; matches the season's known
    // max episode -> finale) - applied to the watched episode itself here,
    // not the next one to watch.
    // A dropped show's badge always reads "DROPPED" - more relevant here
    // than whether the last-watched episode happened to be a premiere or
    // finale.
    c.badge = c.dropped ? "DROPPED" : null;
    if (!c.dropped && c.episode === 1) {
      c.badge = c.season === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
    }
    if (c.showId) {
      const showEpisodes = await episodeCache.get(c.showId);
      const match = showEpisodes && showEpisodes.find(e => e.season === c.season && e.episode === c.episode);
      if (match && match.title && !/^Episode\s+\d+$/i.test(String(match.title).trim())) {
        c.episodeTitle = String(match.title).trim();
      }
      if (!c.dropped && !c.badge && showEpisodes) {
        const sameSeason = showEpisodes.filter(e => e.season === c.season && e.episode != null);
        if (sameSeason.length) {
          const maxEpisode = Math.max(...sameSeason.map(e => e.episode));
          if (c.episode === maxEpisode) c.badge = "SEASON FINALE";
        }
      }
    }
    if (!c.episodeTitle && c.tmdbId) {
      const seasonDetail = await cache.getSeason(c.tmdbId, c.season);
      const episodeDetail = seasonDetail && (seasonDetail.episodes || [])
        .find(e => e.episode_number === c.episode);
      if (episodeDetail && episodeDetail.name && !/^Episode\s+\d+$/i.test(episodeDetail.name.trim())) {
        c.episodeTitle = episodeDetail.name.trim();
      }
    }
  }));
  return top;
}

async function getPlanToWatchRows(cache) {
  const items = await getPlanToWatchShows();
  cache = cache || new TmdbCache();
  // Per-show lookups run concurrently instead of one-at-a-time -
  // order doesn't matter here since the list gets sorted afterward anyway.
  const rows = await Promise.all(items.map(async item => {
    const show = item.show || {};
    const title = show.title || "Unknown";
    const tmdbId = (show.ids || {}).tmdb;
    const showId = (show.ids || {}).library;
    const imdbId = (show.ids || {}).imdb;

    let images = computeImages(null);
    let showStatus = null;
    let network = null;
    let tmdbLogoPath = null;
    let startYear = null;
    let firstAirDate = null;
    let tmdbVote = null;
    let endYear = null;
    let contentRating = null;
    let genreLabel = null;
    if (tmdbId) {
      try {
        const showDetail = await cache.getShow(tmdbId);
        images = computeImages(showDetail, tmdbId, "panel");
        showStatus = showDetail ? showDetail.status : null;
        const showNetwork = latestNetwork(showDetail);
        network = showNetwork ? showNetwork.name : null;
        tmdbLogoPath = showNetwork ? showNetwork.logo_path : null;
        if (showDetail && showDetail.first_air_date) {
          startYear = showDetail.first_air_date.slice(0, 4);
          firstAirDate = showDetail.first_air_date;
        }
        tmdbVote = showDetail ? showDetail.vote_average : null;
        if (showDetail && showDetail.last_air_date) endYear = showDetail.last_air_date.slice(0, 4);
        contentRating = extractContentRating(showDetail);
        genreLabel = extractGenreLabel(showDetail);
      } catch (e) {
        images = computeImages(null);
      }
    }
    const recentShow = isRecentShow(firstAirDate);
    const ratings = await loadRatings(tmdbVote, imdbId, recentShow);
    const imdbRating = ratings.imdb;
    const networkLogoPath = resolveNetworkLogoUrl(network, tmdbLogoPath);

    const totalEpisodes = item.total_episodes_count || 0;
    const notAired = item.not_aired_episodes_count || 0;
    const airedCount = Math.max(totalEpisodes - notAired, 0);
    const ended = showStatus === "Ended" || showStatus === "Canceled";
    // Nothing aired yet: say when it premieres if TMDB has a date ahead,
    // otherwise say it hasn't aired. Blue for a known date, slate otherwise.
    const premiereUpcoming = !!firstAirDate && new Date(firstAirDate + "T00:00:00").getTime() > Date.now();
    const premiereShort = premiereUpcoming
      ? new Date(firstAirDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    const airedLabel = totalEpisodes > 0
      ? (ended ? `Series Ended - ${totalEpisodes} Episodes`
        : airedCount > 0 ? `${airedCount} Episodes Aired`
        : premiereShort ? `Premieres ${premiereShort}` : "Not Aired Yet")
      : null;
    const airedTone = !ended && totalEpisodes > 0 && airedCount === 0
      ? (premiereShort ? "soon" : "unknown") : "";
    // "2016-2019" once ended, "2016-" (open-ended) while still airing.
    const yearRangeLabel = startYear ? `${startYear}-${ended ? (endYear || "") : ""}` : null;

    return { title, imdbId, imdbRating, ratings, ...images, showId, tmdbId, airedLabel, airedTone, ended, network, networkLogoPath, yearRangeLabel, contentRating, genreLabel, firstAirDate, watchedCount: item.watched_episodes_count || 0,
      autoStarted: item.autoStarted };
  }));

  // Highest IMDb rating first; shows with no known rating sink to the end.
  rows.sort((a, b) => {
    if (a.imdbRating == null && b.imdbRating == null) return 0;
    if (a.imdbRating == null) return 1;
    if (b.imdbRating == null) return -1;
    return b.imdbRating - a.imdbRating;
  });
  return rows;
}

async function getMyListRows(cache, episodeCache) {
  const [items, droppedItems] = await Promise.all([getWatchingShowsOnce(), getDroppedShows()]);
  cache = cache || new TmdbCache();
  episodeCache = episodeCache || newEpisodeCache();
  // Per-show lookups run concurrently instead of one-at-a-time;
  // each task returns its own remaining/minutes contribution so the totals
  // below can be summed after everything resolves, rather than mutating a
  // shared counter from multiple in-flight tasks.
  const eligible = items.filter(item => item.status === "watching" && item.next_to_watch);
  const results = await Promise.all(eligible.map(async item => {
    const nextToWatch = item.next_to_watch;
    const show = item.show || {};
    const title = show.title || "Unknown";
    const tmdbId = (show.ids || {}).tmdb;
    const showId = (show.ids || {}).library;
    const imdbId = (show.ids || {}).imdb;
    const watched = item.watched_episodes_count || 0;
    const totalEpisodes = item.total_episodes_count || 0;
    const notAired = item.not_aired_episodes_count || 0;
    const available = Math.max(totalEpisodes - notAired, 0);

    const [nextSeason, nextEpisode] = parseNextEpisode(nextToWatch);
    const nextLabel = nextSeason != null
      ? `S${String(nextSeason).padStart(2, "0")}E${String(nextEpisode).padStart(2, "0")}`
      : "";

    let images = computeImages(null);
    let showDetail = null;
    let network = null;
    let tmdbLogoPath = null;
    let yearRangeLabel = null;
    if (tmdbId) {
      // TMDB is now purely supplementary (images/runtime estimate) - if it
      // fails for this one show, that shouldn't take down the whole list.
      try {
        showDetail = await cache.getShow(tmdbId);
        images = computeImages(showDetail, tmdbId);
        const showNetwork = latestNetwork(showDetail);
        network = showNetwork ? showNetwork.name : null;
        tmdbLogoPath = showNetwork ? showNetwork.logo_path : null;
        // "2016-2019" once ended, "2016-" (open-ended, so an empty end year
        // is itself the signal a show hasn't wrapped up yet) while still
        // airing - same rule Plan to Watch uses.
        const ended = showDetail && (showDetail.status === "Ended" || showDetail.status === "Canceled");
        const startYear = showDetail && showDetail.first_air_date ? showDetail.first_air_date.slice(0, 4) : null;
        const endYear = showDetail && showDetail.last_air_date ? showDetail.last_air_date.slice(0, 4) : null;
        if (startYear) yearRangeLabel = `${startYear}-${ended ? (endYear || "") : ""}`;
      } catch (e) {
        showDetail = null;
      }
    }

    // The library's aggregate counts (aired minus watched) are the sole
    // source of truth for how many episodes remain. TMDB is used only to
    // estimate how long they'll take to watch.
    const remaining = Math.max(airedMinusWatchedCount(item), 1);
    const { totalMinutes: remainingMinutes, nextEpisodeMinutes, episodes: episodesLeft, allEpisodes } = await estimateRemainingMinutes(
      item, tmdbId, showId, cache, episodeCache, remaining, show.runtime
    );

    // Air date/time of the specific "next episode to watch" (not the
    // show's next upcoming one) - used to sort: shows you're only a
    // little behind on (aired recently) float to the top; old backlog
    // sinks to the bottom. Prefer the episode list (an exact time where the
    // source has one); fall back to TMDB's season data (date only).
    let nextAirDate = null;
    let episodeTitle = null;
    let nextShowEpisodes = null;

    if (showId && nextSeason != null) {
      nextShowEpisodes = await episodeCache.get(showId);
      const listEp = nextShowEpisodes && nextShowEpisodes.find(
        e => e.season === nextSeason && e.episode === nextEpisode
      );
      if (listEp && listEp.date) nextAirDate = listEp.date;
      if (listEp && listEp.title && !/^Episode\s+\d+$/i.test(String(listEp.title).trim())) {
        episodeTitle = String(listEp.title).trim();
      }
    }

    // Same premiere/finale badge logic as Airing Next (buildAiringRow) -
    // episode 1 of a season is a premiere; otherwise, if it's the highest
    // episode number listed for that season, treat it as the
    // season finale.
    let badge = null;
    if (nextSeason != null && nextEpisode != null) {
      if (nextEpisode === 1) {
        badge = nextSeason === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
      } else if (showId) {
        const showEpisodes = nextShowEpisodes || await episodeCache.get(showId);
        const sameSeason = (showEpisodes || []).filter(e => e.season === nextSeason && e.episode != null);
        if (sameSeason.length) {
          const maxEpisode = Math.max(...sameSeason.map(e => e.episode));
          if (nextEpisode === maxEpisode) badge = "SEASON FINALE";
        }
      }
    }

    if (nextAirDate == null && tmdbId && nextSeason != null) {
      const seasonDetail = await cache.getSeason(tmdbId, nextSeason);
      const ep = seasonDetail && (seasonDetail.episodes || []).find(e => e.episode_number === nextEpisode);
      if (ep) {
        if (ep.air_date) nextAirDate = ep.air_date;
        if (!episodeTitle && ep.name && !/^Episode\s+\d+$/i.test(ep.name.trim())) {
          episodeTitle = ep.name.trim();
        }
      }
    }

    // When the show came into My List: when its next episode to watch
    // became available (sorting, below). A newer episode of a show that's
    // already waiting here doesn't count - the one you're up to does. Only
    // when that episode isn't in the list (numbering), its newest aired one.
    let joinedAt = null;
    if (showId) {
      const now = Date.now();
      const eps = (await episodeCache.get(showId)) || [];
      const next = nextSeason != null ? eps.find(e => e.season === nextSeason && e.episode === nextEpisode) : null;
      if (next && episodeHasAired(next, now, show.runtime)) {
        joinedAt = episodeAvailableAt(next, show.runtime);
      } else {
        for (const ep of eps) {
          if (ep.season == null || ep.season === 0 || ep.episode == null) continue;
          if (!episodeHasAired(ep, now, show.runtime)) continue;
          const at = episodeAvailableAt(ep, show.runtime);
          if (at != null && (joinedAt == null || at > joinedAt)) joinedAt = at;
        }
      }
    }

    // How many episodes the season you're in has (the card's ring), and
    // the show's seasons in order (the banner card's segments).
    let seasonEps = null;
    let seasons = null;
    if (showId && nextSeason != null) {
      const eps = (await episodeCache.get(showId)) || [];
      const nums = eps.filter(e => e.season === nextSeason && e.episode != null).map(e => e.episode);
      if (nums.length && Math.max(...nums) >= nextEpisode) seasonEps = Math.max(...nums);
      seasons = [...new Set(eps.filter(e => e.season > 0 && e.episode != null).map(e => e.season))].sort((a, b) => a - b);
    }

    const [hours, mins] = formatTime(remainingMinutes);
    const [nextHours, nextMins] = formatTime(nextEpisodeMinutes);
    const recentShow = isRecentShow(showDetail && showDetail.first_air_date);
    const ratings = await loadRatings(showDetail && showDetail.vote_average, imdbId, recentShow);
    const imdbRating = ratings.imdb;
    const networkLogoPath = resolveNetworkLogoUrl(network, tmdbLogoPath);
    const row = {
      title, imdbId, imdbRating, ratings, showId, tmdbId, year: show.year, ...images, network, networkLogoPath,
      totalEpisodes, available, watched, remaining,
      hours, mins, nextHours, nextMins, nextLabel, nextSeason, nextEpisode, seasonEps, seasons, episodeTitle, nextAirDate, badge,
      episodesLeft, allEpisodes, lastWatchedAt: mostRecentWatchedAt(item), joinedAt, yearRangeLabel,
      firstAirDate: showDetail && showDetail.first_air_date ? showDetail.first_air_date : null,
    };
    return { row, remaining, remainingMinutes };
  }));

  const rows = results.map(r => r.row);
  const totalRemainingEps = results.reduce((sum, r) => sum + r.remaining, 0);
  const totalRemainingMinutes = results.reduce((sum, r) => sum + r.remainingMinutes, 0);

  // The show with the most recent event comes first: it coming into My List
  // (its next episode to watch became available - the end of its broadcast)
  // or you watching an episode of it. Each new event moves its show to the
  // front and the rest one place along; another new episode of a show
  // that's already here doesn't move it. Without either (no dates, nothing
  // watched), the next episode's air date; shows with no signal at all sink
  // to the end.
  const sortTimestamp = (row) => {
    const times = [row.joinedAt, row.lastWatchedAt].filter(t => t != null);
    if (times.length) return Math.max(...times);
    return row.nextAirDate != null ? airDateToTimestamp(row.nextAirDate) : null;
  };
  rows.sort((a, b) => {
    const tsA = sortTimestamp(a);
    const tsB = sortTimestamp(b);
    if (tsA == null && tsB == null) return 0;
    if (tsA == null) return 1;
    if (tsB == null) return -1;
    return tsB - tsA;
  });

  rows.forEach((r, i) => { r.index = i + 1; });
  const recentlyWatched = await getRecentlyWatchedEpisodes(items, cache, episodeCache, droppedItems);
  return [rows, totalRemainingEps, totalRemainingMinutes, recentlyWatched];
}
