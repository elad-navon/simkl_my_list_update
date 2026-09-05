"use strict";

// ---------------------------------------------------------------------
// Config - not hardcoded. Stored only in this browser's localStorage,
// so this HTML file itself never contains your keys (safe to commit).
// ---------------------------------------------------------------------
const SIMKL_BASE = "https://api.simkl.com";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_LOGO_BASE = "https://image.tmdb.org/t/p/w92";
const TMDB_PROFILE_BASE = "https://image.tmdb.org/t/p/w185";
// Manual fallback for networks that have no logo in TMDB (or aren't in TMDB
// at all) and none in SIMKL either - mainly small/regional broadcasters,
// e.g. Israeli channels. `names` lists every name variant this network
// shows up under across TMDB/SIMKL (different language/script, with or
// without a trailing channel number - see findLocalNetworkLogo). `logo` is
// a ready-to-use image src (a data URI), not a path - these aren't fetched
// from anywhere at runtime.
const LOCAL_NETWORK_LOGOS = [
  { names: ["רשת", "Reshet"], logo: "data:image/png;base64,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" },
  { names: ["כאן", "כאן 11", "Kan", "Kan 11"], logo: "data:image/png;base64,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" },
  { names: ["HOT", "הוט"], logo: "data:image/png;base64,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" },
];
const APP_NAME = "my-list-summary-web";
const APP_VERSION = "1.0";

// ---------------------------------------------------------------------
// Nav bar icon - only this one needs to be rebuilt dynamically (its
// label text changes); the others are embedded directly in the static
// HTML above since they never change.
// ---------------------------------------------------------------------
// Poster (vertical) and banner (landscape) icons for the image-mode
// toggle - the icon shown reflects what you'll switch TO, matching
// the button's own label.
const ICON_POSTER_SHAPE = `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"></rect></svg>`;
const ICON_BANNER_SHAPE = `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>`;

const LS_CLIENT_ID = "simkl_client_id";
const LS_TMDB_KEY = "tmdb_api_key";
const LS_TOKEN = "simkl_access_token";
const LS_IMAGE_MODE = "simkl_image_mode"; // "poster" | "banner"
const LS_THEME = "simkl_theme"; // "light" | "dark"
const LS_VIEW_MODE = "simkl_view_mode";   // "list" or "airing" (not restored on load - always starts on "list")

const app = document.getElementById("app");
const subtitle = document.getElementById("subtitle");

function getImageMode() {
  return localStorage.getItem(LS_IMAGE_MODE) === "banner" ? "banner" : "poster";
}

function nextImageMode(mode) {
  return mode === "poster" ? "banner" : "poster";
}

function getConfig() {
  return {
    clientId: localStorage.getItem(LS_CLIENT_ID) || "",
    tmdbKey: localStorage.getItem(LS_TMDB_KEY) || "",
  };
}

// ---------------------------------------------------------------------
// Settings screen (first run, or via the Settings button)
// ---------------------------------------------------------------------
function returnToPreviousView() {
  if (currentView === "airing" && airingRows) {
    renderAiringRows(airingRows);
  } else {
    renderRows(lastRows || [], lastTotalEps, lastTotalMinutes, lastRecentlyWatched);
  }
}

function showSettings(afterSaveCallback) {
  document.getElementById("settingsBtn").classList.add("active");
  const cfg = getConfig();
  // Only offer a way back if there's actually a previously-loaded view to
  // return to - on first run (no config yet) there's nothing to cancel back
  // to, and both fields are required anyway.
  const canCancel = lastRows !== null || airingRows !== null;
  const closeBtnHtml = canCancel
    ? `<button class="modal-close-btn" id="settingsCloseBtn" style="position:absolute;top:14px;right:14px" title="Back">&times;</button>`
    : "";
  app.innerHTML = `
    <div class="center-box" style="position:relative">
      ${closeBtnHtml}
      <h2>Setup</h2>
      <p style="color:var(--muted);font-size:0.85rem">
        These are stored only in this browser's local storage - never written
        into this HTML file, so it's safe to keep this file in a public repo.
      </p>
      <label>SIMKL Client ID
        (<a href="https://simkl.com/settings/developer/" target="_blank">create an app</a>)</label>
      <input type="text" id="clientIdInput" value="${cfg.clientId}">
      <label>TMDB API Key
        (<a href="https://www.themoviedb.org/settings/api" target="_blank">get a free key</a>)</label>
      <input type="text" id="tmdbKeyInput" value="${cfg.tmdbKey}">
      <div class="theme-toggle-wrap" style="margin-top:18px">
        <span class="nav-icon"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg></span>
        <span style="flex:1 1 auto;text-align:left">Dark Mode</span>
        <button class="theme-toggle" id="themeToggleBtn" title="Toggle light/dark"></button>
      </div>
      <div style="margin-top:18px">
        <button class="pill" id="saveSettingsBtn">Save</button>
      </div>
      <div class="error-box" id="settingsError"></div>
    </div>
  `;
  subtitle.textContent = "Setup required";
  document.getElementById("saveSettingsBtn").onclick = () => {
    const clientId = document.getElementById("clientIdInput").value.trim();
    const tmdbKey = document.getElementById("tmdbKeyInput").value.trim();
    if (!clientId || !tmdbKey) {
      document.getElementById("settingsError").textContent = "Both fields are required.";
      return;
    }
    localStorage.setItem(LS_CLIENT_ID, clientId);
    localStorage.setItem(LS_TMDB_KEY, tmdbKey);
    if (afterSaveCallback) afterSaveCallback();
  };
  document.getElementById("themeToggleBtn").onclick = () => {
    const isLight = document.body.classList.toggle("light-theme");
    localStorage.setItem(LS_THEME, isLight ? "light" : "dark");
    updateThemeToggleButton();
  };
  updateThemeToggleButton();
  if (canCancel) {
    document.getElementById("settingsCloseBtn").onclick = returnToPreviousView;
  }
}

// ---------------------------------------------------------------------
// SIMKL auth (PIN flow) + fetching
// ---------------------------------------------------------------------
async function simklRequest(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(
      "Network/CORS error reaching SIMKL. Your browser may be blocking " +
      "cross-origin requests to api.simkl.com. Original error: " + e.message
    );
  }
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`SIMKL request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  if (res.status === 404) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getAccessToken() {
  const cached = localStorage.getItem(LS_TOKEN);
  if (cached) return cached;

  const { clientId } = getConfig();
  const pinParams = new URLSearchParams({
    client_id: clientId, "app-name": APP_NAME, "app-version": APP_VERSION,
  });
  const pinData = await simklRequest(`${SIMKL_BASE}/oauth/pin?${pinParams}`);
  const userCode = pinData.user_code;
  const verificationUrl = pinData.verification_url || "https://simkl.com/pin";
  const intervalSec = pinData.interval || 5;
  const expiresIn = pinData.expires_in || 900;

  app.innerHTML = `
    <div class="center-box">
      <h2>One-time authorization</h2>
      <p>1. Go to <a href="${verificationUrl}" target="_blank">${verificationUrl}</a></p>
      <p>2. Enter this code:</p>
      <div class="pin-code">${userCode}</div>
      <div class="spinner"></div>
      <p style="color:var(--muted);font-size:0.85rem">Waiting for approval&hellip;</p>
    </div>
  `;
  subtitle.textContent = "Waiting for authorization";

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalSec * 1000));
    const pollParams = new URLSearchParams({
      client_id: clientId, "app-name": APP_NAME, "app-version": APP_VERSION,
    });
    let poll;
    try {
      poll = await simklRequest(`${SIMKL_BASE}/oauth/pin/${userCode}?${pollParams}`);
    } catch (e) {
      continue; // keep polling through transient errors
    }
    if (poll && poll.result === "OK" && poll.access_token) {
      localStorage.setItem(LS_TOKEN, poll.access_token);
      return poll.access_token;
    }
  }
  throw new Error("Timed out waiting for PIN approval. Refresh the page to try again.");
}

async function simklGet(path, token, extraParams) {
  const { clientId } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId, "app-name": APP_NAME, "app-version": APP_VERSION,
    ...(extraParams || {}),
  });
  let res;
  try {
    res = await fetch(`${SIMKL_BASE}${path}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new Error("Network/CORS error reaching SIMKL: " + e.message);
  }
  if (res.status === 401) {
    localStorage.removeItem(LS_TOKEN);
    throw new Error("SIMKL access token expired or revoked. Refresh the page to re-authenticate.");
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SIMKL request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function simklPost(path, token, body) {
  const { clientId } = getConfig();
  const params = new URLSearchParams({
    client_id: clientId, "app-name": APP_NAME, "app-version": APP_VERSION,
  });
  let res;
  try {
    res = await fetch(`${SIMKL_BASE}${path}?${params}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error("Network/CORS error reaching SIMKL: " + e.message);
  }
  if (res.status === 401) {
    localStorage.removeItem(LS_TOKEN);
    throw new Error("SIMKL access token expired or revoked. Refresh the page to re-authenticate.");
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`SIMKL request failed (${res.status}): ${errBody.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getWatchingShows(token) {
  const data = await simklGet("/sync/all-items/shows/watching", token, {
    extended: "full", episode_watched_at: "yes",
  });
  if (!data) return [];
  return Array.isArray(data) ? data : (data.shows || []);
}

async function getPlanToWatchShows(token) {
  const data = await simklGet("/sync/all-items/shows/plantowatch", token, {
    extended: "full",
  });
  if (!data) return [];
  return Array.isArray(data) ? data : (data.shows || []);
}

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
const CACHE_TTL_SIMKL_EPISODES_MS = 6 * 60 * 60 * 1000;
const CACHE_TTL_SIMKL_SHOW_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_TMDB_EPISODE_IDS_MS = 7 * 24 * 60 * 60 * 1000; // an episode's IMDb id never changes
const CACHE_TTL_TMDB_CREDITS_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_TMDB_PERSON_IDS_MS = 7 * 24 * 60 * 60 * 1000; // a person's IMDb id never changes

function readPersistedCache(key, ttlMs) {
  try {
    const raw = localStorage.getItem(API_CACHE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.t !== "number" || Date.now() - entry.t > ttlMs) return undefined;
    return entry.v;
  } catch (e) {
    return undefined;
  }
}

function writePersistedCache(key, value) {
  try {
    localStorage.setItem(API_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch (e) {
    // localStorage full or unavailable - the in-memory cache for this
    // session still works fine, just nothing persists across reloads.
  }
}

class TmdbCache {
  constructor() {
    this.show = new Map(); this.season = new Map(); this.episodeIds = new Map();
    this.credits = new Map(); this.personIds = new Map();
  }
  // Both methods store the in-flight PROMISE in the map (not just the
  // resolved value), and do so synchronously before any await - so if the
  // same id is requested again while the first fetch is still in flight
  // (common now that callers run per-show work concurrently), the second
  // call reuses the same promise instead of firing a duplicate request.
  getShow(tmdbId) {
    if (!this.show.has(tmdbId)) {
      const cacheKey = `tmdbshow:${tmdbId}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_TMDB_SHOW_MS);
      if (cached !== undefined) {
        this.show.set(tmdbId, Promise.resolve(cached));
        return this.show.get(tmdbId);
      }
      // append_to_response=images pulls ALL available posters/backdrops for
      // this show in the same request, so we can offer alternates later.
      // include_image_language asks for English + untagged (no-language) +
      // Hebrew images - English/no-language is preferred (see computeImages),
      // Hebrew is used only as a fallback for shows that only have
      // Hebrew-text artwork (some Israeli shows).
      // TMDB is purely supplementary now (images/runtime estimate only,
      // never episode counts) - a failure here degrades gracefully to
      // null rather than crashing whichever show triggered it.
      const promise = tmdbGet(`/tv/${tmdbId}`, {
        append_to_response: "images",
        language: "en-US",
        include_image_language: "en,null,he",
      }).then(data => {
        if (data) writePersistedCache(cacheKey, data);
        return data;
      }).catch(() => null);
      this.show.set(tmdbId, promise);
    }
    return this.show.get(tmdbId);
  }
  getSeason(tmdbId, seasonNum) {
    const key = `${tmdbId}:${seasonNum}`;
    if (!this.season.has(key)) {
      const cacheKey = `tmdbseason:${key}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_TMDB_SEASON_MS);
      if (cached !== undefined) {
        this.season.set(key, Promise.resolve(cached));
        return this.season.get(key);
      }
      const promise = tmdbGet(`/tv/${tmdbId}/season/${seasonNum}`).then(data => {
        if (data) writePersistedCache(cacheKey, data);
        return data;
      }).catch(() => null);
      this.season.set(key, promise);
    }
    return this.season.get(key);
  }
  // TMDB has no bulk way to get every episode's IMDb id alongside the
  // season data - it's a dedicated per-episode endpoint, so this is only
  // called lazily (Episodes Left modal, desktop only) rather than as part
  // of the normal per-show fetch every card already does.
  getEpisodeExternalIds(tmdbId, season, episode) {
    const key = `${tmdbId}:${season}:${episode}`;
    if (!this.episodeIds.has(key)) {
      const cacheKey = `tmdbepids:${key}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_TMDB_EPISODE_IDS_MS);
      if (cached !== undefined) {
        this.episodeIds.set(key, Promise.resolve(cached));
        return this.episodeIds.get(key);
      }
      const promise = tmdbGet(`/tv/${tmdbId}/season/${season}/episode/${episode}/external_ids`).then(data => {
        if (data) writePersistedCache(cacheKey, data);
        return data;
      }).catch(() => null);
      this.episodeIds.set(key, promise);
    }
    return this.episodeIds.get(key);
  }
  // aggregate_credits (not the plain "credits" endpoint) sums a person's
  // appearances across every season instead of just the latest one, so
  // long-running main cast still rank near the top even in a show's later
  // seasons - used for the cast modal's "main cast" list (see openCastModal).
  getCredits(tmdbId) {
    if (!this.credits.has(tmdbId)) {
      const cacheKey = `tmdbcredits:${tmdbId}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_TMDB_CREDITS_MS);
      if (cached !== undefined) {
        this.credits.set(tmdbId, Promise.resolve(cached));
        return this.credits.get(tmdbId);
      }
      const promise = tmdbGet(`/tv/${tmdbId}/aggregate_credits`).then(data => {
        if (data) writePersistedCache(cacheKey, data);
        return data;
      }).catch(() => null);
      this.credits.set(tmdbId, promise);
    }
    return this.credits.get(tmdbId);
  }
  // A cast member's IMDb id isn't in the credits response - same
  // per-item-endpoint situation as getEpisodeExternalIds.
  getPersonExternalIds(personId) {
    if (!this.personIds.has(personId)) {
      const cacheKey = `tmdbpersonids:${personId}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_TMDB_PERSON_IDS_MS);
      if (cached !== undefined) {
        this.personIds.set(personId, Promise.resolve(cached));
        return this.personIds.get(personId);
      }
      const promise = tmdbGet(`/person/${personId}/external_ids`).then(data => {
        if (data) writePersistedCache(cacheKey, data);
        return data;
      }).catch(() => null);
      this.personIds.set(personId, promise);
    }
    return this.personIds.get(personId);
  }
}

class SimklEpisodeCache {
  // Caches GET /tv/episodes/{simkl_id} per show. This is SIMKL's OWN
  // episode data (via TheTVDB), including a full date+time WITH timezone
  // offset for each episode - unlike TMDB, which only gives a bare date
  // (no time), anchored to the show's origin country. Using SIMKL's own
  // data here is what keeps this page in sync with what simkl.com itself
  // shows for "airing next" / next-episode dates.
  constructor() { this.map = new Map(); }
  get(simklId, token) {
    if (!this.map.has(simklId)) {
      const cacheKey = `simklepisodes:${simklId}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_SIMKL_EPISODES_MS);
      if (cached !== undefined) {
        this.map.set(simklId, Promise.resolve(cached));
        return this.map.get(simklId);
      }
      // Stores the in-flight promise itself (see TmdbCache) so concurrent
      // requests for the same show reuse one fetch instead of duplicating it.
      const promise = simklGet(`/tv/episodes/${simklId}`, token, { extended: "full" })
        .then(data => Array.isArray(data) ? data : null)
        .then(data => {
          if (data) writePersistedCache(cacheKey, data);
          return data;
        })
        .catch(() => null); // fall back to TMDB dates for this show
      this.map.set(simklId, promise);
    }
    return this.map.get(simklId);
  }
}

class SimklShowCache {
  // Caches GET /tv/{simkl_id} (SIMKL's own public catalog/summary
  // endpoint - client_id only, no user token strictly required, but we
  // pass the token anyway since it's harmless). Used to read the show's
  // IMDb rating as shown on its simkl.com page, per user request.
  constructor() { this.map = new Map(); }
  get(simklId, token) {
    if (!this.map.has(simklId)) {
      const cacheKey = `simklshow:${simklId}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_SIMKL_SHOW_MS);
      if (cached !== undefined) {
        this.map.set(simklId, Promise.resolve(cached));
        return this.map.get(simklId);
      }
      const promise = simklGet(`/tv/${simklId}`, token, {}).then(data => {
        if (data) writePersistedCache(cacheKey, data);
        return data;
      }).catch(() => null);
      this.map.set(simklId, promise);
    }
    return this.map.get(simklId);
  }
}

function extractSimklNetwork(showData) {
  // Same defensive spirit as extractImdbRating - SIMKL's /tv/{id} shape for
  // this isn't documented, so try the plausible field names and return the
  // first usable string.
  if (!showData) return null;
  const candidates = [showData.network, showData.channel];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
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
  // (SIMKL/Hebrew) - so each entry lists every name variant it should
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

function extractImdbRating(showData) {
  // Defensive parsing: the exact shape of SIMKL's "ratings" field isn't
  // fully documented, so this tries a few plausible layouts and returns
  // null (meaning: just show the plain IMDb logo, no number) rather than
  // guessing wrong.
  if (!showData) return null;
  const r = showData.ratings;
  if (!r) return null;
  const candidates = [
    r.imdb && r.imdb.rating,
    r.IMDB && r.IMDB.rating,
    typeof r.imdb === "number" ? r.imdb : null,
    typeof r.imdb === "string" ? r.imdb : null,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && !isNaN(c)) return c;
    if (typeof c === "string" && c.trim() && !isNaN(parseFloat(c))) return parseFloat(c);
  }
  return null;
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

async function estimateRemainingMinutes(item, tmdbId, simklId, token, cache, episodeCache, remainingCount, fallbackRuntime) {
  // SIMKL's aggregate count (remainingCount, passed in) is always the
  // authoritative number of remaining episodes - this function only
  // estimates how long they'll take to watch, as accurately as possible:
  // it identifies the SPECIFIC remaining episodes via SIMKL's own
  // per-episode aired/watched data, then prices each one using TMDB's
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

  // Identify which specific episodes are remaining, via SIMKL's own data,
  // oldest (i.e. the very next one to watch) first. Also record each
  // season's highest known episode number, so every remaining episode
  // (not just the next one) can carry its own premiere/finale badge.
  let identifiedEpisodes = [];
  const seasonMaxEpisode = new Map();
  if (simklId) {
    const simklEpisodes = await episodeCache.get(simklId, token);
    if (simklEpisodes) {
      for (const ep of simklEpisodes) {
        if (ep.season == null || ep.season === 0 || ep.episode == null) continue;
        const prevMax = seasonMaxEpisode.get(ep.season);
        if (prevMax == null || ep.episode > prevMax) seasonMaxEpisode.set(ep.season, ep.episode);
      }
      const watchedBySeason = watchedEpisodeNumbersBySeason(item);
      const now = Date.now();
      identifiedEpisodes = simklEpisodes
        .filter(ep => ep.season != null && ep.season !== 0 && ep.episode != null && ep.date)
        .map(ep => ({ season: ep.season, episode: ep.episode, ts: new Date(ep.date).getTime() }))
        .filter(ep => !isNaN(ep.ts) && ep.ts <= now)
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
  // episodes to match SIMKL's aggregate count, pad the remainder with the
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

  return { totalMinutes: minutes, nextEpisodeMinutes, episodes };
}

function simklAiredMinusWatchedCount(item) {
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
const LS_IMAGE_OVERRIDES = "simkl_image_overrides"; // { [tmdbId]: { posterPath, bannerPath } }

function getImageOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_IMAGE_OVERRIDES) || "{}");
  } catch (e) {
    return {};
  }
}

// Remembers a manually-picked poster/banner (from clicking to cycle) so it
// survives a refresh instead of resetting to TMDB's default pick.
function saveImageOverride(tmdbId, mode, path) {
  if (!tmdbId) return;
  const overrides = getImageOverrides();
  const entry = overrides[tmdbId] || {};
  if (mode === "banner") entry.bannerPath = path;
  else entry.posterPath = path;
  overrides[tmdbId] = entry;
  localStorage.setItem(LS_IMAGE_OVERRIDES, JSON.stringify(overrides));
}

function computeImages(showDetail, tmdbId) {
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
    const saved = getImageOverrides()[tmdbId];
    if (saved) {
      if (saved.posterPath && out.posterPaths.includes(saved.posterPath)) {
        out.posterIndex = out.posterPaths.indexOf(saved.posterPath);
        out.posterUrl = TMDB_IMAGE_BASE + saved.posterPath;
      }
      if (saved.bannerPath && out.backdropPaths.includes(saved.bannerPath)) {
        out.bannerIndex = out.backdropPaths.indexOf(saved.bannerPath);
        out.bannerUrl = TMDB_BACKDROP_BASE + saved.bannerPath;
      }
    }
  }

  return out;
}

async function getRecentlyWatchedEpisodes(items, cache, episodeCache, token, ratingsCache) {
  // Scans every currently-"watching" show (even ones you've fully caught
  // up on, which wouldn't otherwise appear in My List) for watched
  // episodes with a timestamp, and returns the 15 most recent - at most
  // one entry per show (its single most recently watched episode), so
  // binge-watching several episodes of the same show in a row doesn't
  // crowd out everything else.
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
          simklId: (show.ids || {}).simkl,
        });
      }
    }
  }
  candidates.sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));

  const seenShows = new Set();
  const deduped = [];
  for (const c of candidates) {
    const showKey = c.simklId != null ? `simkl:${c.simklId}` : `title:${c.title}`;
    if (seenShows.has(showKey)) continue;
    seenShows.add(showKey);
    deduped.push(c);
  }
  const top = deduped.slice(0, 15);

  await Promise.all(top.map(async c => {
    Object.assign(c, computeImages(null));
    c.network = null;
    c.networkLogoPath = null;
    c.episodeTitle = null;
    let tmdbLogoPath = null;
    if (c.tmdbId) {
      const showDetail = await cache.getShow(c.tmdbId); // cached, no extra request if already fetched
      Object.assign(c, computeImages(showDetail, c.tmdbId));
      const network = latestNetwork(showDetail);
      c.network = network ? network.name : null;
      tmdbLogoPath = network ? network.logo_path : null;
    }
    if (!c.network && c.simklId && ratingsCache) {
      c.network = extractSimklNetwork(await ratingsCache.get(c.simklId, token));
    }
    c.networkLogoPath = resolveNetworkLogoUrl(c.network, tmdbLogoPath);

    // Episode title: prefer SIMKL's own title if we have it, else TMDB's -
    // same fallback order used for My List / Airing Next.
    // Season/series premiere and season finale badges, same rule used
    // everywhere else (episode 1 -> premiere; matches the season's known
    // max episode -> finale) - applied to the watched episode itself here,
    // not the next one to watch.
    c.badge = null;
    if (c.episode === 1) {
      c.badge = c.season === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
    }
    if (c.simklId) {
      const simklEpisodes = await episodeCache.get(c.simklId, token);
      const match = simklEpisodes && simklEpisodes.find(e => e.season === c.season && e.episode === c.episode);
      if (match && match.title && !/^Episode\s+\d+$/i.test(String(match.title).trim())) {
        c.episodeTitle = String(match.title).trim();
      }
      if (!c.badge && simklEpisodes) {
        const sameSeason = simklEpisodes.filter(e => e.season === c.season && e.episode != null);
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

async function getPlanToWatchRows(token, cache, ratingsCache) {
  const items = await getPlanToWatchShows(token);
  cache = cache || new TmdbCache();
  ratingsCache = ratingsCache || new SimklShowCache();
  // Per-show TMDB/SIMKL lookups run concurrently instead of one-at-a-time -
  // order doesn't matter here since the list gets sorted afterward anyway.
  const rows = await Promise.all(items.filter(item => item.status === "plantowatch").map(async item => {
    const show = item.show || {};
    const title = show.title || "Unknown";
    const tmdbId = (show.ids || {}).tmdb;
    const simklId = (show.ids || {}).simkl;
    const imdbId = (show.ids || {}).imdb;

    let images = computeImages(null);
    let showStatus = null;
    let network = null;
    let tmdbLogoPath = null;
    let startYear = null;
    let endYear = null;
    if (tmdbId) {
      try {
        const showDetail = await cache.getShow(tmdbId);
        images = computeImages(showDetail, tmdbId);
        showStatus = showDetail ? showDetail.status : null;
        const showNetwork = latestNetwork(showDetail);
        network = showNetwork ? showNetwork.name : null;
        tmdbLogoPath = showNetwork ? showNetwork.logo_path : null;
        if (showDetail && showDetail.first_air_date) startYear = showDetail.first_air_date.slice(0, 4);
        if (showDetail && showDetail.last_air_date) endYear = showDetail.last_air_date.slice(0, 4);
      } catch (e) {
        images = computeImages(null);
      }
    }
    const simklShowData = simklId ? await ratingsCache.get(simklId, token) : null;
    const imdbRating = extractImdbRating(simklShowData);
    if (!network) network = extractSimklNetwork(simklShowData);
    const networkLogoPath = resolveNetworkLogoUrl(network, tmdbLogoPath);

    const totalEpisodes = item.total_episodes_count || 0;
    const notAired = item.not_aired_episodes_count || 0;
    const airedCount = Math.max(totalEpisodes - notAired, 0);
    const ended = showStatus === "Ended" || showStatus === "Canceled";
    const airedLabel = totalEpisodes > 0
      ? (ended ? `Series Ended - ${totalEpisodes} Episodes` : `${airedCount} Episodes Aired`)
      : null;
    // "2016-2019" once ended, "2016-" (open-ended) while still airing.
    const yearRangeLabel = startYear ? `${startYear}-${ended ? (endYear || "") : ""}` : null;

    return { title, imdbId, imdbRating, ...images, simklId, tmdbId, airedLabel, ended, network, networkLogoPath, yearRangeLabel };
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

async function getMyListRows(token, cache, episodeCache, ratingsCache) {
  const items = await getWatchingShows(token);
  cache = cache || new TmdbCache();
  episodeCache = episodeCache || new SimklEpisodeCache();
  ratingsCache = ratingsCache || new SimklShowCache();
  // Per-show TMDB/SIMKL lookups run concurrently instead of one-at-a-time;
  // each task returns its own remaining/minutes contribution so the totals
  // below can be summed after everything resolves, rather than mutating a
  // shared counter from multiple in-flight tasks.
  const eligible = items.filter(item => item.status === "watching" && item.next_to_watch);
  const results = await Promise.all(eligible.map(async item => {
    const nextToWatch = item.next_to_watch;
    const show = item.show || {};
    const title = show.title || "Unknown";
    const tmdbId = (show.ids || {}).tmdb;
    const simklId = (show.ids || {}).simkl;
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
    if (tmdbId) {
      // TMDB is now purely supplementary (images/runtime estimate) - if it
      // fails for this one show, that shouldn't take down the whole list.
      try {
        showDetail = await cache.getShow(tmdbId);
        images = computeImages(showDetail, tmdbId);
        const showNetwork = latestNetwork(showDetail);
        network = showNetwork ? showNetwork.name : null;
        tmdbLogoPath = showNetwork ? showNetwork.logo_path : null;
      } catch (e) {
        showDetail = null;
      }
    }

    // SIMKL's own aggregate counts are the sole source of truth for how
    // many episodes remain - this is exactly what simkl.com itself shows,
    // and needs no per-episode matching against TMDB at all. TMDB is used
    // only to estimate how long they'll take to watch.
    const remaining = Math.max(simklAiredMinusWatchedCount(item), 1);
    const { totalMinutes: remainingMinutes, nextEpisodeMinutes, episodes: episodesLeft } = await estimateRemainingMinutes(
      item, tmdbId, simklId, token, cache, episodeCache, remaining, show.runtime
    );

    // Air date/time of the specific "next episode to watch" (not the
    // show's next upcoming one) - used to sort: shows you're only a
    // little behind on (aired recently) float to the top; old backlog
    // sinks to the bottom. Prefer SIMKL's own episode data (has an exact
    // time + timezone offset, so it matches simkl.com); fall back to TMDB
    // (date only) if SIMKL doesn't have it for some reason.
    let nextAirDate = null;
    let episodeTitle = null;
    let simklEpisodesForNext = null;

    if (simklId && nextSeason != null) {
      simklEpisodesForNext = await episodeCache.get(simklId, token);
      const simklEp = simklEpisodesForNext && simklEpisodesForNext.find(
        e => e.season === nextSeason && e.episode === nextEpisode
      );
      if (simklEp && simklEp.date) nextAirDate = simklEp.date;
      if (simklEp && simklEp.title && !/^Episode\s+\d+$/i.test(String(simklEp.title).trim())) {
        episodeTitle = String(simklEp.title).trim();
      }
    }

    // Same premiere/finale badge logic as Airing Next (buildAiringRow) -
    // episode 1 of a season is a premiere; otherwise, if it's the highest
    // episode number SIMKL has listed for that season, treat it as the
    // season finale.
    let badge = null;
    if (nextSeason != null && nextEpisode != null) {
      if (nextEpisode === 1) {
        badge = nextSeason === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
      } else if (simklId) {
        const simklEpisodes = simklEpisodesForNext || await episodeCache.get(simklId, token);
        const sameSeason = (simklEpisodes || []).filter(e => e.season === nextSeason && e.episode != null);
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

    const [hours, mins] = formatTime(remainingMinutes);
    const [nextHours, nextMins] = formatTime(nextEpisodeMinutes);
    const simklShowData = simklId ? await ratingsCache.get(simklId, token) : null;
    const imdbRating = extractImdbRating(simklShowData);
    if (!network) network = extractSimklNetwork(simklShowData);
    const networkLogoPath = resolveNetworkLogoUrl(network, tmdbLogoPath);
    const row = {
      title, imdbId, imdbRating, simklId, tmdbId, year: show.year, ...images, network, networkLogoPath,
      totalEpisodes, available, watched, remaining,
      hours, mins, nextHours, nextMins, nextLabel, nextSeason, nextEpisode, episodeTitle, nextAirDate, badge,
      episodesLeft, lastWatchedAt: mostRecentWatchedAt(item),
    };
    return { row, remaining, remainingMinutes };
  }));

  const rows = results.map(r => r.row);
  const totalRemainingEps = results.reduce((sum, r) => sum + r.remaining, 0);
  const totalRemainingMinutes = results.reduce((sum, r) => sum + r.remainingMinutes, 0);

  // Sort by whichever is more recent: the next episode's air date, or the
  // last time you actually watched an episode of that show - most recent
  // first, shows with neither signal sink toward the end. The air date
  // alone would bury an already-ended show you're actively rewatching,
  // since its next unwatched episode's original air date is from years
  // ago; lastWatchedAt is what pulls it back to the top while you're
  // catching up on it. Compares actual timestamps (not raw strings),
  // since SIMKL dates carry a timezone offset that lexical string
  // comparison can get wrong across different offsets.
  const sortTimestamp = (row) => {
    const airTs = row.nextAirDate != null ? airDateToTimestamp(row.nextAirDate) : null;
    const watchTs = row.lastWatchedAt;
    if (airTs == null && watchTs == null) return null;
    if (airTs == null) return watchTs;
    if (watchTs == null) return airTs;
    return Math.max(airTs, watchTs);
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
  const recentlyWatched = await getRecentlyWatchedEpisodes(items, cache, episodeCache, token, ratingsCache);
  return [rows, totalRemainingEps, totalRemainingMinutes, recentlyWatched];
}

// ---------------------------------------------------------------------
// Airing Next - next upcoming (not-yet-aired) episode for shows you're
// actively watching, sorted soonest-first.
// ---------------------------------------------------------------------
async function nextAiringEpisode(tmdbId, showDetail, cache) {
  // Fallback path only (used when SIMKL has no episode data for a show).
  // TMDB has no time-of-day, only a date - so "today" is ambiguous (may
  // have already aired earlier today, or not yet). To avoid this showing
  // up in Airing Next AND simultaneously counting as "available" in My
  // List (a confusing overlap), we conservatively require STRICTLY a
  // future day here.
  if (!showDetail) return null;
  const today = todayLocalDateStr();
  let best = null;

  for (const seasonInfo of showDetail.seasons || []) {
    const seasonNum = seasonInfo.season_number;
    if (seasonNum == null || seasonNum === 0) continue; // skip specials

    const seasonDetail = await cache.getSeason(tmdbId, seasonNum);
    if (!seasonDetail) continue;

    for (const ep of seasonDetail.episodes || []) {
      const airDate = ep.air_date;
      if (!airDate || airDate <= today) continue; // strictly future days only
      if (!best || airDate < best.airDate) {
        best = { airDate, season: seasonNum, episode: ep.episode_number };
      }
    }
  }
  return best;
}

async function nextAiringEpisodeSimkl(simklId, token, episodeCache) {
  // Preferred path: SIMKL's own /tv/episodes data, which includes a full
  // date+time WITH timezone offset per episode. Uses the exact CURRENT
  // moment as the cutoff (not "start of today") - once an episode's real
  // air time has passed, it's excluded here, since My List's remaining
  // count (driven by SIMKL's own aired/not-aired judgment) will already
  // treat it as available. Without this, an episode that aired earlier
  // today would confusingly show up in both places at once.
  const episodes = await episodeCache.get(simklId, token);
  if (!episodes) return null;

  const now = Date.now();

  let best = null;
  for (const ep of episodes) {
    if (ep.season == null || ep.season === 0) continue; // skip specials
    if (ep.episode == null || !ep.date) continue;
    const ts = new Date(ep.date).getTime();
    if (isNaN(ts) || ts <= now) continue; // strictly in the future
    if (!best || ts < best.ts) {
      best = { ts, airDate: ep.date, season: ep.season, episode: ep.episode };
    }
  }
  return best;
}

function hasTimeComponent(dateStr) {
  // "YYYY-MM-DD" is exactly 10 chars (TMDB, date-only); a full ISO
  // datetime with time+offset (SIMKL) is longer.
  return typeof dateStr === "string" && dateStr.length > 10;
}

function airDateToTimestamp(dateStr) {
  const d = hasTimeComponent(dateStr) ? new Date(dateStr) : new Date(dateStr + "T00:00:00");
  return d.getTime();
}

function formatAirDate(dateStr) {
  const withTime = hasTimeComponent(dateStr);
  const today = new Date();
  const target = withTime ? new Date(dateStr) : new Date(dateStr + "T00:00:00");
  const sameYear = target.getFullYear() === today.getFullYear();

  if (withTime) {
    // We have SIMKL's real date+time (with timezone offset), so "Today"/
    // "Tomorrow" are trustworthy here - they're computed from the actual
    // moment, not guessed from a bare date. This is what keeps day labels
    // in sync with what simkl.com itself shows.
    const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    const diffDays = Math.round((startOfDay(target) - startOfDay(today)) / 86400000);
    const timeStr = target.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    let dayLabel;
    if (diffDays === 0) dayLabel = "Today";
    else if (diffDays === 1) dayLabel = "Tomorrow";
    else if (diffDays > 1 && diffDays < 7) dayLabel = target.toLocaleDateString(undefined, { weekday: "long" });
    else {
      dayLabel = target.toLocaleDateString(undefined, sameYear
        ? { weekday: "long", month: "short", day: "numeric" }
        : { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    }
    return `${dayLabel}, ${timeStr}`;
  }

  // Fallback path (SIMKL episode data unavailable for this show): only a
  // bare date, no reliable time-of-day - deliberately NOT using "Today"/
  // "Tomorrow" here, since that guess is what caused the mismatch with
  // SIMKL's own calendar in the first place.
  return target.toLocaleDateString(undefined, sameYear
    ? { weekday: "long", month: "short", day: "numeric" }
    : { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

async function buildAiringRow(item, cache, episodeCache, ratingsCache, token, requirePremiere) {
  // Fast-path guard, trusting SIMKL's own aggregate field directly: if
  // SIMKL itself says there are zero not-yet-aired episodes for this show,
  // there is definitively nothing upcoming - skip immediately rather than
  // going episode-by-episode (which is also where the earlier mismatch
  // came from, if TMDB's per-episode dates disagree with SIMKL's own
  // judgment).
  if (item.not_aired_episodes_count === 0) return null;

  const show = item.show || {};
  const tmdbId = (show.ids || {}).tmdb;
  const simklId = (show.ids || {}).simkl;
  const imdbId = (show.ids || {}).imdb;

  // Prefer SIMKL's own episode data (exact date+time, matches simkl.com);
  // fall back to TMDB (date only) if SIMKL has nothing for this show.
  let next = simklId ? await nextAiringEpisodeSimkl(simklId, token, episodeCache) : null;

  const showDetail = tmdbId ? await cache.getShow(tmdbId) : null;
  if (!next && tmdbId) {
    next = await nextAiringEpisode(tmdbId, showDetail, cache);
  }
  if (!next) return null; // nothing upcoming known for this show, from either source

  // For Plan to Watch shows, only include ones that haven't premiered at
  // all yet (next episode is the literal series premiere, S01E01) - a
  // Plan to Watch show that's already been airing for years but the user
  // just hasn't started isn't a "premiere", it's backlog, so it's excluded.
  if (requirePremiere && !(next.season === 1 && next.episode === 1)) return null;

  const images = computeImages(showDetail, tmdbId);
  const nextLabel = (next.season != null && next.episode != null)
    ? `S${String(next.season).padStart(2, "0")}E${String(next.episode).padStart(2, "0")}`
    : "";

  // Episode title: prefer SIMKL's own title if we have it, else TMDB's.
  let nextEpisodeTitle = null;
  if (simklId) {
    const simklEpisodes = await episodeCache.get(simklId, token);
    const match = simklEpisodes && simklEpisodes.find(e => e.season === next.season && e.episode === next.episode);
    if (match && match.title && !/^Episode\s+\d+$/i.test(String(match.title).trim())) {
      nextEpisodeTitle = String(match.title).trim();
    }
  }
  if (!nextEpisodeTitle && tmdbId && showDetail) {
    const seasonDetail = await cache.getSeason(tmdbId, next.season);
    const episodeDetail = seasonDetail && (seasonDetail.episodes || [])
      .find(e => e.episode_number === next.episode);
    if (episodeDetail && episodeDetail.name && !/^Episode\s+\d+$/i.test(episodeDetail.name.trim())) {
      nextEpisodeTitle = episodeDetail.name.trim();
    }
  }

  const simklShowData = simklId ? await ratingsCache.get(simklId, token) : null;
  const imdbRating = extractImdbRating(simklShowData);

  // Premiere/finale badge, matching SIMKL's own "SEASON PREMIERE" labeling:
  // episode 1 of a season is a premiere (season 1 specifically is a series
  // premiere); otherwise, if this is the highest episode number SIMKL has
  // listed for that season, treat it as the season finale. The finale check
  // is a best-effort signal only - it reflects what SIMKL has published for
  // the season so far, not confirmed final-episode metadata.
  let badge = null;
  if (next.episode === 1) {
    badge = next.season === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
  } else if (simklId) {
    const simklEpisodes = await episodeCache.get(simklId, token);
    const sameSeason = (simklEpisodes || []).filter(e => e.season === next.season && e.episode != null);
    if (sameSeason.length) {
      const maxEpisode = Math.max(...sameSeason.map(e => e.episode));
      if (next.episode === maxEpisode) badge = "SEASON FINALE";
    }
  }

  const showNetwork = latestNetwork(showDetail);
  let network = showNetwork ? showNetwork.name : null;
  const tmdbLogoPath = showNetwork ? showNetwork.logo_path : null;
  if (!network) network = extractSimklNetwork(simklShowData);

  return {
    title: show.title || "Unknown",
    imdbId,
    tmdbId,
    imdbRating,
    ...images,
    nextLabel,
    nextEpisodeTitle,
    badge,
    airDate: next.airDate,
    airDateLabel: formatAirDate(next.airDate),
    network,
    networkLogoPath: resolveNetworkLogoUrl(network, tmdbLogoPath),
  };
}

async function getAiringNextRows(token, cache, episodeCache, ratingsCache) {
  cache = cache || new TmdbCache();
  episodeCache = episodeCache || new SimklEpisodeCache();
  ratingsCache = ratingsCache || new SimklShowCache();

  const [watchingItems, planToWatchItems] = await Promise.all([
    getWatchingShows(token),
    getPlanToWatchShows(token),
  ]);

  // Both passes run their per-show work concurrently. The second pass still
  // has to wait for the first to finish (it needs the full seenTmdbIds set
  // to skip shows already added from Watching), but within each pass every
  // show is fetched in parallel instead of one-at-a-time.
  const watchingEligible = watchingItems.filter(item => item.status === "watching");
  const watchingRows = await Promise.all(watchingEligible.map(item =>
    buildAiringRow(item, cache, episodeCache, ratingsCache, token, /* requirePremiere */ false)
  ));

  const rows = [];
  const seenTmdbIds = new Set();
  watchingEligible.forEach((item, i) => {
    const row = watchingRows[i];
    if (!row) return;
    const tmdbId = (item.show || {}).ids && item.show.ids.tmdb;
    if (tmdbId) seenTmdbIds.add(tmdbId);
    rows.push(row);
  });

  const planEligible = planToWatchItems.filter(item => {
    if (item.status !== "plantowatch") return false;
    const tmdbId = (item.show || {}).ids && item.show.ids.tmdb;
    return !(tmdbId && seenTmdbIds.has(tmdbId)); // already added from Watching
  });
  const planRows = await Promise.all(planEligible.map(item =>
    buildAiringRow(item, cache, episodeCache, ratingsCache, token, /* requirePremiere */ true)
  ));
  for (const row of planRows) {
    if (row) rows.push(row);
  }

  // Compare actual timestamps, not raw strings - SIMKL dates carry a
  // timezone offset that lexical string comparison can get wrong.
  rows.sort((a, b) => airDateToTimestamp(a.airDate) - airDateToTimestamp(b.airDate));
  rows.forEach((r, i) => { r.index = i + 1; });
  return rows;
}

// ---------------------------------------------------------------------
// SIMKL write operations - search, add-to-list, status change, remove
// ---------------------------------------------------------------------
async function simklAddToList(ids, toStatus, token, extra) {
  const show = { to: toStatus, ids, ...(extra || {}) };
  return simklPost("/sync/add-to-list", token, { shows: [show] });
}

async function removeShowFromList(simklId, token) {
  // POST /sync/history/remove with just an ids object (no seasons/episodes)
  // removes the show from the user's library entirely - equivalent to
  // clicking "Remove from list" on simkl.com.
  return simklPost("/sync/history/remove", token, { shows: [{ ids: { simkl: simklId } }] });
}

async function markEpisodeWatched(simklId, season, episode, token) {
  return simklPost("/sync/history", token, {
    shows: [{ ids: { simkl: simklId }, seasons: [{ number: season, episodes: [{ number: episode }] }] }],
  });
}

// Normalized to the same {title, year, posterUrl, ids} shape TMDB results
// use below, so the rest of the search UI (render, add-to-list, status
// lookup) never needs to branch on which source a result came from.
async function searchTvShows(query, token) {
  const data = await simklGet("/search/tv", token, { q: query });
  const results = Array.isArray(data) ? data : [];
  return results.map(r => ({
    title: r.title || "Unknown",
    year: r.year || "",
    posterUrl: r.poster ? `https://simkl.in/posters/${r.poster}_m.jpg` : null,
    ids: r.ids || {},
  }));
}

// SIMKL's own search doesn't handle Hebrew queries well, so this runs
// alongside it (see wireSearchInput) rather than replacing it - TMDB does
// support a language param, which improves matching for Hebrew queries
// specifically (and is a fine default for others too: it only affects
// which localized title TMDB returns, not whether a show matches at all).
// Results only ever carry a tmdb id (no simkl id) - simklAddToList and
// findShowLibraryStatus already accept any subset of simkl/tmdb/imdb ids,
// so nothing downstream needs to know the difference.
async function searchTvShowsTmdb(query) {
  const data = await tmdbGet("/search/tv", { query, language: "he-IL" }).catch(() => null);
  const results = (data && data.results) || [];
  return results.map(r => ({
    title: r.name || r.original_name || "Unknown",
    year: (r.first_air_date || "").slice(0, 4),
    posterUrl: r.poster_path ? TMDB_IMAGE_BASE + r.poster_path : null,
    ids: { tmdb: r.id },
  }));
}

// Combines both sources, skipping a TMDB result whose tmdb id is already
// covered by a SIMKL result (which carries the richer id set) - both lists
// individually come back oldest-relevance-first from their own API, so
// simplest is to just keep SIMKL's results first, TMDB's new ones after.
function mergeSearchResults(simklResults, tmdbResults) {
  const seenTmdb = new Set(
    simklResults.map(r => r.ids && r.ids.tmdb).filter(v => v != null).map(String)
  );
  const extra = tmdbResults.filter(r => !(r.ids && r.ids.tmdb != null && seenTmdb.has(String(r.ids.tmdb))));
  return [...simklResults, ...extra];
}

const LIBRARY_STATUSES = ["watching", "plantowatch", "hold", "completed", "dropped"];
const STATUS_LABELS = {
  watching: "Watching", plantowatch: "Plan to Watch", hold: "On Hold",
  completed: "Completed", dropped: "Dropped",
};
const ALL_STATUS_OPTIONS = [
  { value: "plantowatch", label: "Plan to Watch" },
  { value: "watching", label: "Watching" },
  { value: "hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "dropped", label: "Dropped" },
];

function idsMatch(a, b) {
  if (!a || !b) return false;
  return (a.simkl && b.simkl && a.simkl === b.simkl) ||
    (a.tmdb && b.tmdb && String(a.tmdb) === String(b.tmdb)) ||
    (a.imdb && b.imdb && a.imdb === b.imdb);
}

async function findShowLibraryStatus(ids, token) {
  // No single SIMKL endpoint reports "what's the status of this one show",
  // so this checks each of the 5 possible lists (same endpoint shape as
  // getWatchingShows/getPlanToWatchShows) and returns the first match.
  const lists = await Promise.all(
    LIBRARY_STATUSES.map(status =>
      simklGet(`/sync/all-items/shows/${status}`, token, { extended: "full" }).catch(() => null)
    )
  );
  for (let i = 0; i < LIBRARY_STATUSES.length; i++) {
    const data = lists[i];
    const items = Array.isArray(data) ? data : (data && data.shows) || [];
    const match = items.find(item => idsMatch((item.show || {}).ids, ids));
    if (match) return { status: LIBRARY_STATUSES[i], item: match };
  }
  return null;
}

function renderSearchResults(results) {
  const container = document.getElementById("searchResults");
  if (!container) return;
  if (!results.length) {
    container.innerHTML = `<p style="color:var(--muted);font-size:0.85rem;padding:10px 4px">No results.</p>`;
    return;
  }
  container.innerHTML = results.map((r, i) => {
    const posterHtml = r.posterUrl
      ? `<img class="search-result-poster" src="${r.posterUrl}" alt="${r.title || ""}">`
      : `<div class="search-result-poster placeholder">${((r.title || "?")[0] || "?").toUpperCase()}</div>`;
    return `
      <div class="search-result-row" data-idx="${i}">
        ${posterHtml}
        <div class="search-result-info">
          <div class="search-result-title">${r.title || "Unknown"}</div>
          <div class="search-result-year">${r.year || ""}</div>
        </div>
      </div>`;
  }).join("\n");

  container.querySelectorAll(".search-result-row").forEach(row => {
    row.onclick = () => openShowDetail(results[Number(row.dataset.idx)]);
  });
}

let searchDebounceTimer = null;
let lastSearchQuery = "";
let lastSearchResults = [];

function wireSearchInput() {
  const input = document.getElementById("searchQueryInput");
  if (!input) return;
  input.focus();
  input.value = lastSearchQuery;
  input.oninput = () => {
    clearTimeout(searchDebounceTimer);
    lastSearchQuery = input.value.trim();
    if (!lastSearchQuery) {
      lastSearchResults = [];
      renderSearchResults([]);
      return;
    }
    searchDebounceTimer = setTimeout(async () => {
      const queryAtRequestTime = lastSearchQuery;
      try {
        const [simklResults, tmdbResults] = await Promise.all([
          searchTvShows(queryAtRequestTime, simklToken).catch(() => []),
          searchTvShowsTmdb(queryAtRequestTime).catch(() => []),
        ]);
        if (queryAtRequestTime !== lastSearchQuery) return; // superseded by newer input
        lastSearchResults = mergeSearchResults(simklResults, tmdbResults);
        renderSearchResults(lastSearchResults);
      } catch (err) {
        if (queryAtRequestTime !== lastSearchQuery) return;
        document.getElementById("searchResults").innerHTML = `<div class="error-box">${err.message}</div>`;
      }
    }, 400);
  };
}

function renderSearchStep() {
  const title = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  if (!title || !body) return;
  title.textContent = "Search a TV show (English or Hebrew)";
  body.innerHTML = `
    <div class="search-input-row">
      <input type="text" id="searchQueryInput" placeholder="Search…" autocomplete="off">
    </div>
    <div class="search-results" id="searchResults"></div>`;
  wireSearchInput();
  renderSearchResults(lastSearchResults);
}

async function openShowDetail(show) {
  const title = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  if (!title || !body) return;
  title.textContent = show.title || "Show";
  body.innerHTML = `
    <button class="modal-back-btn" id="detailBackBtn">&larr; Back to search</button>
    <div class="spinner" style="margin:30px auto"></div>`;
  document.getElementById("detailBackBtn").onclick = renderSearchStep;

  const ids = show.ids || {};
  let libraryMatch = null;
  try {
    libraryMatch = await findShowLibraryStatus(ids, simklToken);
  } catch (err) {
    body.innerHTML = `
      <button class="modal-back-btn" id="detailBackBtn">&larr; Back to search</button>
      <div class="error-box">${err.message}</div>`;
    document.getElementById("detailBackBtn").onclick = renderSearchStep;
    return;
  }
  renderShowDetail(show, libraryMatch);
}

function renderShowDetail(show, libraryMatch) {
  const body = document.getElementById("modalBody");
  if (!body) return;
  const posterHtml = show.posterUrl
    ? `<img class="detail-poster" src="${show.posterUrl}" alt="${show.title || ""}">`
    : `<div class="detail-poster placeholder">${((show.title || "?")[0] || "?").toUpperCase()}</div>`;

  let statusHtml;
  if (!libraryMatch) {
    statusHtml = `<div class="detail-status not-in-list">Not in your list yet</div>`;
  } else {
    const item = libraryMatch.item;
    const watched = item.watched_episodes_count || 0;
    const total = item.total_episodes_count || 0;
    const progress = total ? ` — ${watched}/${total} episodes watched` : "";
    statusHtml = `<div class="detail-status in-list">${STATUS_LABELS[libraryMatch.status]}${progress}</div>`;
  }

  const statusButtons = ALL_STATUS_OPTIONS.map(opt => {
    const isActive = libraryMatch && libraryMatch.status === opt.value;
    return `<button class="card-menu-item${isActive ? " active" : ""}" data-status="${opt.value}">
      ${opt.label}${isActive ? " ✓" : ""}
    </button>`;
  }).join("");

  const removeHtml = libraryMatch
    ? `<div class="card-menu-sep"></div>
       <button class="card-menu-item danger" id="detailRemoveBtn">Remove from list</button>`
    : "";

  body.innerHTML = `
    <button class="modal-back-btn" id="detailBackBtn">&larr; Back to search</button>
    <div class="detail-header">
      ${posterHtml}
      <div class="detail-info">
        <div class="detail-title">${show.title || "Unknown"}</div>
        <div class="detail-year">${show.year || ""}</div>
        ${statusHtml}
      </div>
    </div>
    <div class="detail-status-picker">
      <p class="detail-picker-label">Set status:</p>
      ${statusButtons}
      ${removeHtml}
    </div>`;

  document.getElementById("detailBackBtn").onclick = renderSearchStep;
  body.querySelectorAll("[data-status]").forEach(btn => {
    btn.onclick = () => setShowStatusFromDetail(show, btn.dataset.status, btn);
  });
  const removeBtn = document.getElementById("detailRemoveBtn");
  if (removeBtn) {
    removeBtn.onclick = () => removeShowFromDetail(show, libraryMatch, removeBtn);
  }
}

async function removeShowFromDetail(show, libraryMatch, btnEl) {
  const simklId = (libraryMatch.item.show || {}).ids && libraryMatch.item.show.ids.simkl;
  if (!simklId) {
    showToast("This result has no usable ID.", true);
    return;
  }
  if (!confirm(`Remove "${show.title}" from your SIMKL list entirely?`)) return;
  const buttons = btnEl.parentElement.querySelectorAll("button");
  buttons.forEach(b => { b.disabled = true; });
  try {
    await removeShowFromList(simklId, simklToken);
    showToast(`Removed "${show.title}"`);
    closeSearchModal();
    main();
  } catch (err) {
    buttons.forEach(b => { b.disabled = false; });
    showToast(err.message, true);
  }
}

async function setShowStatusFromDetail(show, status, btnEl) {
  const ids = show.ids || {};
  if (!ids.simkl && !ids.tmdb && !ids.imdb) {
    showToast("This result has no usable ID.", true);
    return;
  }
  const buttons = btnEl.parentElement.querySelectorAll("button");
  buttons.forEach(b => { b.disabled = true; });
  try {
    await simklAddToList(ids, status, simklToken, { title: show.title, year: show.year });
    showToast(`"${show.title}" set to ${STATUS_LABELS[status]}`);
    closeSearchModal();
    main();
  } catch (err) {
    buttons.forEach(b => { b.disabled = false; });
    showToast(err.message, true);
  }
}

// Per-episode breakdown of a top-card show's remaining watch time -
// opened by clicking the "Xh Ym left" line. episodesLeft was already
// computed alongside the total (see estimateRemainingMinutes), so this
// is pure rendering, no extra fetch - IMDb links (desktop only, see
// enrichEpisodesWithImdbLinks) are fetched lazily afterward instead.
function openEpisodesModal(arrIdx) {
  const row = getCycleRows("main")[arrIdx];
  if (!row || !row.episodesLeft || !row.episodesLeft.length) return;

  const rowsHtml = row.episodesLeft.map((ep, i) => {
    const isNext = i === 0;
    const code = ep.season != null && ep.episode != null
      ? `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`
      : "";
    const badgeHtml = ep.badge ? `<span class="episode-badge${ep.badge === "SEASON FINALE" ? " finale" : ""}">${ep.badge}</span>` : "";
    return `
      <div class="episode-row${isNext ? " is-next" : ""}">
        <span class="episode-code">${code}</span>
        <span class="episode-name" data-ep-key="${i}">${ep.title || (ep.episode != null ? `Episode ${ep.episode}` : "Episode")}</span>
        ${badgeHtml}
        <span class="episode-runtime">${formatEpisodeRuntime(ep.runtime)}</span>
      </div>`;
  }).join("\n");
  const [totalH, totalM] = formatTime(row.episodesLeft.reduce((sum, ep) => sum + ep.runtime, 0));

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "episodesModalOverlay";
  const headerEl = document.querySelector("header");
  overlay.style.paddingTop = `${(headerEl ? headerEl.offsetHeight : 0) + 24}px`;
  overlay.innerHTML = `
    <div class="modal-box episodes-modal">
      <div class="episodes-modal-head">
        <div class="list-panel-header">${LIST_ICON_SOLID_SVG}<span>EPISODES LEFT</span></div>
        <button class="modal-close-btn" id="episodesModalCloseBtn">&times;</button>
      </div>
      <div class="episodes-modal-subtitle">${row.title}</div>
      <div class="episodes-list">${rowsHtml}</div>
      <div class="episodes-modal-foot">
        <span class="label">Total remaining</span>
        <span class="total">${totalH}h ${totalM}m</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("episodesModalCloseBtn").onclick = closeEpisodesModal;
  overlay.addEventListener("click", e => { if (e.target === overlay) closeEpisodesModal(); });
  document.addEventListener("keydown", episodesModalEscHandler);

  if (!window.matchMedia("(max-width: 720px)").matches) {
    enrichEpisodesWithImdbLinks(row);
  }
}

// Turns each episode name into a link to its own IMDb page, once TMDB's
// per-episode id lookup resolves - desktop only (see the matchMedia guard
// at the call site), since it's an extra network request per episode and
// this modal already lays out differently below the mobile breakpoint.
// Cached persistently (see getEpisodeExternalIds), so this only costs a
// real fetch the first time a given episode is looked up, ever.
function enrichEpisodesWithImdbLinks(row) {
  if (!row.tmdbId || !sharedCache) return;
  row.episodesLeft.forEach((ep, i) => {
    if (ep.season == null || ep.episode == null) return;
    sharedCache.getEpisodeExternalIds(row.tmdbId, ep.season, ep.episode).then(ids => {
      if (!ids || !ids.imdb_id) return;
      const overlay = document.getElementById("episodesModalOverlay");
      const nameEl = overlay && overlay.querySelector(`.episode-name[data-ep-key="${i}"]`);
      if (!nameEl || nameEl.querySelector("a")) return;
      const link = document.createElement("a");
      link.href = `https://www.imdb.com/title/${ids.imdb_id}/`;
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "episode-name-link";
      link.textContent = nameEl.textContent;
      nameEl.textContent = "";
      nameEl.appendChild(link);
    });
  });
}

function episodesModalEscHandler(e) {
  if (e.key === "Escape") closeEpisodesModal();
}

function closeEpisodesModal() {
  const overlay = document.getElementById("episodesModalOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", episodesModalEscHandler);
}

// Picks how many cast members count as "main cast": sorts by total episode
// count (aggregate_credits sums it across every season, so long-running
// leads still rank first late into a show's run) and looks for the natural
// cliff where episode counts drop off - the point where the regulars end
// and background/guest actors begin. Always keeps at least 10 (if that many
// exist) and never more than 20.
function selectMainCast(cast) {
  const withCounts = cast.map(c => ({ ...c, epCount: c.total_episode_count || 0 }));
  withCounts.sort((a, b) => b.epCount - a.epCount || (a.order ?? 999) - (b.order ?? 999));

  const MIN = 10, MAX = 20;
  if (withCounts.length <= MIN) return withCounts;

  const upper = Math.min(withCounts.length - 1, MAX);
  let cutIdx = Math.min(withCounts.length, MAX) - 1;
  let bestRatio = 1, bestIdx = -1;
  for (let i = MIN - 1; i < upper; i++) {
    const cur = withCounts[i].epCount;
    const next = withCounts[i + 1].epCount;
    if (cur <= 0) break;
    const ratio = next > 0 ? cur / next : cur + 1;
    if (ratio > bestRatio) { bestRatio = ratio; bestIdx = i; }
  }
  if (bestIdx >= 0 && bestRatio > 1.4) cutIdx = bestIdx;
  return withCounts.slice(0, cutIdx + 1);
}

// Preloads a cast photo so it's already decoded in the browser's cache by
// the time the modal's HTML references it - otherwise, on a slow
// connection, photos pop in one by one after the flip-in animation has
// already finished. Never rejects: a failed photo just falls through to
// the modal's own placeholder handling.
function preloadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = resolve;
    img.src = src;
    // A stalled request (dead network, slow host) must not block the
    // whole modal from ever appearing - give up on this one photo after
    // a few seconds and let it fall back to loading in the background.
    setTimeout(resolve, 5000);
  });
}

let castModalOpenToken = 0;

// Main cast for a show - opened by clicking its title in any of the four
// places it can appear (top carousel + the three bottom panels all share
// this one handler via the same source/idx convention as getCycleRows).
// Unlike the Episodes Left modal, there's real fetching to do here (no
// cast data is part of the normal per-card fetch): credits and every
// photo are resolved *before* the modal is built, so the flip-in
// animation always reveals a fully-loaded grid instead of one that's
// still populating mid-spin. A token guards against a second click
// (same or different title) landing while the first is still loading.
async function openCastModal(source, idx) {
  const row = getCycleRows(source)[idx];
  if (!row || !row.tmdbId || !sharedCache) return;

  const openToken = ++castModalOpenToken;
  const cache = sharedCache;
  document.body.style.cursor = "wait";

  const data = await cache.getCredits(row.tmdbId);
  const top = selectMainCast((data && data.cast) || []);
  await Promise.all(
    top.filter(p => p.profile_path).map(p => preloadImage(`${TMDB_PROFILE_BASE}${p.profile_path}`))
  );

  if (openToken !== castModalOpenToken) return; // superseded by a newer click
  document.body.style.cursor = "";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "castModalOverlay";
  const headerEl = document.querySelector("header");
  overlay.style.paddingTop = `${(headerEl ? headerEl.offsetHeight : 0) + 24}px`;

  const gridHtml = top.length
    ? top.map((person, i) => {
        const photoHtml = person.profile_path
          ? `<img class="cast-photo" src="${TMDB_PROFILE_BASE}${person.profile_path}" alt="${person.name}">`
          : `<div class="cast-photo placeholder">${(person.name[0] || "?").toUpperCase()}</div>`;
        const character = (person.roles && person.roles[0] && person.roles[0].character) || "";
        const epCount = person.epCount || person.total_episode_count || 0;
        return `
          <div class="cast-item">
            ${photoHtml}
            <div class="cast-info">
              <span class="cast-name" data-person-idx="${i}">${person.name}</span>
              ${character ? `<span class="cast-character">${character}</span>` : ""}
              ${epCount ? `<span class="cast-episodes">${epCount} episode${epCount === 1 ? "" : "s"}</span>` : ""}
            </div>
          </div>`;
      }).join("\n")
    : `<p style="color:var(--muted);font-size:0.85rem;padding:10px 4px">No cast information available.</p>`;

  overlay.innerHTML = `
    <div class="modal-box cast-modal">
      <div class="episodes-modal-head">
        <div class="list-panel-header">${CAST_ICON_SOLID_SVG}<span>CAST</span></div>
        <button class="modal-close-btn" id="castModalCloseBtn">&times;</button>
      </div>
      <div class="episodes-modal-subtitle">${row.title}</div>
      <div class="cast-grid" id="castGrid">${gridHtml}</div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("castModalCloseBtn").onclick = closeCastModal;
  overlay.addEventListener("click", e => { if (e.target === overlay) closeCastModal(); });
  document.addEventListener("keydown", castModalEscHandler);

  const grid = document.getElementById("castGrid");
  if (!top.length) return;

  // Each name becomes an IMDb link once that person's id resolves - lazy,
  // same reasoning as the Episodes Left modal's per-episode IMDb links.
  top.forEach((person, i) => {
    cache.getPersonExternalIds(person.id).then(ids => {
      if (!ids || !ids.imdb_id) return;
      const nameEl = grid.querySelector(`.cast-name[data-person-idx="${i}"]`);
      if (!nameEl || nameEl.querySelector("a")) return;
      const link = document.createElement("a");
      link.href = `https://www.imdb.com/name/${ids.imdb_id}/`;
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "cast-name-link";
      link.textContent = nameEl.textContent;
      nameEl.textContent = "";
      nameEl.appendChild(link);
    });
  });
}

function castModalEscHandler(e) {
  if (e.key === "Escape") closeCastModal();
}

function closeCastModal() {
  const overlay = document.getElementById("castModalOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", castModalEscHandler);
}

function openSearchModal() {
  if (!simklToken) return;
  document.getElementById("addShowBtn").classList.add("active");
  lastSearchQuery = "";
  lastSearchResults = [];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "searchModalOverlay";
  const headerEl = document.querySelector("header");
  overlay.style.paddingTop = `${(headerEl ? headerEl.offsetHeight : 0) + 24}px`;
  overlay.innerHTML = `
    <div class="modal-box">
      <h2><span id="modalTitle">Search a TV show (English or Hebrew)</span> <button class="modal-close-btn" id="searchModalCloseBtn">&times;</button></h2>
      <div id="modalBody"></div>
    </div>`;
  document.body.appendChild(overlay);

  renderSearchStep();

  document.getElementById("searchModalCloseBtn").onclick = closeSearchModal;
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSearchModal(); });
  document.addEventListener("keydown", searchModalEscHandler);
}

function searchModalEscHandler(e) {
  if (e.key === "Escape") closeSearchModal();
}

function closeSearchModal() {
  document.getElementById("addShowBtn").classList.remove("active");
  const overlay = document.getElementById("searchModalOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", searchModalEscHandler);
}

// ---------------------------------------------------------------------
// Per-card status/remove menu
// ---------------------------------------------------------------------
const STATUS_OPTIONS = [
  { value: "watching", label: "Watching" },
  { value: "hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "dropped", label: "Dropped" },
];

let cardMenuOpenerBtn = null;

function closeCardMenu() {
  const el = document.getElementById("cardMenuDropdown");
  if (el) el.remove();
  document.removeEventListener("keydown", cardMenuEscHandler);
  document.removeEventListener("click", cardMenuOutsideClickHandler);
  cardMenuOpenerBtn = null;
}

function cardMenuEscHandler(e) {
  if (e.key === "Escape") closeCardMenu();
}

function cardMenuOutsideClickHandler(e) {
  const menu = document.getElementById("cardMenuDropdown");
  if (menu && !menu.contains(e.target)) closeCardMenu();
}

function openCardMenu(arrIdx, btnEl) {
  const alreadyOpenForThisBtn = cardMenuOpenerBtn === btnEl;
  closeCardMenu();
  if (alreadyOpenForThisBtn) return; // second click on the same button toggles it closed

  const row = lastRows && lastRows[arrIdx];
  if (!row || !row.simklId) return;

  const rect = btnEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "card-menu-dropdown";
  menu.id = "cardMenuDropdown";
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 190)}px`;

  const statusButtons = STATUS_OPTIONS.map(opt => `
    <button class="card-menu-item${opt.value === "watching" ? " active" : ""}" data-status="${opt.value}">
      ${opt.label}${opt.value === "watching" ? " ✓" : ""}
    </button>`).join("");

  const markWatchedHtml = (row.nextSeason != null && row.nextEpisode != null)
    ? `<button class="card-menu-item watched-action" id="cardMenuMarkWatchedBtn">${CHECK_ICON_SVG}Mark ${row.nextLabel} watched</button>
       <div class="card-menu-sep"></div>`
    : "";

  menu.innerHTML = `
    ${markWatchedHtml}
    ${statusButtons}
    <div class="card-menu-sep"></div>
    <button class="card-menu-item danger" id="cardMenuRemoveBtn">Remove from list</button>
  `;
  document.body.appendChild(menu);
  cardMenuOpenerBtn = btnEl;

  menu.querySelectorAll("[data-status]").forEach(b => {
    b.onclick = () => changeShowStatus(row, b.dataset.status);
  });
  document.getElementById("cardMenuRemoveBtn").onclick = () => removeShowFromMyList(row);
  const markWatchedBtn = document.getElementById("cardMenuMarkWatchedBtn");
  if (markWatchedBtn) markWatchedBtn.onclick = () => markNextEpisodeWatched(row);

  setTimeout(() => document.addEventListener("click", cardMenuOutsideClickHandler), 0);
  document.addEventListener("keydown", cardMenuEscHandler);
}

async function changeShowStatus(row, status) {
  closeCardMenu();
  try {
    await simklAddToList(
      { simkl: row.simklId, tmdb: row.tmdbId, imdb: row.imdbId },
      status, simklToken, { title: row.title, year: row.year }
    );
    showToast(`Moved "${row.title}" to ${status}`);
    main();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function markNextEpisodeWatched(row) {
  closeCardMenu();
  try {
    await markEpisodeWatched(row.simklId, row.nextSeason, row.nextEpisode, simklToken);
    showToast(`Marked "${row.title}" ${row.nextLabel} as watched`);
    main();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function removeShowFromMyList(row) {
  closeCardMenu();
  if (!confirm(`Remove "${row.title}" from your SIMKL list entirely?`)) return;
  try {
    await removeShowFromList(row.simklId, simklToken);
    showToast(`Removed "${row.title}"`);
    main();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Same dropdown as openCardMenu, but for a Plan to Watch row: the current
// status is always "plantowatch" here (rather than "watching"), so this
// uses the full 5-status list - with Plan to Watch itself shown as the
// active one - instead of the My List menu's watching-excluded set.
function openPlanCardMenu(idx, btnEl) {
  const alreadyOpenForThisBtn = cardMenuOpenerBtn === btnEl;
  closeCardMenu();
  if (alreadyOpenForThisBtn) return;

  const row = getCycleRows("plan")[idx];
  if (!row || !row.simklId) return;

  const rect = btnEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "card-menu-dropdown";
  menu.id = "cardMenuDropdown";
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 190)}px`;

  const statusButtons = ALL_STATUS_OPTIONS.map(opt => `
    <button class="card-menu-item${opt.value === "plantowatch" ? " active" : ""}" data-status="${opt.value}">
      ${opt.label}${opt.value === "plantowatch" ? " ✓" : ""}
    </button>`).join("");

  menu.innerHTML = `
    ${statusButtons}
    <div class="card-menu-sep"></div>
    <button class="card-menu-item danger" id="cardMenuRemoveBtn">Remove from list</button>
  `;
  document.body.appendChild(menu);
  cardMenuOpenerBtn = btnEl;

  menu.querySelectorAll("[data-status]").forEach(b => {
    b.onclick = () => changeShowStatus(row, b.dataset.status);
  });
  document.getElementById("cardMenuRemoveBtn").onclick = () => removeShowFromMyList(row);

  setTimeout(() => document.addEventListener("click", cardMenuOutsideClickHandler), 0);
  document.addEventListener("keydown", cardMenuEscHandler);
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
let lastRows = null;
let lastTotalEps = 0;
let lastTotalMinutes = 0;
let lastRecentlyWatched = [];
let lastPlanToWatch = [];
let lastAiringPreview = [];
let airingRows = null;       // lazily fetched, cached until next Refresh
let sharedCache = null;      // TmdbCache reused across both views for one session
let sharedEpisodeCache = null; // SimklEpisodeCache, same idea
let sharedRatingsCache = null; // SimklShowCache, same idea
let simklToken = null;
let currentView = "list";    // "list" | "airing"

function updateImageModeButton() {
  const btn = document.getElementById("imageModeBtn");
  const mode = getImageMode();
  const nextLabel = mode === "poster" ? "Banners" : "Posters";
  const icon = mode === "poster" ? ICON_BANNER_SHAPE : ICON_POSTER_SHAPE;
  btn.innerHTML = `<span class="nav-icon">${icon}</span>Switch to ${nextLabel}`;
}

function applyStoredTheme() {
  const isLight = localStorage.getItem(LS_THEME) === "light";
  document.body.classList.toggle("light-theme", isLight);
  updateThemeToggleButton();
}

function updateThemeToggleButton() {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return; // only present while the Settings panel is open
  const isLight = document.body.classList.contains("light-theme");
  // "on" = dark mode active, matching the toggle's cyan/knob-right state.
  btn.classList.toggle("on", !isLight);
}

function updatePageTitle() {
  document.title = currentView === "airing" ? "Airing Next" : "My Watch List";
}

function updateViewModeButton() {
  document.getElementById("settingsBtn").classList.remove("active");
  updatePageTitle();
}

const IMAGE_MODE_CONFIG = {
  poster: { urlKey: "posterUrl", pathsKey: "posterPaths", indexKey: "posterIndex", base: TMDB_IMAGE_BASE, extraClass: "" },
  banner: { urlKey: "bannerUrl", pathsKey: "backdropPaths", indexKey: "bannerIndex", base: TMDB_BACKDROP_BASE, extraClass: " banner-img" },
};

// The four places a show's poster/banner can appear, each backed by its
// own cached row array - "main" is the top carousel (plus the dead Airing
// Next tab, kept for parity), the rest are the three bottom panels.
function getCycleRows(source) {
  switch (source) {
    case "main": return currentView === "airing" ? airingRows : lastRows;
    case "watched": return lastRecentlyWatched;
    case "plan": return lastPlanToWatch;
    case "airing": return lastAiringPreview;
    default: return null;
  }
}

function rerenderAfterCycle(source) {
  if (source === "main" && currentView === "airing") {
    renderAiringRows(airingRows);
  } else {
    // Bottom-panel rows were mutated in place (same array/row references
    // renderRows already has cached), so a 3-arg call re-renders them from
    // that cache instead of needing their own dedicated render calls.
    renderRows(lastRows, lastTotalEps, lastTotalMinutes);
  }
}

function cycleImage(source, idx, modeOverride, direction) {
  const rows = getCycleRows(source);
  const row = rows && rows[idx];
  if (!row) return;
  const mode = modeOverride || getImageMode();
  const cfg = IMAGE_MODE_CONFIG[mode];
  const paths = row[cfg.pathsKey];
  if (!paths || paths.length <= 1) return; // nothing else to switch to
  row[cfg.indexKey] = (row[cfg.indexKey] + (direction || 1) + paths.length) % paths.length;
  const newPath = paths[row[cfg.indexKey]];
  row[cfg.urlKey] = cfg.base + newPath;
  saveImageOverride(row.tmdbId, mode, newPath); // survives the next refresh
  syncImageAcrossCards(row.tmdbId, cfg, row[cfg.indexKey], row[cfg.urlKey]);
  rerenderAfterCycle(source);
}

// The same show can appear in the top carousel and in any of the three
// bottom panels at once, each with its own separate row object (see
// getCycleRows) - without this, cycling the poster/banner in one place
// would only change that one card, leaving the others showing the old
// image until the next full refresh. computeImages always populates both
// posterPaths and backdropPaths on every row regardless of that row's own
// display mode, so the same index/url is valid to apply everywhere.
function syncImageAcrossCards(tmdbId, cfg, index, url) {
  if (tmdbId == null) return;
  for (const arr of [lastRows, lastRecentlyWatched, lastPlanToWatch, lastAiringPreview, airingRows]) {
    if (!arr) continue;
    for (const r of arr) {
      if (r && r.tmdbId === tmdbId) {
        r[cfg.indexKey] = index;
        r[cfg.urlKey] = url;
      }
    }
  }
}

// Black mark, gold text - square corners (no rx), flush at the card's
// bottom-left corner. Used everywhere the IMDb logo appears as its own
// chip (the corner badge shared by the top card and Airing Next) so it
// stays visually distinct against a gold background instead of
// disappearing into it.
const IMDB_LOGO_SVG_INVERTED = `<svg viewBox="0 0 64 32" width="34" height="17" xmlns="http://www.w3.org/2000/svg" aria-label="IMDb">
  <rect width="64" height="32" fill="#000000"/>
  <text x="32" y="23" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="18" fill="#F5C518">IMDb</text>
</svg>`;

function imdbButtonHtml(imdbId, rating) {
  if (!imdbId) return "";
  const url = `https://www.imdb.com/title/${imdbId}/`;
  const ratingHtml = (typeof rating === "number" && !isNaN(rating))
    ? `<span class="imdb-rating">${rating.toFixed(1)}</span>`
    : "";
  return `<button class="imdb-btn" title="Open on IMDb"
              onclick="event.stopPropagation(); window.open('${url}', '_blank')">${IMDB_LOGO_SVG_INVERTED}${ratingHtml}</button>`;
}

// Plain (non-link) IMDb pill used inline in the My List card scrim and the
// Plan to Watch list rows - visually distinct from imdbButtonHtml's floating
// corner button (still used by Airing Next).
function imdbPillHtml(rating, imdbId) {
  const text = (typeof rating === "number" && !isNaN(rating)) ? rating.toFixed(1) : "N/A";
  const inner = `<span class="imdb-pill">IMDb</span><span class="imdb-pill-rating">${text}</span>`;
  if (!imdbId) return inner;
  const url = `https://www.imdb.com/title/${imdbId}/`;
  return `<button class="imdb-pill-btn" title="Open on IMDb" onclick="event.stopPropagation(); window.open('${url}', '_blank')">${inner}</button>`;
}

const CLOCK_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
// Solid/filled variant of the clock, used only for the RECENTLY WATCHED
// panel header (bold-underline style) - CLOCK_ICON_SVG above stays outline
// since it's also reused for the top card's inline "time left" icon, which
// wasn't part of this redesign. The "hands" are cut out using the card
// background color rather than a real transparent hole.
const CLOCK_ICON_SOLID_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="9" fill="var(--gold)"></circle><rect x="11.2" y="6" width="1.6" height="6.5" rx="0.8" fill="var(--card)"></rect><rect x="11.6" y="11.3" width="4.2" height="1.6" rx="0.8" fill="var(--card)" transform="rotate(35 12 12)"></rect></svg>`;
// Same gold-circle-with-cutout language as the clock above, used only for
// the "Episodes Left" modal header - a list reads as "what's inside" more
// directly than a clock does.
const LIST_ICON_SOLID_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="9" fill="var(--gold)"></circle><rect x="6.5" y="8.2" width="1.8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="9.5" y="8.2" width="8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="6.5" y="11.1" width="1.8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="9.5" y="11.1" width="8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="6.5" y="14" width="1.8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="9.5" y="14" width="8" height="1.8" rx="0.4" fill="var(--card)"></rect></svg>`;
// Same gold-circle-with-cutout language again, used only for the Cast
// modal header - a head-and-shoulders silhouette.
const CAST_ICON_SOLID_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="9" fill="var(--gold)"></circle><circle cx="12" cy="9.3" r="2.6" fill="var(--card)"></circle><path d="M6.3 17.2c0-3.1 2.6-4.4 5.7-4.4s5.7 1.3 5.7 4.4" fill="var(--card)"></path></svg>`;
const GRID_ICON_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="var(--accent2)"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>`;
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const BOOKMARK_ICON_SVG = `<svg viewBox="0 0 24 24" width="17" height="17" fill="var(--gold)"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.5.5 0 0 1-.77.42L12 16.5l-5.73 4.12a.5.5 0 0 1-.77-.42V4a.5.5 0 0 1 .5-.5z"></path></svg>`;
const CALENDAR_ICON_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><rect x="3" y="5" width="18" height="16" rx="2" fill="var(--accent2)"></rect><rect x="3" y="9" width="18" height="1.8" fill="var(--card)"></rect><rect x="7" y="2.5" width="1.8" height="4" rx="0.9" fill="var(--card)"></rect><rect x="15.2" y="2.5" width="1.8" height="4" rx="0.9" fill="var(--card)"></rect></svg>`;
const CAROUSEL_ARROW_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
const CAROUSEL_ARROW_LEFT_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;

function cardImageBits(row, mode, arrIdx, extraOverlayHtml) {
  const cfg = IMAGE_MODE_CONFIG[mode];
  // Banners fall back to the poster if a show has no backdrop; logos have
  // no sensible fallback (different shape/purpose) - just show the
  // placeholder letter if there's no logo.
  const imageUrl = mode === "banner" ? (row.bannerUrl || row.posterUrl) : row[cfg.urlKey];
  const posterClass = "poster" + cfg.extraClass;
  const posterHtml = imageUrl
    ? `<img class="${posterClass}" src="${imageUrl}" alt="${row.title}">`
    : `<div class="${posterClass} placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
  const altCount = (row[cfg.pathsKey] || []).length;
  const cycleable = altCount > 1;
  const cycleAttrs = cycleable
    ? ` data-cycle-key="main-${arrIdx}" title="Click right half for next image, left half for previous" onclick="cycleImageWithFlip('main', ${arrIdx}, this, '${mode}', event)"`
    : "";
  // Network logo sits in the corner when known - the dark scrim keeps
  // colorful logos from blending into bright poster art underneath. Falls
  // back to "#N" live if the logo image itself 404s (data exists, just
  // failed to load); leaves the corner empty when there's no known network
  // at all, rather than showing a ranking number as a stand-in.
  const badgeHtml = row.networkLogoPath
    ? `<div class="badge network-badge" data-idx="${row.index}">
        <img class="network-badge-logo" src="${row.networkLogoPath}" alt="${row.network || ""}"
          onerror="this.parentElement.classList.add('logo-failed')">
      </div>`
    : "";
  const wrapHtml = `<div class="poster-wrap${cycleable ? " cycleable" : ""}"${cycleAttrs}>${badgeHtml}${posterHtml}${extraOverlayHtml || ""}</div>`;
  return { wrapHtml };
}

// Shared by the top carousel card and the three bottom-panel thumbnails -
// source identifies which cached row array to cycle (see getCycleRows),
// idx is that show's position within it.
function cycleImageWithFlip(source, idx, wrapEl, modeOverride, evt) {
  const rows = getCycleRows(source);
  const row = rows && rows[idx];
  if (!row) return;
  const cfg = IMAGE_MODE_CONFIG[modeOverride || getImageMode()];
  const paths = row[cfg.pathsKey];
  if (!paths || paths.length <= 1) return; // nothing else to switch to

  // Right half of the poster advances to the next image, left half goes
  // back - falls back to "next" when there's no click position to read.
  const rect = wrapEl.getBoundingClientRect();
  const clickX = evt ? evt.clientX - rect.left : rect.width;
  const direction = clickX < rect.width / 2 ? -1 : 1;
  const outClass = direction < 0 ? "flip-out-rev" : "flip-out";
  const inClass = direction < 0 ? "flip-in-rev" : "flip-in";

  const finishCycle = () => {
    cycleImage(source, idx, modeOverride, direction);
    requestAnimationFrame(() => {
      const newWrap = document.querySelector(`[data-cycle-key="${source}-${idx}"]`);
      const newImg = newWrap && newWrap.querySelector(".poster, .list-thumb");
      if (newImg) newImg.classList.add(inClass);
    });
  };

  const img = wrapEl.querySelector(".poster, .list-thumb");
  if (img) {
    img.classList.add(outClass);
    setTimeout(finishCycle, 160);
  } else {
    finishCycle();
  }
}

// Computes the click-to-cycle wrapper attributes for a bottom-panel
// thumbnail (Recently Watched / Plan to Watch / Airing Next), matching the
// same convention cardImageBits uses for the top carousel card.
//
// These thumbnails always show the banner if the show has one (falling
// back to the poster) regardless of the sidebar's poster/banner toggle -
// so cycling has to target whichever of the two is actually on screen,
// not blindly follow getImageMode() (which governs the top carousel and
// may point at the other, unrelated image type).
function thumbCycleAttrs(row, source, idx) {
  const mode = row.bannerUrl ? "banner" : "poster";
  const cfg = IMAGE_MODE_CONFIG[mode];
  const altCount = (row[cfg.pathsKey] || []).length;
  if (altCount <= 1) return { cycleableClass: "", attrs: "" };
  return {
    cycleableClass: " cycleable",
    attrs: ` data-cycle-key="${source}-${idx}" title="Click right half for next image, left half for previous" onclick="cycleImageWithFlip('${source}', ${idx}, this, '${mode}', event)"`,
  };
}

// Network sub-line: shows the TMDB network logo image when available,
// falling back to the plain text name (both if the show has no logo_path,
// and live if the logo image itself fails to load).
function networkSubHtml(name, logoPath) {
  if (logoPath) {
    return `<div class="list-row-sub network-sub">
        <img class="network-logo" src="${logoPath}" alt="${name || ""}"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='inline'">
        <span class="network-name-fallback" style="display:none">${name || ""}</span>
      </div>`;
  }
  return name ? `<div class="list-row-sub">${name}</div>` : "";
}

function renderRecentlyWatchedHtml(list) {
  if (!list || !list.length) return "";
  const rowsHtml = list.map((ep, idx) => {
    const bannerSrc = ep.bannerUrl || ep.posterUrl;
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" src="${bannerSrc}" alt="${ep.title}">`
      : `<div class="list-thumb placeholder">${(ep.title[0] || "?").toUpperCase()}</div>`;
    const { cycleableClass, attrs } = thumbCycleAttrs(ep, "watched", idx);
    const episodeCode = `S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`;
    const episodeTitleHtml = ep.episodeTitle ? `<div class="episode-title">${ep.episodeTitle}</div>` : "";
    const badgeHtml = ep.badge ? `<div class="premiere-badge${ep.badge === "SEASON FINALE" ? " finale" : ""}">${ep.badge}</div>` : "";
    return `
      <div class="list-row">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}</div>
        <div class="list-row-title-wrap">
          <div class="list-row-title" title="View cast" onclick="event.stopPropagation(); openCastModal('watched', ${idx})">${ep.title}</div>
          ${networkSubHtml(ep.network, ep.networkLogoPath)}
          <div class="next-up-row">
            <div class="list-row-sub episode-code-sub">${episodeCode}</div>
            ${badgeHtml}
          </div>
          ${episodeTitleHtml}
        </div>
        <span class="list-check">${CHECK_ICON_SVG}</span>
      </div>`;
  }).join("\n");

  return `
    <div class="list-panel list-panel--watched">
      <div class="list-panel-header">${CLOCK_ICON_SOLID_SVG}<span>RECENTLY WATCHED</span></div>
      <div class="list-rows-scroll">${rowsHtml}</div>
    </div>`;
}

function renderPlanToWatchHtml(list) {
  if (!list || !list.length) return "";
  const rowsHtml = list.map((row, idx) => {
    const bannerSrc = row.bannerUrl || row.posterUrl;
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" src="${bannerSrc}" alt="${row.title}">`
      : `<div class="list-thumb placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
    const { cycleableClass, attrs } = thumbCycleAttrs(row, "plan", idx);
    const badgeHtml = row.airedLabel
      ? `<div class="premiere-badge${row.ended ? " finale" : ""}">${row.airedLabel}</div>`
      : "";
    const yearBadgeHtml = row.yearRangeLabel
      ? `<div class="premiere-badge year-badge">${row.yearRangeLabel}</div>`
      : "";
    return `
      <div class="list-row">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}</div>
        <div class="list-row-title-wrap">
          <div class="title-with-year">
            <div class="list-row-title" title="View cast" onclick="event.stopPropagation(); openCastModal('plan', ${idx})">${row.title}</div>
            ${yearBadgeHtml}
          </div>
          ${networkSubHtml(row.network, row.networkLogoPath)}
          ${badgeHtml}
          <div class="list-imdb">${imdbPillHtml(row.imdbRating, row.imdbId)}</div>
        </div>
        <button class="card-menu-btn" title="Manage" onclick="event.stopPropagation(); openPlanCardMenu(${idx}, this)">&#8942;</button>
      </div>`;
  }).join("\n");

  return `
    <div class="list-panel list-panel--plan">
      <div class="list-panel-header">${BOOKMARK_ICON_SVG}<span>PLAN TO WATCH</span></div>
      <div class="list-rows-scroll">${rowsHtml}</div>
    </div>`;
}

function renderAiringNextPreviewHtml(list) {
  if (!list || !list.length) return "";
  const rowsHtml = list.map((row, idx) => {
    const bannerSrc = row.bannerUrl || row.posterUrl;
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" src="${bannerSrc}" alt="${row.title}">`
      : `<div class="list-thumb placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
    const { cycleableClass, attrs } = thumbCycleAttrs(row, "airing", idx);
    const episodeTitle = row.nextEpisodeTitle ? `<div class="episode-title">${row.nextEpisodeTitle}</div>` : "";
    const badgeHtml = row.badge
      ? `<div class="premiere-badge${row.badge === "SEASON FINALE" ? " finale" : ""}">${row.badge}</div>`
      : "";
    return `
      <div class="list-row">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}</div>
        <div class="list-row-title-wrap">
          <div class="list-row-title" title="View cast" onclick="event.stopPropagation(); openCastModal('airing', ${idx})">${row.title}</div>
          ${networkSubHtml(row.network, row.networkLogoPath)}
          <div class="next-up-row">
            <span class="next-up">Next: ${row.nextLabel}</span>
            ${badgeHtml}
          </div>
          ${episodeTitle}
          <div class="list-row-airdate">&#128197; ${row.airDateLabel}</div>
        </div>
      </div>`;
  }).join("\n");

  return `
    <div class="list-panel list-panel--airing">
      <div class="list-panel-header">${CALENDAR_ICON_SVG}<span>AIRING NEXT</span></div>
      <div class="list-rows-scroll">${rowsHtml}</div>
    </div>`;
}

// Every panel whose scroll position needs to survive a full re-render -
// the carousel track plus the three bottom-panel row lists (each scrolls
// vertically on desktop, horizontally on mobile, so both axes are saved).
const SCROLLABLE_PANEL_SELECTORS = {
  watched: ".list-panel--watched .list-rows-scroll",
  plan: ".list-panel--plan .list-rows-scroll",
  airing: ".list-panel--airing .list-rows-scroll",
};

function capturePanelScrollPositions() {
  const positions = {};
  for (const [key, selector] of Object.entries(SCROLLABLE_PANEL_SELECTORS)) {
    const el = document.querySelector(selector);
    positions[key] = el ? { top: el.scrollTop, left: el.scrollLeft } : null;
  }
  return positions;
}

function restorePanelScrollPositions(positions) {
  for (const [key, selector] of Object.entries(SCROLLABLE_PANEL_SELECTORS)) {
    const pos = positions[key];
    if (!pos || (pos.top === 0 && pos.left === 0)) continue;
    const el = document.querySelector(selector);
    if (!el) continue;
    el.scrollTop = pos.top;
    el.scrollLeft = pos.left;
  }
}

function renderRows(rows, totalRemainingEps, totalRemainingMinutes, recentlyWatched, planToWatch, airingPreview) {
  const prevTrack = document.getElementById("myListCarouselTrack");
  const prevCarouselScrollLeft = prevTrack ? prevTrack.scrollLeft : 0;
  const prevPanelScrollPositions = capturePanelScrollPositions();
  lastRows = rows;
  lastTotalEps = totalRemainingEps;
  lastTotalMinutes = totalRemainingMinutes;
  if (recentlyWatched !== undefined) lastRecentlyWatched = recentlyWatched;
  if (planToWatch !== undefined) lastPlanToWatch = planToWatch;
  if (airingPreview !== undefined) lastAiringPreview = airingPreview;
  currentView = "list";
  localStorage.setItem(LS_VIEW_MODE, "list");
  updateViewModeButton();

  const bottomPanelsHtml = [
    renderRecentlyWatchedHtml(lastRecentlyWatched),
    renderAiringNextPreviewHtml(lastAiringPreview),
    renderPlanToWatchHtml(lastPlanToWatch),
  ].filter(Boolean).join("");
  const bottomPanelsWrapped = bottomPanelsHtml
    ? `<div class="bottom-panels-row">${bottomPanelsHtml}</div>`
    : "";

  if (!rows.length) {
    app.innerHTML = `<div class="center-box"><h2>My List is empty</h2>
      <p style="color:var(--muted)">No shows with a new episode to watch right now.</p></div>
      ${bottomPanelsWrapped}`;
    subtitle.textContent = "Nothing to watch right now";
    return;
  }

  const mode = getImageMode();
  const isWide = mode === "banner";
  const [totalHours, totalMins] = formatTime(totalRemainingMinutes);
  // Carousel arrows sit centered on the poster/banner image itself, not the
  // whole card (which also has the info panel below it) - compute that
  // image's height from the known card width + aspect ratio for the
  // current mode, matching .card.carousel-card / .poster's CSS exactly.
  const carouselCardWidth = isWide ? 320 : 225;
  const carouselImageHeight = isWide ? (carouselCardWidth * 9 / 16) : (carouselCardWidth * 3 / 2);
  const carouselArrowTop = Math.round(carouselImageHeight / 2);

  const cards = rows.map((row, arrIdx) => {
    const timeText = row.remaining > 1
      ? `${row.nextHours}h ${row.nextMins}m / ${row.hours}h ${row.mins}m left`
      : `${row.hours}h ${row.mins}m left`;
    // Always reserved as its own line (blank when there's no title), so a
    // card without one doesn't collapse and throw off the progress bar's
    // position relative to sibling cards in the same row - see .card-fill-spacer.
    const episodeTitle = `<div class="episode-title">${row.episodeTitle || "&nbsp;"}</div>`;
    const progressPct = row.available > 0 ? Math.min(100, Math.round((row.watched / row.available) * 100)) : 0;
    const progressHtml = row.available > 0
      ? `<div class="watch-progress">
          <div class="watch-progress-track">
            <div class="watch-progress-fill" style="width:${progressPct}%"></div>
            <div class="watch-progress-text">${row.watched}/${row.available}</div>
          </div>
        </div>`
      : "";
    const remainingText = row.remaining === 1 ? "1 episode left" : `${row.remaining} episodes left`;
    const overlayHtml = imdbButtonHtml(row.imdbId, row.imdbRating) + `<div class="remaining-badge">${remainingText}</div>`;
    const { wrapHtml } = cardImageBits(row, mode, arrIdx, overlayHtml);

    return `
      <div class="card carousel-card${isWide ? " banner-mode" : ""}">
        ${wrapHtml}
        <div class="card-body">
          <div class="card-title-row">
            <h3 title="View cast" onclick="event.stopPropagation(); openCastModal('main', ${arrIdx})">${row.title}</h3>
            <button class="card-menu-btn" title="Manage" onclick="event.stopPropagation(); openCardMenu(${arrIdx}, this)">&#8942;</button>
          </div>
          <div class="next-up-row">
            <span class="next-up">Next: ${row.nextLabel}</span>
            ${row.badge ? `<div class="premiere-badge${row.badge === "SEASON FINALE" ? " finale" : ""}">${row.badge}</div>` : ""}
          </div>
          ${episodeTitle}
          <div class="card-fill-spacer">
            ${progressHtml}
          </div>
          <div class="time-left" title="See every remaining episode" onclick="event.stopPropagation(); openEpisodesModal(${arrIdx})"><span class="time-icon">${CLOCK_ICON_SVG}</span>${timeText}</div>
        </div>
      </div>`;
  }).join("\n");

  app.innerHTML = `
    <div class="series-panel">
      <div class="series-panel-header">
        <div class="series-panel-header-left">
          ${GRID_ICON_SVG}
          <div class="series-panel-stat"><span class="num">${rows.length}</span><span class="label">Series</span></div>
          <div class="stats-divider"></div>
          <div class="series-panel-stat"><span class="num">${totalRemainingEps}</span><span class="label">Episodes Left</span></div>
          <div class="stats-divider"></div>
          <div class="series-panel-stat"><span class="num">${totalHours}h ${totalMins}m</span><span class="label">Watch Time Left</span></div>
        </div>
        <span class="series-panel-updated">Updated ${new Date().toLocaleString()}</span>
      </div>
      <div class="carousel-wrap">
        <button class="carousel-arrow left" title="Scroll left" style="top:${carouselArrowTop}px"
          onclick="document.getElementById('myListCarouselTrack').scrollBy({left:-420,behavior:'smooth'})">${CAROUSEL_ARROW_LEFT_ICON_SVG}</button>
        <div class="carousel-track" id="myListCarouselTrack">${cards}<div class="carousel-watermark"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="15" rx="3.5" fill="none" stroke="var(--accent)" stroke-width="1.8"/><polygon points="10,7.8 10,13.2 14.6,10.5" fill="var(--accent)"/><line x1="9" y1="21" x2="15" y2="21" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/></svg></div></div>
        <button class="carousel-arrow" title="Scroll right" style="top:${carouselArrowTop}px"
          onclick="document.getElementById('myListCarouselTrack').scrollBy({left:420,behavior:'smooth'})">${CAROUSEL_ARROW_ICON_SVG}</button>
      </div>
    </div>
    ${bottomPanelsWrapped}
  `;
  subtitle.textContent = "";
  updateImageModeButton();
  if (prevCarouselScrollLeft > 0) {
    const newTrack = document.getElementById("myListCarouselTrack");
    if (newTrack) {
      newTrack.style.scrollBehavior = "auto";
      newTrack.scrollLeft = prevCarouselScrollLeft;
    }
  }
  restorePanelScrollPositions(prevPanelScrollPositions);
  updateCarouselArrows();
  wireHoverStabilization();
}

// Debounces hover state for cards/rows whose visual hover effects (the
// poster/thumb lift, .card's background) are driven by a JS-managed class
// instead of native :hover - see the .hover-stable rules in CSS for why:
// native :hover on these elements is prone to rapid on/off toggling from
// things like the carousel arrow overlapping part of a card. The class is
// added the instant the pointer enters, but only removed after a short
// delay with no further mouseenter - any brief interruption (grazing an
// overlapping element) resolves before the delay elapses and the removal
// never fires, while genuinely leaving still un-hovers smoothly.
function wireHoverStabilization() {
  const HOVER_EXIT_DELAY_MS = 150;
  document.querySelectorAll(".card, .list-row").forEach(el => {
    el.addEventListener("mouseenter", () => {
      if (el._hoverLeaveTimer) {
        clearTimeout(el._hoverLeaveTimer);
        el._hoverLeaveTimer = null;
      }
      el.classList.add("hover-stable");
    });
    el.addEventListener("mouseleave", () => {
      el._hoverLeaveTimer = setTimeout(() => {
        el.classList.remove("hover-stable");
        el._hoverLeaveTimer = null;
      }, HOVER_EXIT_DELAY_MS);
    });
  });
}

function updateCarouselArrows() {
  const track = document.getElementById("myListCarouselTrack");
  const wrap = track && track.closest(".carousel-wrap");
  if (!track || !wrap) return;
  const leftArrow = wrap.querySelector(".carousel-arrow.left");
  const rightArrow = wrap.querySelector(".carousel-arrow:not(.left)");
  const refresh = () => {
    const maxScroll = track.scrollWidth - track.clientWidth;
    const noScrollNeeded = maxScroll <= 1;
    if (leftArrow) leftArrow.classList.toggle("is-hidden", noScrollNeeded || track.scrollLeft <= 1);
    if (rightArrow) rightArrow.classList.toggle("is-hidden", noScrollNeeded || track.scrollLeft >= maxScroll - 1);
  };
  refresh();
  track.addEventListener("scroll", refresh);
}

function renderAiringRows(rows) {
  currentView = "airing";
  localStorage.setItem(LS_VIEW_MODE, "airing");
  updateViewModeButton();

  if (!rows.length) {
    app.innerHTML = `<div class="center-box"><h2>Nothing airing soon</h2>
      <p style="color:var(--muted)">No upcoming episodes found across your SIMKL lists.</p></div>`;
    subtitle.textContent = "Nothing airing soon";
    return;
  }

  const mode = getImageMode();
  const isWide = mode === "banner";

  const cards = rows.map((row, arrIdx) => {
    const { wrapHtml } = cardImageBits(row, mode, arrIdx, imdbButtonHtml(row.imdbId, row.imdbRating));
    return `
      <div class="card">
        ${wrapHtml}
        <div class="card-body">
          <h3 title="View cast" onclick="event.stopPropagation(); openCastModal('main', ${arrIdx})">${row.title}</h3>
          <div class="next-up">Next: ${row.nextLabel}</div>
          ${row.nextEpisodeTitle ? `<div class="episode-title">${row.nextEpisodeTitle}</div>` : ""}
          <div class="air-date">&#128197; ${row.airDateLabel}</div>
        </div>
      </div>`;
  }).join("\n");

  app.innerHTML = `
    <p class="section-note" style="font-weight:700;">${rows.length} shows have new episodes or premieres coming up.</p>
    <div class="grid${isWide ? " banner-mode" : ""}">${cards}</div>
  `;
  subtitle.textContent = "Updated " + new Date().toLocaleString();
  updateImageModeButton();
  wireHoverStabilization();
}

function showError(err) {
  app.innerHTML = `
    <div class="center-box">
      <h2>Something went wrong</h2>
      <div class="error-box">${(err && err.message) || err}</div>
      <p style="color:var(--muted);font-size:0.8rem;margin-top:14px">
        If this mentions CORS/network errors reaching api.simkl.com, your
        browser may be blocking direct requests to SIMKL from this page -
        in that case you'll need the local-server version instead.
      </p>
    </div>
  `;
  subtitle.textContent = "Error";
}

let toastTimer = null;
function showToast(message, isError) {
  const el = document.getElementById("toast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.classList.toggle("error", !!isError);
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  const { clientId, tmdbKey } = getConfig();
  if (!clientId || !tmdbKey) {
    showSettings(main);
    return;
  }

  app.innerHTML = `<div class="spinner" style="margin-top:80px"></div>`;
  subtitle.textContent = "Fetching your My List\u2026";

  try {
    const token = await getAccessToken();
    simklToken = token;
    sharedCache = new TmdbCache();
    sharedEpisodeCache = new SimklEpisodeCache();
    sharedRatingsCache = new SimklShowCache();
    app.innerHTML = `<div class="spinner" style="margin-top:80px"></div>`;
    subtitle.textContent = "Fetching your My List\u2026";
    const [[rows, totalEps, totalMinutes, recentlyWatched], planToWatchRows, airingNextRows] = await Promise.all([
      getMyListRows(token, sharedCache, sharedEpisodeCache, sharedRatingsCache),
      getPlanToWatchRows(token, sharedCache, sharedRatingsCache),
      getAiringNextRows(token, sharedCache, sharedEpisodeCache, sharedRatingsCache),
    ]);
    airingRows = airingNextRows; // also primes the separate Airing Next tab's cache, so opening it doesn't re-fetch
    renderRows(rows, totalEps, totalMinutes, recentlyWatched, planToWatchRows, airingNextRows);
  } catch (err) {
    showError(err);
  }
}

function updateTopbarClock() {
  const now = new Date();
  const timeEl = document.getElementById("topbarClockText");
  if (timeEl) timeEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const dateEl = document.getElementById("topbarDateText");
  if (dateEl) dateEl.textContent = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
updateTopbarClock();
setInterval(updateTopbarClock, 1000);

document.getElementById("settingsBtn").onclick = () => showSettings(main);
document.getElementById("addShowBtn").onclick = openSearchModal;
document.getElementById("imageModeBtn").onclick = () => {
  const current = getImageMode();
  localStorage.setItem(LS_IMAGE_MODE, nextImageMode(current));
  if (currentView === "airing" && airingRows) {
    renderAiringRows(airingRows); // instant, no re-fetch
  } else if (lastRows) {
    renderRows(lastRows, lastTotalEps, lastTotalMinutes); // instant, no re-fetch
  } else {
    updateImageModeButton();
  }
};
updateImageModeButton();
updateViewModeButton();
updatePageTitle();
applyStoredTheme();

(function enableCarouselDragScroll() {
  let dragTrack = null;
  let startX = 0;
  let startScrollLeft = 0;
  let dragged = false;

  app.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const track = e.target.closest("#myListCarouselTrack");
    if (!track) return;
    dragTrack = track;
    dragged = false;
    startX = e.pageX;
    startScrollLeft = track.scrollLeft;
    track.classList.add("dragging");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragTrack) return;
    const dx = e.pageX - startX;
    if (Math.abs(dx) > 4) dragged = true;
    dragTrack.scrollLeft = startScrollLeft - dx;
  });

  document.addEventListener("mouseup", () => {
    if (!dragTrack) return;
    dragTrack.classList.remove("dragging");
    dragTrack = null;
  });

  app.addEventListener("click", (e) => {
    if (dragged && e.target.closest("#myListCarouselTrack")) {
      e.stopPropagation();
      e.preventDefault();
    }
    dragged = false;
  }, true);
})();

main();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Browsers only auto-recheck a registered service worker's script for
    // changes at most once every 24h - fine for a site that rarely
    // changes, but far too slow here given how often this app gets
    // updated. updateViaCache:"none" stops the browser's own HTTP cache
    // from ever answering that check, and calling update() explicitly -
    // on load, and again whenever the app comes back to the foreground
    // (it may sit open for a long stretch on a TV without a fresh
    // navigation) - makes the check actually happen instead of waiting
    // on the browser's own lazy schedule.
    navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" }).then(reg => {
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
