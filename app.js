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
  { names: ["כאן", "כאן 11", "Kan", "Kan 11"], logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFEAAAAkCAYAAADxYNZEAAAKz0lEQVR4AexZB2yUyRV+b73rCr5QLAEBocCBIbTAJWeKuNCLUCihHqEjAaGdMUainEBCNFEEHEGCSAgEogkwRxPGGDggAg5z9GYTHA4MnLAowRivy+7kfWP/9u/d/1/DYTtHlNXOTnvz5s03r8zMOuh/4JOdnV3nv7mMCgXRnf3iTx+yuPycl53eZXxERMQTX7pMpar6tpnrSmVWVUXgg9btft3Y3P8+5QoDEUKFRlQ/9D7C+NI6Q4PT1M9cXBRzli8/c505KouLwAdtaGhkmrn/fcoVBqKvUDu2b1OxsbHq66/nq69i49TBQ0fUuwjKH7C4d+FfHjQVBqKvcAcOHKA1a9bQ0qWLad26dXTq1ClfklJ1BVN+W6qpuAJTLK6UUcgUsy2DRHe/D089wPRTaSCSI1imdVCViDByUAEFlTEzh1X7zjA3GVjqC1M0N8CnmesoP3/+agLyKDFb5GUlX55l0Zv7bZeSlfWy0+UrF9WJ09+pcymXA5qe+7W78ZUrP6gz/zitvk+5qGl9d5aZ9by5ubnk8Shi8up6drayjKynkxNVwu7tas+ePWr3vm/V3fuPlB5g8QOfhubs14WB7Nq1a6p9+5iNR48e1WMyMzMtg0x6errasWOH2rt3r9q/f7+eSyxGnT9/XqWmpuqx4FtWsgUx+cTxUzExn1PXTp0ofuZMPz7ZRZENHUcPHUlt3foz+uKLP1J83Aw0ke/O5rrfUnCwk/ILCgjSOV0hmi4igv0iKzr+OmUyDRz6Fxo2fCgNHTaYUr6/iOaAKSKy+qG7t++o7t27U+q9VOr/5wGUlHhcRUVFWQaZpKREGjN2PA0a/CUNGDCAhgwZTP3796d27dpRTEwMdezYUW3ZsgXiBpzXEsQ7d+6ouBlficbIWFEg9vrzMY4V6Tfvq1nx8UJI5AwJordvrR2ZyxVEeXl55HIVgoeyHmTzk+8hcjhJ6F1EBR5yOPwJcQIwt164cFF17dqVXrx4QUFBTsp1u6lnr+6UnHTcfwEyEC4lLzefglzBFBoaTiEhwXq+4OBgevXqFV24cIHGjBlDbdu2VVeuXLHkIWzEPeG3KCUkJKg58+aqjh070NOMp+SAxTFRnsddRFGSHUo8qKbHzVCf/SGGMp7+JAK4qCDXQyFh4SVE5pIjiEh4QXDJiNlWJsLH5Qwhh3KSt4DJ6XTRW9FktJuT+QRw7nyKGjV6ND15+oSChd6TL5TKQbVrR1FklVCp+H8dWgSmIJeT3AJ4rjtPbzQ2OCwsjPLz8zWoAHPIkCF05swZPYJ8Pg5zHYRLlywhMVVhQGJ+0u0VEEWDzHQPf7yvQPu3b74hJUjnS6BgDiKSKQrEXM20Rjk/T1RL/CL6JTOabXMvMSnFelEej4fCQoNtaX8Qnz1q1AhKS00VwB0iOxAk+rRRIxK/SJ+374h98xsfGfkrqlW3DtWtW5caNW5MzZs1p+joaKpatapYoUe030Fer1dwCKZ79+7RaNmkR48ePfFlJCiVNGGBhUDIEoKYcnK9hHpklSolRFIqkMAQHhJOyuOlf2e/khDhIWMsC5BC4vd1OWUquAUBW2eS+xGZGqCpBd58WYCTlLeARCVNvSXF2zdvqd59etG/0v8piyaCbPmeAmrY8Df07f591Op3v7cEEBwGfzmcf8r4kdNTb/G9tLt849ZNloDC6enp8Rs3bhQeDTWIHtlEZqaHDx/S9OnTa2OsOcnKSqpJSUl07NgxOnjwIEU3+S3wE8EclJvjLiGSUoMGn/KuHbspMTGRkk8cp8bRjaS1Yr9Wm4Mo3L1nD3r27Fmx5oSEhGjNSkjYS82bN7cFMJC0EohWjR07ls+dOxcv/lDzDg0N1Tk0+/jx0j62FIg9evTgnj17cu/evTkyMpKYWYOolL96SQTUtOLINa3WRKr4z+vXhXfc27dvq379+tHjx4+133I6nQQZqlevTkeOHKFWrVr9LADNKwCYW7du1ZuSk5ND8JNu8Z1QHjNdKRDNHcysQYRgDqvQaCIOChJ/KHUjl2KFfWVz065evaqj8IMHDySghWgNgZyNxAcePny4XAA0FiA8edCgQboKZQIWycnJum782IIIYgwCIcrI7RKiGQCE77CjKa/2kydPqj59+tDz58+1leDwDjkbS2BISEigNm3acHnNZfARC9VzQQu9EmjS0kq/VdiCiJ2FcPAFCPUGQ6sctMzlLrvVVHT9+nVtwpANC4IZIzVr1oxatGhRIUJUkcCKucLDw7V1+uJhC6KhfdhpMLBcUVEjJjHoi5oqLIuNjeVVq1bpYwzmxQZiUQiIw4YN83fe5SAJ/C7YGBeJTz75BMfA4uuqLYgul0urMHYc5yYwsUtgDpO26y/PdjnD1pk5cyavXr2a3rx5o1njhgEZ9u3bRyNHjix3IBGRmVn7X0wI12Hc2FB34McqYYcNDYQ2WtEYbaCDTzTqVjlo3kdbsSnYSIMXc6GlGsLPmDGDFy5caHQT5ofM27ZtIzmelBuQJ06cULt27SIoExImhE9GbiRbEEHAXCg4yoESfJIRVIyJfOkBIID0bbergxZminGgMfijbKT58+dr0wbgRj/81ubNm8tFIy9duqRwS4EczIW3JxxzBg4caIig84Ag2gGiR5p+oDEAEgtG2dRVXHxXXsYAw4UATAQ3aJnRZ85h2suWLdOuB9oIs4YM0Mjx48cH1Ei4BhyX8Lhw8+ZNhbPn3bt3lRxh1OTJk1WXLl0oIyNDayF4gr/4ZGratGkp7bIFEQMMYc1lo82cY6ewSCzY3G4uA0SAbG4LVIYLwbzgiaMFNMCKHkDMnj2bl8idH7SggzzY1E2bNpFoki2QAvTjDh066Kcvefai1q1bU8uWLalbt260YcMG/SIFPrgFQdvbyROZzBXtK4ctiFg0cynAfcda1rOysizbmVnvqGWnRSMAgYliAQATm2RBRoaPlMXxggULCDcL0GEsxuHGESjYyCbom87Lly8JGwewmFnfgjAn+KBdbma0c+fOpzjsg7852YIIIgBpzlG2SoiOaIem1axZE0W/hD6Dn1+nRYPBk5mLbyQWZKWaBEResWKFDjIAEBuAOaFhpQiLKsYcoEUTcyF4GAPwMB6aOHHiRNq+ffvOevXqFR9rQG8kWxAnTJggfyotpcWLFxPKxgD/nEj8ByFSLlq0iEaMGGFFol9DLDtsGuEHsQhoJEhwNkNul+QGo/9TmTVrFq9du1ZrF/zj+vXrKS4uztKkoLUACalatWr6CIM5RbtxcNfrljdEkhcdrlWr1nC7uW1BFBPgOXPm8Lx581hedy2FMJiOGjWKESnnzp3L48aNs6SFaRg7bowLlOMKd+PGDRKnT+LsSczJzxeZx9eoUePvRn3q1Km8cuVK7demTJliKQ9oZY3REkzo8uXLdPbsWUI5JSUFr0K/lnlZ/pVk8YO248EDyRZEdJZnAoDQKsOEsPuB+NevX5/lUMvR0dHcpEkTvBSVvrAGGix98fHxPGnSpIAAwL8Zc+DZrEGDBtxUIq9o4hNh8c7fSgPRkMi4ZcDvGG0fe15pIEILARyOIACNOaCSgOSjSZUGIqIzcwlwODZ8NCiVIWilgQgfaPhFlKGVZcj20XRXGoi9evWiadOm4bihU+fOnT8akMoStNJAxDFJnq9wPePly5dz3759S2y7LCl/4f2VBuIvHIcPEu//IH4QfIWD/wMAAP//MsWTUAAAAAZJREFUAwCwk56FJlXzZgAAAABJRU5ErkJggg==" },
  { names: ["HOT", "הוט"], logo: "data:image/png;base64,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" },
  // Cropped from a real Keshet 12 brand mark supplied by the user (12.jpg) - TMDB/SIMKL have no logo for this network either, same gap as the three above.
  { names: ["קשת", "קשת 12", "Keshet", "Keshet 12"], logo: "data:image/png;base64,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" },
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
// AUTH V2 (see the "SIMKL auth" section): its own client id, plus one JSON
// blob {access, refresh, expiresAt, refreshExpiresAt} instead of a single
// never-expiring token string. While a V2 client id is set it takes over
// from the V1 PIN flow above; V1 stops working around April 2027.
const LS_CLIENT_ID_V2 = "simkl_client_id_v2";
const LS_MDBLIST_KEY = "mdblist_api_key"; // optional: Rotten Tomatoes + Trakt ratings
const LS_FANART_KEY = "fanart_api_key";   // optional: extra posters/banners in the image picker
const LS_AUTH_V2 = "simkl_auth_v2";
const LS_IMAGE_MODE = "simkl_image_mode"; // "poster" | "banner"
const LS_THEME = "simkl_theme"; // "light" | "dark"
const LS_VIEW_MODE = "simkl_view_mode";   // "list" or "airing" (not restored on load - always starts on "list")

// A plain localStorage.setItem() throws QuotaExceededError once the
// origin's whole quota is full - which used to be able to abort renderRows
// itself (it persists the current view mode partway through), and
// separately made cycling a poster/banner silently stop doing anything
// visible (see saveImageOverride). None of these are anything more than
// a remembered preference/snapshot - losing one write is harmless, so it
// should never be allowed to break whatever the caller was actually doing.
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Quota full: the persisted API cache is what fills it, and it's only a
    // speed-up, so make room by dropping its oldest entries and try again -
    // a setting or token must not be lost to make way for cached lookups.
    // (If storage is unavailable altogether, this just fails quietly.)
    dropOldCacheUntil(() => localStorage.setItem(key, value));
  }
}

// Removes persisted API-cache entries oldest-first, retrying `write` after
// each one, until it goes through. Returns whether it did.
function dropOldCacheUntil(write) {
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(API_CACHE_PREFIX)) continue;
      let age = 0;
      try { age = JSON.parse(localStorage.getItem(k)).t || 0; } catch (e) { /* corrupt: treat as oldest */ }
      entries.push([age, k]);
    }
    entries.sort((a, b) => a[0] - b[0]);
    for (const [, k] of entries) {
      localStorage.removeItem(k);
      try { write(); return true; } catch (e) { /* still full - drop the next one */ }
    }
  } catch (e) {
    // localStorage unavailable
  }
  return false;
}

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
    clientIdV2: localStorage.getItem(LS_CLIENT_ID_V2) || "",
    mdblistKey: localStorage.getItem(LS_MDBLIST_KEY) || "",
    fanartKey: localStorage.getItem(LS_FANART_KEY) || "",
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
      <label>SIMKL Client ID &mdash; AUTH V2 (recommended)
        (<a href="https://simkl.com/settings/developer/new/" target="_blank">create an app</a>,
        type &ldquo;TV, devices &amp; command line&rdquo;)</label>
      <input type="text" id="clientIdV2Input" value="${cfg.clientIdV2}">
      <label>SIMKL Client ID &mdash; old AUTH V1 (stops working around April 2027)</label>
      <input type="text" id="clientIdInput" value="${cfg.clientId}">
      <label>TMDB API Key
        (<a href="https://www.themoviedb.org/settings/api" target="_blank">get a free key</a>)</label>
      <input type="text" id="tmdbKeyInput" value="${cfg.tmdbKey}">
      <label>MDBList API Key &mdash; optional, adds Rotten Tomatoes and Trakt ratings
        (<a href="https://mdblist.com/preferences/" target="_blank">get a free key</a>)</label>
      <input type="text" id="mdblistKeyInput" value="${cfg.mdblistKey}">
      <label>Fanart.tv API Key &mdash; optional, adds more posters and banners to the image picker
        (<a href="https://fanart.tv/get-an-api-key/" target="_blank">get a free key</a>)</label>
      <input type="text" id="fanartKeyInput" value="${cfg.fanartKey}">
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
    const clientIdV2 = document.getElementById("clientIdV2Input").value.trim();
    const tmdbKey = document.getElementById("tmdbKeyInput").value.trim();
    const mdblistKey = document.getElementById("mdblistKeyInput").value.trim();
    const fanartKey = document.getElementById("fanartKeyInput").value.trim();
    if ((!clientId && !clientIdV2) || !tmdbKey) {
      document.getElementById("settingsError").textContent = "A SIMKL Client ID (V2 or V1) and the TMDB key are required.";
      return;
    }
    // A different V2 id means a different app registration, so any stored
    // V2 tokens belong to the old one and can't be reused.
    if (clientIdV2 !== cfg.clientIdV2) localStorage.removeItem(LS_AUTH_V2);
    safeSetItem(LS_CLIENT_ID, clientId);
    safeSetItem(LS_CLIENT_ID_V2, clientIdV2);
    safeSetItem(LS_TMDB_KEY, tmdbKey);
    safeSetItem(LS_MDBLIST_KEY, mdblistKey);
    safeSetItem(LS_FANART_KEY, fanartKey);
    fanartKeyRejected = false;
    if (mdblistKey !== cfg.mdblistKey) {
      mdblistCache.disabled = false;
      if (mdblistKey) {
        // safeSetItem swallows a full/blocked storage silently, so confirm the
        // key really landed, then confirm MDBList accepts it - otherwise a bad
        // key just looks like "nothing happened".
        if (localStorage.getItem(LS_MDBLIST_KEY) !== mdblistKey) {
          showToast("Couldn't store the MDBList key - this browser's storage is full or blocked.", true);
        } else {
          checkMdblistKey(mdblistKey);
        }
      }
    }
    if (afterSaveCallback) afterSaveCallback();
  };
  document.getElementById("themeToggleBtn").onclick = () => {
    const isLight = document.body.classList.toggle("light-theme");
    safeSetItem(LS_THEME, isLight ? "light" : "dark");
    updateThemeToggleButton();
  };
  updateThemeToggleButton();
  if (canCancel) {
    document.getElementById("settingsCloseBtn").onclick = returnToPreviousView;
  }
}

// ---------------------------------------------------------------------
// SIMKL auth (V2 device flow, or the older V1 PIN flow) + fetching
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

// Which sign-in is active: a V2 client id (set in Settings) switches the
// whole app over to AUTH V2; otherwise the old V1 PIN flow keeps working.
function authMode() {
  return getConfig().clientIdV2 ? "v2" : "v1";
}

function activeClientId() {
  const cfg = getConfig();
  return cfg.clientIdV2 || cfg.clientId;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- AUTH V2 token storage + refresh --------------------------------------
function readAuthV2() {
  try {
    const auth = JSON.parse(localStorage.getItem(LS_AUTH_V2) || "null");
    return auth && auth.access ? auth : null;
  } catch (e) {
    return null;
  }
}

// Stores a token-endpoint response. SIMKL access tokens last 7 days and
// refresh tokens 180 (renewed on every use); a refresh response that omits
// a new refresh token keeps the previous one.
function writeAuthV2(tok) {
  const now = Date.now();
  const prev = readAuthV2();
  const auth = {
    access: tok.access_token,
    refresh: tok.refresh_token || (prev && prev.refresh) || null,
    expiresAt: now + (tok.expires_in || 604800) * 1000,
    refreshExpiresAt: now + 180 * 24 * 60 * 60 * 1000,
  };
  safeSetItem(LS_AUTH_V2, JSON.stringify(auth));
  return auth;
}

// The OAuth endpoints answer with a JSON error body on 4xx (e.g.
// authorization_pending), so unlike simklGet this hands back the status and
// parsed body instead of throwing. Form-encoded is a "simple" CORS request,
// so it needs no preflight.
async function oauthPost(path, fields) {
  let res;
  try {
    res = await fetch(`${SIMKL_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
  } catch (e) {
    throw new Error("Network/CORS error reaching SIMKL: " + e.message);
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
  return { status: res.status, ok: res.ok, data };
}

// One refresh at a time: several requests can hit an expired token at once,
// and a rotating refresh token would be invalidated by the second attempt.
let refreshPromise = null;
function refreshV2Token() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const auth = readAuthV2();
      if (!auth || !auth.refresh || auth.refreshExpiresAt < Date.now()) {
        throw new Error("SIMKL session expired. Refresh the page to sign in again.");
      }
      const r = await oauthPost("/oauth2/token", {
        grant_type: "refresh_token", refresh_token: auth.refresh, client_id: activeClientId(),
      });
      if (r.ok && r.data && r.data.access_token) return writeAuthV2(r.data);
      // A definite rejection means the refresh token is dead; anything else
      // (server hiccup) keeps the stored session for the next attempt.
      if (r.status === 400 || r.status === 401) localStorage.removeItem(LS_AUTH_V2);
      throw new Error("SIMKL session expired. Refresh the page to sign in again.");
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// The token to use for a request right now. Under V2 it's looked up per
// call (never captured once at page load) and refreshed ahead of time when
// less than a day is left. Null when signed out.
async function currentToken() {
  if (authMode() === "v1") return localStorage.getItem(LS_TOKEN);
  let auth = readAuthV2();
  if (!auth) return null;
  if (auth.expiresAt - Date.now() < 24 * 60 * 60 * 1000) {
    try {
      auth = await refreshV2Token();
    } catch (e) {
      if (auth.expiresAt <= Date.now()) return null; // truly expired
    }
  }
  return auth.access;
}

function dropStoredToken() {
  localStorage.removeItem(authMode() === "v2" ? LS_AUTH_V2 : LS_TOKEN);
}

async function getAccessToken() {
  return authMode() === "v2" ? getAccessTokenV2() : getAccessTokenV1();
}

// AUTH V2 device flow (RFC 8628): same on-screen experience as the V1 PIN,
// but with no redirect back to this page - so it also works from an
// installed home-screen app, where a redirect could land in a browser with
// separate storage.
async function getAccessTokenV2() {
  const existing = await currentToken();
  if (existing) return existing;

  const clientId = activeClientId();
  const dev = await oauthPost("/oauth2/device", { client_id: clientId, scope: "media:read media:write" });
  if (!dev.ok || !dev.data || !dev.data.device_code) {
    throw new Error(`SIMKL sign-in could not start (${dev.status}): ${(dev.data && (dev.data.error_description || dev.data.error)) || "no details"}`);
  }
  const { device_code: deviceCode, user_code: userCode } = dev.data;
  const verificationUrl = dev.data.verification_uri || "https://simkl.com/pin";
  const openUrl = dev.data.verification_uri_complete || verificationUrl;
  let intervalMs = (dev.data.interval || 5) * 1000;
  const expiresIn = dev.data.expires_in || 900;

  app.innerHTML = `
    <div class="center-box">
      <h2>One-time authorization</h2>
      <p>1. Go to <a href="${openUrl}" target="_blank" rel="noopener">${verificationUrl}</a></p>
      <p>2. Enter this code:</p>
      <div class="pin-code">${userCode}</div>
      <div class="spinner"></div>
      <p style="color:var(--muted);font-size:0.85rem">Waiting for approval&hellip;</p>
    </div>
  `;
  subtitle.textContent = "Waiting for authorization";

  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let r;
    try {
      r = await oauthPost("/oauth2/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: deviceCode,
      });
    } catch (e) {
      continue; // keep polling through transient network errors
    }
    if (r.ok && r.data && r.data.access_token) {
      writeAuthV2(r.data);
      localStorage.removeItem(LS_TOKEN); // the old V1 token is dead weight now
      return r.data.access_token;
    }
    const err = r.data && r.data.error;
    if (err === "authorization_pending") continue;
    if (err === "slow_down") { intervalMs += 5000; continue; }
    if (err === "access_denied") throw new Error("Authorization was denied on simkl.com. Refresh the page to try again.");
    if (err === "expired_token") break;
    throw new Error(`SIMKL sign-in failed (${r.status}): ${(r.data && (r.data.error_description || r.data.error)) || "no details"}`);
  }
  throw new Error("Timed out waiting for approval. Refresh the page to try again.");
}

async function getAccessTokenV1() {
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
      safeSetItem(LS_TOKEN, poll.access_token);
      return poll.access_token;
    }
  }
  throw new Error("Timed out waiting for PIN approval. Refresh the page to try again.");
}

// ---- Request pacing ---------------------------------------------------------
// On top of the daily allowance, SIMKL caps requests per second: 10 GETs and
// 1 POST. A cold page load fires dozens of per-show lookups at once, and
// saving several seasons posts back to back - both would trip that.
// Stays a notch under each limit (9 GETs per rolling second, 1.1s between
// POSTs); light use never waits.
const recentGets = [];
async function throttleGet() {
  for (;;) {
    const now = Date.now();
    while (recentGets.length && now - recentGets[0] >= 1000) recentGets.shift();
    if (recentGets.length < 9) { recentGets.push(now); return; }
    await sleep(1000 - (now - recentGets[0]) + 5);
  }
}
let nextPostAt = 0;
async function throttlePost() {
  const now = Date.now();
  const at = Math.max(now, nextPostAt);
  nextPostAt = at + 1100;
  if (at > now) await sleep(at - now);
}

// Lists that findShowLibraryStatus fetched, kept briefly so opening several
// shows from search doesn't re-download all five lists each time (each list
// counts against the daily allowance). Any write to the library clears it.
let libraryListsCache = null;

// One authenticated call to SIMKL's API. Under V2 the token comes from
// currentToken() per attempt, and a 401 gets one refresh-and-retry; a 429 is
// either the daily allowance (reported as such) or a per-second burst
// (waits it out once).
async function simklApi(method, path, token, { params, body } = {}) {
  const qs = new URLSearchParams({
    client_id: activeClientId(), "app-name": APP_NAME, "app-version": APP_VERSION,
    ...(params || {}),
  });
  let refreshed = false, waitedOnce = false;
  for (;;) {
    if (method === "GET") await throttleGet(); else await throttlePost();
    const bearer = (await currentToken()) || token;
    let res;
    try {
      res = await fetch(`${SIMKL_BASE}${path}?${qs}`, {
        method,
        headers: body !== undefined
          ? { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }
          : { Authorization: `Bearer ${bearer}` },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error("Network/CORS error reaching SIMKL: " + e.message);
    }
    if (res.status === 401) {
      if (!refreshed && authMode() === "v2") {
        refreshed = true;
        try { await refreshV2Token(); continue; } catch (e) { /* fall through to sign-out */ }
      }
      dropStoredToken();
      throw new Error("SIMKL access token expired or revoked. Refresh the page to re-authenticate.");
    }
    if (res.status === 429) {
      const info = await res.clone().json().catch(() => null);
      const retryAfter = Number(res.headers.get("Retry-After")) || 0;
      if (info && info.error === "user_limit_exceeded") {
        const hours = Math.floor(retryAfter / 3600), mins = Math.ceil((retryAfter % 3600) / 60);
        throw new Error(`SIMKL's daily request limit for your account is used up. It resets at midnight US Eastern${retryAfter ? ` (in about ${hours}h ${mins}m)` : ""}.`);
      }
      if (!waitedOnce) { waitedOnce = true; await sleep(Math.max(1, retryAfter) * 1000); continue; }
    }
    return res;
  }
}

async function simklGet(path, token, extraParams) {
  const res = await simklApi("GET", path, token, { params: extraParams });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SIMKL request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function simklPost(path, token, body) {
  const res = await simklApi("POST", path, token, { body });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`SIMKL request failed (${res.status}): ${errBody.slice(0, 300)}`);
  }
  libraryListsCache = null; // the library just changed
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

// Same shape as getWatchingShows, for the "recently watched, then dropped"
// case in Recently Watched below - a show you stopped following shouldn't
// vanish from there instantly, since you did just watch something of it.
async function getDroppedShows(token) {
  const data = await simklGet("/sync/all-items/shows/dropped", token, {
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
const CACHE_TTL_SIMKL_SHOW_RECENT_MS = 3 * 60 * 60 * 1000; // for shows in their first month, see isRecentShow
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
  const write = () => localStorage.setItem(API_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  try {
    write();
  } catch (e) {
    // Full: drop the oldest cached entries to fit this newer one. If storage
    // is unavailable or the entry is bigger than everything, the in-memory
    // cache for this session still works, just nothing persists.
    dropOldCacheUntil(write);
  }
}

// A read here already ignores anything past its own TTL, but never
// deletes it - so months of browsing quietly leaves every expired entry
// sitting in localStorage forever, until the origin's whole quota fills
// up. At that point *every* localStorage.setItem() on this origin starts
// throwing QuotaExceededError, including totally unrelated ones (like
// saveImageOverride) - which is exactly how cycling a poster/banner once
// silently stopped actually changing anything. Run once per page load;
// 7 days covers the longest TTL any entry actually uses, so nothing still
// legitimately in use is ever removed early.
const MAX_PERSISTED_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function prunePersistedCache() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(API_CACHE_PREFIX)) continue;
      let stale = true;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        stale = !entry || typeof entry.t !== "number" || Date.now() - entry.t > MAX_PERSISTED_CACHE_AGE_MS;
      } catch (e) {
        stale = true; // corrupt entry - just as well gone
      }
      if (stale) toRemove.push(key);
    }
    toRemove.forEach(key => localStorage.removeItem(key));
  } catch (e) {
    // localStorage unavailable - nothing to prune anyway
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
      // Bumped from tmdbshow: to tmdbshow2: when content_ratings was added
      // to append_to_response below - otherwise every show already
      // persisted from before that change (up to 24h old, per
      // CACHE_TTL_TMDB_SHOW_MS) would keep serving its old response, minus
      // content_ratings, straight out of localStorage until it naturally
      // expired, silently hiding the new rating badge for up to a day.
      const cacheKey = `tmdbshow2:${tmdbId}`;
      const cached = readPersistedCache(cacheKey, CACHE_TTL_TMDB_SHOW_MS);
      if (cached !== undefined) {
        this.show.set(tmdbId, Promise.resolve(cached));
        return this.show.get(tmdbId);
      }
      // append_to_response=images,external_ids,content_ratings pulls ALL
      // available posters/backdrops (for the cycle-through-alternates
      // feature), this show's imdb id (for the search-detail modal's title
      // link), and its age rating (TV-MA etc., shown on the Plan to Watch
      // row - see extractContentRating) all in the one request every show
      // already needs, rather than firing extra ones. include_image_language
      // asks for
      // English + untagged (no-language) + Hebrew images -
      // English/no-language is preferred (see computeImages), Hebrew is
      // used only as a fallback for shows that only have Hebrew-text
      // artwork (some Israeli shows).
      // TMDB is purely supplementary now (images/external id/runtime
      // estimate only, never episode counts) - a failure here degrades
      // gracefully to null rather than crashing whichever show triggered it.
      const promise = tmdbGet(`/tv/${tmdbId}`, {
        append_to_response: "images,external_ids,content_ratings",
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
  // `recent` marks a show that premiered within the last month: its IMDb
  // rating still moves a lot, and SIMKL's copy of it catches up gradually,
  // so it's re-read more often (an older show's rating barely changes, and
  // re-reading every show that often would slow every refresh down).
  get(simklId, token, recent) {
    if (!this.map.has(simklId)) {
      const cacheKey = `simklshow:${simklId}`;
      const cached = readPersistedCache(cacheKey, recent ? CACHE_TTL_SIMKL_SHOW_RECENT_MS : CACHE_TTL_SIMKL_SHOW_MS);
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

// ---------------------------------------------------------------------
// Ratings from several sources
// ---------------------------------------------------------------------
// SIMKL's own user rating - same /tv/{id} data (and same defensive
// parsing) as the IMDb number above.
function extractSimklRating(showData) {
  const r = showData && showData.ratings;
  if (!r || r.simkl == null) return null;
  const v = typeof r.simkl === "object" ? r.simkl.rating : r.simkl;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && isFinite(n) && n > 0 ? n : null;
}

// Rotten Tomatoes (critics + audience) and Trakt come from MDBList, which
// aggregates them behind one request per show. Needs a free API key from
// mdblist.com (Settings); without one this quietly returns nothing and the
// rest of the ratings still work. Its daily allowance is separate from
// SIMKL's.
const CACHE_TTL_MDBLIST_MS = 24 * 60 * 60 * 1000;
class MdblistCache {
  constructor() {
    this.map = new Map();
    this.active = 0;
    this.waiting = [];
    this.disabled = false; // set after the key is rejected, so a bad key isn't retried per show
  }
  async acquire() {
    if (this.active >= 5) await new Promise(r => this.waiting.push(r));
    this.active++;
  }
  release() {
    this.active--;
    const next = this.waiting.shift();
    if (next) next();
  }
  async fetchOne(imdbId, key) {
    await this.acquire();
    try {
      const res = await fetch(`https://api.mdblist.com/imdb/show/${imdbId}?apikey=${encodeURIComponent(key)}`);
      if (res.status === 401 || res.status === 403) {
        if (!this.disabled) showToast("MDBList rejected the API key - check it in Settings.", true);
        this.disabled = true;
        return null;
      }
      // Unknown to MDBList: remember "nothing" rather than re-asking every load.
      if (res.status === 404) return { imdb: null, tomatoes: null, popcorn: null, trakt: null };
      if (!res.ok) return null;
      const d = await res.json();
      const by = {};
      for (const r of d.ratings || []) if (r && typeof r.value === "number") by[r.source] = r.value;
      return {
        imdb: by.imdb != null ? by.imdb : null,
        tomatoes: by.tomatoes != null ? by.tomatoes : null,
        popcorn: by.popcorn != null ? by.popcorn : null,
        trakt: by.trakt != null ? by.trakt : null,
      };
    } finally {
      this.release();
    }
  }
  // `recent`: a show in its first month is re-read more often (see isRecentShow).
  get(imdbId, recent) {
    const key = getConfig().mdblistKey;
    if (!key || !imdbId || this.disabled) return Promise.resolve(null);
    if (!this.map.has(imdbId)) {
      const cacheKey = `mdblist:${imdbId}`;
      const cached = readPersistedCache(cacheKey, recent ? CACHE_TTL_SIMKL_SHOW_RECENT_MS : CACHE_TTL_MDBLIST_MS);
      if (cached !== undefined) {
        this.map.set(imdbId, Promise.resolve(cached));
        return this.map.get(imdbId);
      }
      const promise = this.fetchOne(imdbId, key)
        .then(data => { if (data) writePersistedCache(cacheKey, data); return data; })
        .catch(() => null);
      this.map.set(imdbId, promise);
    }
    return this.map.get(imdbId);
  }
}
const mdblistCache = new MdblistCache();

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

// One object per show: imdb / simkl / tmdb are out of 10; the RT scores and
// Trakt are percentages. null = no score from that source.
function buildRatings(simklShowData, tmdbVote, mdb) {
  const pos = v => (typeof v === "number" && isFinite(v) && v > 0) ? v : null;
  const imdb = extractImdbRating(simklShowData);
  return {
    // SIMKL's copy first (that's what the card always showed); MDBList's only
    // fills in when SIMKL has none.
    imdb: imdb != null ? imdb : pos(mdb && mdb.imdb),
    simkl: extractSimklRating(simklShowData),
    tmdb: pos(tmdbVote),
    rtCritics: pos(mdb && mdb.tomatoes),
    rtAudience: pos(mdb && mdb.popcorn),
    trakt: pos(mdb && mdb.trakt),
  };
}

async function loadRatings(simklShowData, tmdbVote, imdbId, recent) {
  const mdb = await mdblistCache.get(imdbId, recent);
  return buildRatings(simklShowData, tmdbVote, mdb);
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
// survives a refresh instead of resetting to TMDB's default pick. Not
// critical to the click actually succeeding - a QuotaExceededError here
// (typically from the much larger persisted API cache below filling up
// the origin's whole localStorage quota, see prunePersistedCache) used to
// bubble all the way up and abort the in-progress cycle before it ever
// touched the DOM: the flip-out/flip-in classes would still get added and
// stripped by the old cycling code's cleanup, so it visibly flashed through
// the motion of changing, while the image itself silently never did.
function saveImageOverride(tmdbId, mode, path) {
  if (!tmdbId) return;
  try {
    const overrides = getImageOverrides();
    const entry = overrides[tmdbId] || {};
    if (mode === "banner") entry.bannerPath = path;
    else entry.posterPath = path;
    overrides[tmdbId] = entry;
    localStorage.setItem(LS_IMAGE_OVERRIDES, JSON.stringify(overrides));
  } catch (e) {
    // Doesn't persist across a reload this time, but the cycle itself
    // (row state + the visible DOM patch) must still go through.
  }
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

async function getRecentlyWatchedEpisodes(items, cache, episodeCache, token, ratingsCache, droppedItems) {
  // Scans every currently-"watching" show (even ones you've fully caught
  // up on, which wouldn't otherwise appear in My List) for watched
  // episodes with a timestamp, and returns the 15 most recent - at most
  // one entry per show (its single most recently watched episode), so
  // binge-watching several episodes of the same show in a row doesn't
  // crowd out everything else. Recently dropped shows are folded into the
  // same pool (flagged so the render side can badge them "DROPPED") rather
  // than disappearing the instant their status changes - they still
  // compete on recency with everything else for one of the 15 slots.
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
          imdbId: (show.ids || {}).imdb,
        });
      }
    }
  }
  for (const item of droppedItems || []) {
    if (item.status !== "dropped") continue;
    // Unlike /watching, SIMKL's /dropped list doesn't return a
    // seasons/episodes breakdown at all - just a last_watched_at
    // timestamp and a "S01E06"-style last_watched code for the single
    // most recent episode, which is all Recently Watched needs anyway.
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
      simklId: (show.ids || {}).simkl,
      imdbId: (show.ids || {}).imdb,
      dropped: true,
    });
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
    let firstAirDate = null;
    if (c.tmdbId) {
      const showDetail = await cache.getShow(c.tmdbId); // cached, no extra request if already fetched
      Object.assign(c, computeImages(showDetail, c.tmdbId));
      const network = latestNetwork(showDetail);
      c.network = network ? network.name : null;
      tmdbLogoPath = network ? network.logo_path : null;
      firstAirDate = showDetail ? showDetail.first_air_date : null;
    }
    if (!c.network && c.simklId && ratingsCache) {
      // Same freshness rule as the rating lookups: the cache remembers the
      // first read per show for the whole session, so this one mustn't be
      // the call that pins an older copy of a brand-new show.
      c.network = extractSimklNetwork(await ratingsCache.get(c.simklId, token, isRecentShow(firstAirDate)));
    }
    c.networkLogoPath = resolveNetworkLogoUrl(c.network, tmdbLogoPath);

    // Episode title: prefer SIMKL's own title if we have it, else TMDB's -
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
    if (c.simklId) {
      const simklEpisodes = await episodeCache.get(c.simklId, token);
      const match = simklEpisodes && simklEpisodes.find(e => e.season === c.season && e.episode === c.episode);
      if (match && match.title && !/^Episode\s+\d+$/i.test(String(match.title).trim())) {
        c.episodeTitle = String(match.title).trim();
      }
      if (!c.dropped && !c.badge && simklEpisodes) {
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
    let firstAirDate = null;
    let tmdbVote = null;
    let endYear = null;
    let contentRating = null;
    let genreLabel = null;
    if (tmdbId) {
      try {
        const showDetail = await cache.getShow(tmdbId);
        images = computeImages(showDetail, tmdbId);
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
    const simklShowData = simklId ? await ratingsCache.get(simklId, token, recentShow) : null;
    const ratings = await loadRatings(simklShowData, tmdbVote, imdbId, recentShow);
    const imdbRating = ratings.imdb;
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

    return { title, imdbId, imdbRating, ratings, ...images, simklId, tmdbId, airedLabel, ended, network, networkLogoPath, yearRangeLabel, contentRating, genreLabel };
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
  const [items, droppedItems] = await Promise.all([getWatchingShows(token), getDroppedShows(token)]);
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
    const recentShow = isRecentShow(showDetail && showDetail.first_air_date);
    const simklShowData = simklId ? await ratingsCache.get(simklId, token, recentShow) : null;
    const ratings = await loadRatings(simklShowData, showDetail && showDetail.vote_average, imdbId, recentShow);
    const imdbRating = ratings.imdb;
    if (!network) network = extractSimklNetwork(simklShowData);
    const networkLogoPath = resolveNetworkLogoUrl(network, tmdbLogoPath);
    const row = {
      title, imdbId, imdbRating, ratings, simklId, tmdbId, year: show.year, ...images, network, networkLogoPath,
      totalEpisodes, available, watched, remaining,
      hours, mins, nextHours, nextMins, nextLabel, nextSeason, nextEpisode, episodeTitle, nextAirDate, badge,
      episodesLeft, lastWatchedAt: mostRecentWatchedAt(item), yearRangeLabel,
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
  const recentlyWatched = await getRecentlyWatchedEpisodes(items, cache, episodeCache, token, ratingsCache, droppedItems);
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

  const recentShow = isRecentShow(showDetail && showDetail.first_air_date);
  const simklShowData = simklId ? await ratingsCache.get(simklId, token, recentShow) : null;
  const ratings = await loadRatings(simklShowData, showDetail && showDetail.vote_average, imdbId, recentShow);
  const imdbRating = ratings.imdb;

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
    ratings,
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

// Marks a batch of one season's episodes watched or not watched - the
// history-remove endpoint takes the exact same body shape as the add one.
async function setEpisodesWatched(simklId, season, episodeNumbers, watched, token) {
  return simklPost(watched ? "/sync/history" : "/sync/history/remove", token, {
    shows: [{
      ids: { simkl: simklId },
      seasons: [{ number: season, episodes: episodeNumbers.map(n => ({ number: n })) }],
    }],
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
  // Each of the 5 lists counts against SIMKL's daily allowance, so a recent
  // fetch is reused (simklPost clears it on any library write).
  let lists;
  if (libraryListsCache && Date.now() - libraryListsCache.t < 3 * 60 * 1000) {
    lists = libraryListsCache.lists;
  } else {
    let anyFailed = false;
    lists = await Promise.all(
      LIBRARY_STATUSES.map(status =>
        // episode_watched_at is what makes SIMKL include each item's per-
        // episode `seasons` list (same as getWatchingShows) - the episodes
        // manager needs it to know which episodes are already watched.
        simklGet(`/sync/all-items/shows/${status}`, token, { extended: "full", episode_watched_at: "yes" })
          .catch(() => { anyFailed = true; return null; })
      )
    );
    if (!anyFailed) libraryListsCache = { t: Date.now(), lists };
  }
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
    searchResultsActiveIndex = -1;
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

  // Highlights the first result by default so Enter works right away
  // without needing an arrow-key press first - see wireSearchInput.
  highlightSearchResult(0);
}

// Which result row the keyboard (arrow keys / Enter, see wireSearchInput)
// currently has highlighted - independent of :hover, so it stays visible
// while navigating with the keyboard alone.
let searchResultsActiveIndex = -1;

function highlightSearchResult(idx) {
  const container = document.getElementById("searchResults");
  if (!container) return;
  const rows = container.querySelectorAll(".search-result-row");
  rows.forEach(row => row.classList.remove("active"));
  searchResultsActiveIndex = (idx >= 0 && idx < rows.length) ? idx : -1;
  if (searchResultsActiveIndex === -1) return;
  const row = rows[searchResultsActiveIndex];
  row.classList.add("active");
  row.scrollIntoView({ block: "nearest" });
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

  // Arrow keys move the highlighted result (wraps neither way - stops at
  // the first/last row); Enter opens whichever one is currently
  // highlighted, same as clicking it.
  input.onkeydown = e => {
    if (!lastSearchResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightSearchResult(Math.min(searchResultsActiveIndex + 1, lastSearchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightSearchResult(Math.max(searchResultsActiveIndex - 1, 0));
    } else if (e.key === "Enter" && searchResultsActiveIndex !== -1) {
      e.preventDefault();
      openShowDetail(lastSearchResults[searchResultsActiveIndex]);
    }
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
    // Runs alongside the library lookup rather than after it - a TMDB
    // (as opposed to SIMKL) search result never carries an imdb id on its
    // own, which used to mean no link at all for anything not already in
    // the user's library. getShow's own response already includes
    // external_ids (see TmdbCache.getShow), so this reuses the exact same
    // cached per-show fetch every other TMDB-backed feature here does,
    // rather than a dedicated request.
    const [match, showDetail] = await Promise.all([
      findShowLibraryStatus(ids, simklToken),
      (!ids.imdb && ids.tmdb && sharedCache) ? sharedCache.getShow(ids.tmdb) : null,
    ]);
    libraryMatch = match;
    const fetchedImdbId = showDetail && showDetail.external_ids && showDetail.external_ids.imdb_id;
    if (fetchedImdbId) ids.imdb = fetchedImdbId;
  } catch (err) {
    body.innerHTML = `
      <button class="modal-back-btn" id="detailBackBtn">&larr; Back to search</button>
      <div class="error-box">${err.message}</div>`;
    document.getElementById("detailBackBtn").onclick = renderSearchStep;
    return;
  }
  show.ids = ids;
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
    const label = `${STATUS_LABELS[libraryMatch.status]}${progress}`;
    // Only shows with a SIMKL id can be managed episode-by-episode.
    const canOpenEpisodes = !!(item.show && item.show.ids && item.show.ids.simkl);
    statusHtml = canOpenEpisodes
      ? `<button class="detail-status in-list detail-status-link" id="detailEpisodesBtn" title="Open episodes list">${label} <span aria-hidden="true">&rsaquo;</span></button>`
      : `<div class="detail-status in-list">${label}</div>`;
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

  // The search result itself carries an imdb id when it came from SIMKL's
  // own search; a TMDB-sourced result (the Hebrew-query fallback) doesn't,
  // but the library lookup just above already pulled the full SIMKL show
  // record (extended=full) for anything already on the user's list, which
  // does carry one - falls back to no link at all rather than a dead one.
  const libraryShowIds = libraryMatch && libraryMatch.item.show && libraryMatch.item.show.ids;
  const imdbId = (show.ids && show.ids.imdb) || (libraryShowIds && libraryShowIds.imdb) || null;
  const titleText = show.title || "Unknown";
  const detailTitleHtml = imdbId
    ? `<a class="detail-title" href="https://www.imdb.com/title/${imdbId}/" target="_blank" rel="noopener" title="Open on IMDb" onclick="event.stopPropagation()">${titleText}</a>`
    : `<div class="detail-title">${titleText}</div>`;

  body.innerHTML = `
    <button class="modal-back-btn" id="detailBackBtn">&larr; Back to search</button>
    <div class="detail-header">
      ${posterHtml}
      <div class="detail-info">
        ${detailTitleHtml}
        <div class="detail-year">${show.year || ""}</div>
        ${statusHtml}
      </div>
    </div>
    <div class="detail-ratings" id="detailRatings"></div>
    <div class="detail-status-picker">
      <p class="detail-picker-label">Set status:</p>
      ${statusButtons}
      ${removeHtml}
    </div>`;

  document.getElementById("detailBackBtn").onclick = renderSearchStep;
  const episodesBtn = document.getElementById("detailEpisodesBtn");
  if (episodesBtn) episodesBtn.onclick = () => openEpisodesManager(show, libraryMatch);
  fillDetailRatings(show, libraryMatch);
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

// Full per-season episode list for a show in the user's library, opened from
// the detail view's status line - lets episodes be marked watched/unwatched
// one at a time or a whole season at once. Swaps the search modal's body
// (like the detail view itself) rather than stacking a second modal.
let watchedMarksChanged = false;
// Set while the episodes manager holds unsaved changes: closeSearchModal
// asks it first, so X / Esc / clicking outside can't silently drop them.
let searchModalCloseGuard = null;

async function openEpisodesManager(show, libraryMatch) {
  const title = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  if (!title || !body) return;
  const item = libraryMatch.item;
  const simklId = item.show.ids.simkl;
  title.textContent = show.title || "Episodes";
  // The two-column layout below needs more room than the search modal's
  // usual width - dropped again on the way back to the detail view.
  const box = body.closest(".modal-box");
  if (box) box.classList.add("modal-wide");
  // Changes are staged locally until Save: `watched` is the working copy,
  // `saved` the last state SIMKL is known to have (null until loaded).
  let saved = null, saving = false;
  const backToDetail = () => {
    if (!confirmLeave()) return;
    if (box) box.classList.remove("modal-wide");
    searchModalCloseGuard = null;
    title.textContent = show.title || "Show";
    renderShowDetail(show, libraryMatch);
  };
  body.innerHTML = `
    <button class="modal-back-btn" id="detailBackBtn">&larr; Back</button>
    <div class="spinner" style="margin:30px auto"></div>`;
  document.getElementById("detailBackBtn").onclick = backToDetail;

  const episodeCache = sharedEpisodeCache || new SimklEpisodeCache();
  const all = await episodeCache.get(simklId, simklToken);
  if (!all || !all.length) {
    body.innerHTML = `
      <button class="modal-back-btn" id="detailBackBtn">&larr; Back</button>
      <div class="error-box">SIMKL has no episode list for this show.</div>`;
    document.getElementById("detailBackBtn").onclick = backToDetail;
    return;
  }

  // season number -> [{episode, title, aired}] (specials excluded, same as
  // everywhere else here)
  const now = Date.now();
  const seasons = new Map();
  for (const ep of all) {
    if (ep.season == null || ep.season === 0 || ep.episode == null) continue;
    if (!seasons.has(ep.season)) seasons.set(ep.season, []);
    const ts = ep.date ? new Date(ep.date).getTime() : NaN;
    seasons.get(ep.season).push({
      episode: ep.episode, title: ep.title || "", aired: !isNaN(ts) && ts <= now,
    });
  }
  const seasonNums = [...seasons.keys()].sort((a, b) => a - b);
  for (const n of seasonNums) seasons.get(n).sort((a, b) => a.episode - b.episode);

  const watched = watchedEpisodeNumbersBySeason(item);
  const watchedSet = n => watched[n] || (watched[n] = new Set());
  // SIMKL sometimes returns no per-episode `seasons` list for an item (only
  // the counts). A fully-watched show is the one case that's still
  // unambiguous without it: every aired episode counts as watched.
  const hasWatchedDetail = Array.isArray(item.seasons) && item.seasons.length > 0;
  // SIMKL only returns the per-episode list for shows in "watching"; every
  // other status (dropped, completed, on hold) gets just the counts plus a
  // "S01E08"-style last_watched code. In that case, assume the episodes
  // were watched in order up to that one - exact for the usual "watched
  // the first N, then stopped" case, an estimate if some were skipped
  // (flagged in the summary line below when the counts disagree).
  let estimatedMarks = false, estimateOff = false;
  if (!hasWatchedDetail) {
    const match = /^S(\d+)E(\d+)$/i.exec(item.last_watched || "");
    if (item.total_episodes_count && item.watched_episodes_count >= item.total_episodes_count) {
      for (const n of seasonNums) seasons.get(n).filter(e => e.aired).forEach(e => watchedSet(n).add(e.episode));
      estimatedMarks = true;
    } else if (match) {
      const lastS = Number(match[1]), lastE = Number(match[2]);
      let marked = 0;
      for (const n of seasonNums) {
        for (const e of seasons.get(n)) {
          if (n < lastS || (n === lastS && e.episode <= lastE)) { watchedSet(n).add(e.episode); marked++; }
        }
      }
      estimatedMarks = true;
      estimateOff = marked !== item.watched_episodes_count;
    }
  }
  const pad = n => String(n).padStart(2, "0");
  // Season shown in the list: the first with an aired-but-unwatched
  // episode, else the last one.
  const firstUnfinished = seasonNums.find(n => seasons.get(n).some(e => e.aired && !watchedSet(n).has(e.episode)));
  let currentSeason = firstUnfinished != null ? firstUnfinished : seasonNums[seasonNums.length - 1];

  // Tri-state box: only aired episodes count, since an unaired one can't be
  // watched yet.
  function seasonState(n) {
    const aired = seasons.get(n).filter(e => e.aired);
    const done = aired.filter(e => watchedSet(n).has(e.episode)).length;
    return done === 0 ? "none" : done === aired.length ? "all" : "some";
  }
  const checkboxHtml = (state, extraClass, attrs) => {
    const aria = state === "all" ? "true" : state === "some" ? "mixed" : "false";
    const glyph = state === "all" ? "&#10003;" : state === "some" ? "&minus;" : "";
    return `<button class="ep-cb ${state}${extraClass}" role="checkbox" aria-checked="${aria}" ${attrs}>${glyph}</button>`;
  };

  function render() {
    const totalWatched = seasonNums.reduce((s, n) => s + seasons.get(n).filter(e => watchedSet(n).has(e.episode)).length, 0);
    const pending = pendingCount();

    let next = null;
    for (const n of seasonNums) {
      const e = seasons.get(n).find(e => e.aired && !watchedSet(n).has(e.episode));
      if (e) { next = { season: n, episode: e.episode }; break; }
    }

    // Each season's episodes open right under its own header (accordion,
    // one season at a time) instead of in a separate block after them all.
    const seasonsHtml = seasonNums.map(n => {
      const eps = seasons.get(n);
      const done = eps.filter(e => watchedSet(n).has(e.episode)).length;
      const hasAired = eps.some(e => e.aired);
      const isOpen = n === currentSeason;
      const gridHtml = isOpen ? `<div class="ep-grid">${eps.map(e => {
        const isWatched = watchedSet(n).has(e.episode);
        const actionable = e.aired || isWatched;
        const isNext = next && next.season === n && next.episode === e.episode;
        return `
          <div class="ep-card${isWatched ? " w" : ""}${isNext ? " nx" : ""}${actionable ? "" : " un"}" ${actionable ? `data-toggle-ep="${e.episode}" tabindex="0"` : ""}>
            ${actionable ? checkboxHtml(isWatched ? "all" : "none", "", 'tabindex="-1" aria-hidden="true"') : checkboxHtml("none", " off", 'tabindex="-1" aria-hidden="true"')}
            <div>
              <span class="ep-card-code">S${pad(n)}E${pad(e.episode)}${isNext ? " &middot; UP NEXT" : ""}${actionable ? "" : " &middot; NOT AIRED"}</span>
              <span class="ep-card-title">${e.title || `Episode ${e.episode}`}</span>
            </div>
          </div>`;
      }).join("")}</div>` : "";
      return `
        <div class="ep-season-block">
          <div class="ep-rail-item${isOpen ? " on" : ""}" data-select-season="${n}" tabindex="0" aria-expanded="${isOpen}">
            ${checkboxHtml(seasonState(n), " lg", `data-season-cb="${n}" aria-label="Season ${n}" ${hasAired ? "" : "disabled"}`)}
            <div class="ep-rail-text">
              <span class="ep-rail-name">Season ${n}</span>
              <span class="ep-rail-count">${done}/${eps.length}</span>
            </div>
            <span class="ep-rail-caret">${isOpen ? "&#9662;" : "&#9656;"}</span>
          </div>
          ${gridHtml}
        </div>`;
    }).join("");

    // Rebuilding the markup below resets every scroll position, so remember
    // both scrollers (the list itself and the modal overlay) and put them
    // back - otherwise each click on a low episode jumps back to the top.
    const listEl = body.querySelector(".ep-manager");
    const overlayEl = document.getElementById("searchModalOverlay");
    const listScroll = listEl ? listEl.scrollTop : 0;
    const overlayScroll = overlayEl ? overlayEl.scrollTop : 0;

    body.innerHTML = `
      <button class="modal-back-btn" id="detailBackBtn">&larr; Back</button>
      <div class="ep-manage-summary">${STATUS_LABELS[libraryMatch.status]} &mdash; ${totalWatched}/${item.total_episodes_count || all.length} episodes watched</div>
      ${estimatedMarks ? `<div class="ep-manage-diag">${estimateOff
        ? "Marks are estimated from the last watched episode and may not match exactly what you watched."
        : "Marks are inferred from the last watched episode."}</div>` : ""}
      <div class="ep-manager">${seasonsHtml}</div>
      ${pending ? `
        <div class="ep-savebar">
          <span class="ep-savebar-text">${pending} unsaved change${pending === 1 ? "" : "s"}</span>
          <span class="ep-savebar-actions">
            <button class="ep-savebar-btn" id="epDiscardBtn" ${saving ? "disabled" : ""}>Discard</button>
            <button class="ep-savebar-btn primary" id="epSaveBtn" ${saving ? "disabled" : ""}>${saving ? "Saving&hellip;" : "Save"}</button>
          </span>
        </div>` : ""}`;
    document.getElementById("detailBackBtn").onclick = backToDetail;
    const saveBtn = document.getElementById("epSaveBtn");
    if (saveBtn) saveBtn.onclick = saveChanges;
    const discardBtn = document.getElementById("epDiscardBtn");
    if (discardBtn) discardBtn.onclick = discardChanges;
    const newListEl = body.querySelector(".ep-manager");
    if (newListEl) newListEl.scrollTop = listScroll;
    if (overlayEl) overlayEl.scrollTop = overlayScroll;

    const onActivate = (el, fn) => {
      el.onclick = fn;
      el.onkeydown = e => { if ((e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); fn(e); } };
    };
    body.querySelectorAll("[data-select-season]").forEach(el => {
      onActivate(el, e => {
        if (e.target.closest && e.target.closest(".ep-cb")) return;
        const n = Number(el.dataset.selectSeason);
        currentSeason = currentSeason === n ? null : n;
        render();
      });
    });
    body.querySelectorAll("[data-season-cb]").forEach(btn => {
      btn.onclick = () => {
        const n = Number(btn.dataset.seasonCb);
        const airedEps = seasons.get(n).filter(e => e.aired);
        const makeWatched = seasonState(n) !== "all";
        const targets = airedEps.filter(e => watchedSet(n).has(e.episode) !== makeWatched).map(e => e.episode);
        if (!targets.length) return;
        setLocal(n, targets, makeWatched);
      };
    });
    body.querySelectorAll("[data-toggle-ep]").forEach(el => {
      onActivate(el, () => {
        const ep = Number(el.dataset.toggleEp);
        setLocal(currentSeason, [ep], !watchedSet(currentSeason).has(ep));
      });
    });
  }

  // Clicks only edit the local working copy; nothing reaches SIMKL until Save.
  function setLocal(season, episodeNumbers, makeWatched) {
    if (saving) return;
    const set = watchedSet(season);
    episodeNumbers.forEach(n => makeWatched ? set.add(n) : set.delete(n));
    render();
  }

  // Per-season difference between the working copy and what SIMKL has.
  function pendingChanges() {
    const out = [];
    for (const n of seasonNums) {
      const now = watchedSet(n), was = saved[n];
      const add = [...now].filter(x => !was.has(x));
      const remove = [...was].filter(x => !now.has(x));
      if (add.length || remove.length) out.push({ season: n, add, remove });
    }
    return out;
  }
  function pendingCount() {
    if (!saved) return 0;
    return pendingChanges().reduce((s, c) => s + c.add.length + c.remove.length, 0);
  }
  function confirmLeave() {
    const n = pendingCount();
    return !n || confirm(`You have ${n} unsaved change${n === 1 ? "" : "s"}. Leave without saving?`);
  }
  function discardChanges() {
    if (saving) return;
    for (const n of seasonNums) watched[n] = new Set(saved[n]);
    render();
  }
  async function saveChanges() {
    const changes = pendingChanges();
    if (!changes.length || saving) return;
    saving = true;
    render();
    let savedCount = 0;
    try {
      // One request per season and direction; `saved` advances after each
      // one, so a failure halfway leaves only the unsent part pending.
      for (const c of changes) {
        if (c.add.length) {
          await setEpisodesWatched(simklId, c.season, c.add, true, simklToken);
          c.add.forEach(x => saved[c.season].add(x));
          savedCount += c.add.length;
        }
        if (c.remove.length) {
          await setEpisodesWatched(simklId, c.season, c.remove, false, simklToken);
          c.remove.forEach(x => saved[c.season].delete(x));
          savedCount += c.remove.length;
        }
      }
      showToast(`Saved ${savedCount} change${savedCount === 1 ? "" : "s"}`);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      if (savedCount) watchedMarksChanged = true;
      item.watched_episodes_count = seasonNums.reduce((s, n) => s + saved[n].size, 0);
      saving = false;
      render();
    }
  }

  saved = {};
  for (const n of seasonNums) saved[n] = new Set(watchedSet(n));
  searchModalCloseGuard = confirmLeave;
  render();
}

// ---------------------------------------------------------------------
// Modal back-button support
// ---------------------------------------------------------------------
// The app never otherwise touches browser history (it's a single static
// page), so with nothing pushed, pressing the hardware/browser back button
// while any modal overlay is open has nowhere to go but out of the app
// entirely - on mobile that means the PWA just closes. Every open*Modal()
// pushes one dummy history entry right after its overlay is actually shown
// (pushModalHistoryState), and popstate below closes whatever's open
// instead of letting the real navigation happen. A manual close (X /
// Escape / backdrop click) calls consumeModalHistoryState() so it also
// consumes that entry - otherwise it would sit there needing an extra,
// confusing back press to get past later.
//
// Only one modal is ever open at a time in this app, so a single "current
// close function" is enough - no stack needed.
let activeModalClose = null;
let poppingModalHistory = false;

function pushModalHistoryState(closeFn) {
  activeModalClose = closeFn;
  history.pushState({ modal: true }, "");
}

// Called by a close*Modal() right after it actually removes its overlay -
// skip the call entirely if that close turns out to be a no-op (nothing
// was open), so an unrelated history entry never gets consumed by mistake.
function consumeModalHistoryState() {
  activeModalClose = null;
  if (!poppingModalHistory) history.back();
}

window.addEventListener("popstate", () => {
  if (!activeModalClose) return;
  const closeFn = activeModalClose;
  poppingModalHistory = true;
  closeFn();
  poppingModalHistory = false;
  // Still set means the close was vetoed (e.g. closeSearchModal's unsaved-
  // changes confirm) - the back navigation itself already went through
  // regardless, so push a fresh entry or the *next* back press would exit
  // the app instead of being trapped by the modal again.
  if (activeModalClose) history.pushState({ modal: true }, "");
});

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
  pushModalHistoryState(closeEpisodesModal);

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
  if (!overlay) return;
  overlay.remove();
  document.removeEventListener("keydown", episodesModalEscHandler);
  consumeModalHistoryState();
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
  pushModalHistoryState(closeCastModal);

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
  if (!overlay) return;
  overlay.remove();
  document.removeEventListener("keydown", castModalEscHandler);
  consumeModalHistoryState();
}

// Icon/title for the "all shows" modal opened from a bottom panel's show-count
// link (listPanelCountHtml) - same icon+label each panel's own header uses.
// A function rather than a module-level object because the icon constants
// themselves are declared further down the file (TDZ at load time otherwise).
function panelShowsModalConfig(source) {
  switch (source) {
    case "watched": return { icon: CLOCK_ICON_SOLID_SVG, title: "RECENTLY WATCHED" };
    case "plan": return { icon: BOOKMARK_ICON_SVG, title: "PLAN TO WATCH" };
    case "airing": return { icon: CALENDAR_ICON_SVG, title: "AIRING NEXT" };
    // The top panel's own "N Shows" stat - title follows currentView since
    // that stat only actually exists in the "list" header today, but the
    // underlying rows (getCycleRows("main")) already switch on it too.
    case "main": return { icon: STAT_TV_ICON_SVG, title: currentView === "airing" ? "AIRING NEXT" : "MY WATCH LIST" };
    default: return null;
  }
}

// Every show currently in one bottom panel, thumbnails at the exact same
// size as the panel's own row thumbs (the grid wrapper carries the
// .list-panel class purely so .list-panel .list-thumb's sizing rule applies
// here too, instead of duplicating the 204x115 number) - title links straight
// to IMDb since every row already carries a resolved imdbId (unlike the cast
// modal's names, nothing here needs a lazy per-item fetch).
function openPanelShowsModal(source) {
  const rows = getCycleRows(source);
  const config = panelShowsModalConfig(source);
  if (!rows || !rows.length || !config) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "panelShowsModalOverlay";
  const headerEl = document.querySelector("header");
  overlay.style.paddingTop = `${(headerEl ? headerEl.offsetHeight : 0) + 24}px`;

  // Each card is a flip card, not a link: clicking the poster (front) does
  // a half-turn to a wider, horizontal back face holding the exact same
  // info the show's own row shows (rowInfoWrapHtml, mode "flip" - only the
  // title there links to IMDb, matching how it used to work when the whole
  // card was the link).
  const itemsHtml = rows.map((row, idx) => {
    const posterSrc = row.posterUrl || row.bannerUrl;
    const thumbHtml = posterSrc
      ? `<img class="list-thumb" src="${posterSrc}" alt="${row.title}">`
      : `<div class="list-thumb placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
    const infoHtml = rowInfoWrapHtml(row, idx, source, "flip");
    // Landscape banner (not the portrait poster - already used on the
    // front) as a lightly blurred backdrop behind the back face's text, so
    // the show is still visually recognizable once flipped rather than
    // reading as a plain vignette. Falls back to the poster when a show
    // has no banner; the base gradient in .panel-shows-flip-back's own CSS
    // still shows through when neither is available.
    const backBannerSrc = row.bannerUrl || row.posterUrl;
    const backBgHtml = backBannerSrc
      ? `<div class="panel-shows-flip-back-bg" style="background-image:url('${backBannerSrc}')"></div>`
      : "";
    return `
      <div class="panel-shows-item" onclick="togglePanelShowsFlip(this)">
        <div class="panel-shows-flip-inner">
          <div class="panel-shows-flip-face panel-shows-flip-front">${thumbHtml}</div>
          <div class="panel-shows-flip-face panel-shows-flip-back">
            ${backBgHtml}
            <div class="list-row-title-wrap">${infoHtml}</div>
          </div>
        </div>
      </div>`;
  }).join("\n");

  const countHtml = `<span class="panel-shows-modal-count">${rows.length} show${rows.length === 1 ? "" : "s"}</span>`;
  overlay.innerHTML = `
    <div class="modal-box panel-shows-modal">
      <div class="episodes-modal-head">
        <div class="list-panel-header">${config.icon}<span>${config.title}</span>${countHtml}</div>
        <button class="modal-close-btn" id="panelShowsModalCloseBtn">&times;</button>
      </div>
      <div class="list-panel panel-shows-grid-wrap">
        <div class="panel-shows-grid">${itemsHtml}</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  pushModalHistoryState(closePanelShowsModal);

  document.getElementById("panelShowsModalCloseBtn").onclick = closePanelShowsModal;
  overlay.addEventListener("click", e => { if (e.target === overlay) closePanelShowsModal(); });
  document.addEventListener("keydown", panelShowsModalEscHandler);
}

// Toggles one poster card between its front (poster) and back (the row's
// own info block, see rowInfoWrapHtml) - stopPropagation on the back
// face's own IMDb link (rowInfoWrapHtml, mode "flip") keeps a click there
// from also re-triggering this and flipping the card back shut.
function togglePanelShowsFlip(itemEl) {
  itemEl.classList.toggle("flipped");
}

function panelShowsModalEscHandler(e) {
  if (e.key === "Escape") closePanelShowsModal();
}

function closePanelShowsModal() {
  const overlay = document.getElementById("panelShowsModalOverlay");
  if (!overlay) return;
  overlay.remove();
  document.removeEventListener("keydown", panelShowsModalEscHandler);
  consumeModalHistoryState();
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
  pushModalHistoryState(closeSearchModal);

  renderSearchStep();

  document.getElementById("searchModalCloseBtn").onclick = closeSearchModal;
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSearchModal(); });
  document.addEventListener("keydown", searchModalEscHandler);
}

function searchModalEscHandler(e) {
  if (e.key === "Escape") closeSearchModal();
}

function closeSearchModal() {
  if (searchModalCloseGuard && !searchModalCloseGuard()) return;
  searchModalCloseGuard = null;
  const overlay = document.getElementById("searchModalOverlay");
  if (!overlay) return;
  document.getElementById("addShowBtn").classList.remove("active");
  overlay.remove();
  document.removeEventListener("keydown", searchModalEscHandler);
  consumeModalHistoryState();
  // Watched marks changed in the episodes manager - the dashboard behind
  // the modal is stale until it re-fetches.
  if (watchedMarksChanged) {
    watchedMarksChanged = false;
    main();
  }
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
  document.removeEventListener("scroll", cardMenuScrollHandler, true);
  cardMenuOpenerBtn = null;
}

function cardMenuEscHandler(e) {
  if (e.key === "Escape") closeCardMenu();
}

function cardMenuOutsideClickHandler(e) {
  const menu = document.getElementById("cardMenuDropdown");
  if (menu && !menu.contains(e.target)) closeCardMenu();
}

// The dropdown is positioned once (position:fixed, computed from the
// button's rect at open time) - scrolling anything afterward, the page
// itself or a panel's own inner scroll container, leaves it either stuck
// in place while its anchor button moves away, or visibly drifting on
// browsers where position:fixed isn't fully reliable during a scroll
// gesture (common on mobile/TV browsers). Simplest robust fix: just close
// it. Listens in the capture phase since scroll events don't bubble, so
// this is the only way to catch scrolling inside a nested container too.
function cardMenuScrollHandler() {
  closeCardMenu();
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
  document.addEventListener("scroll", cardMenuScrollHandler, true);
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
  document.addEventListener("scroll", cardMenuScrollHandler, true);
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

// explicitIndex jumps straight to a known index (used by
// the picker when a thumbnail is chosen)
// instead of stepping by `direction` from the current one - so skipping
// past a broken image doesn't need one cycleImage()+patch per skip.
function cycleImage(source, idx, modeOverride, direction, explicitIndex) {
  const rows = getCycleRows(source);
  const row = rows && rows[idx];
  if (!row) return;
  const mode = modeOverride || getImageMode();
  const cfg = IMAGE_MODE_CONFIG[mode];
  const paths = row[cfg.pathsKey];
  if (!paths || paths.length <= 1) return; // nothing else to switch to
  row[cfg.indexKey] = explicitIndex != null
    ? explicitIndex
    : (row[cfg.indexKey] + (direction || 1) + paths.length) % paths.length;
  const newPath = paths[row[cfg.indexKey]];
  row[cfg.urlKey] = cfg.base + newPath;
  saveImageOverride(row.tmdbId, mode, newPath); // survives the next refresh
  syncImageAcrossCards(row.tmdbId, cfg, row[cfg.indexKey], row[cfg.urlKey]);
  patchImagesForTmdbId(row.tmdbId);
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

// What a given card is actually showing right now, matching the exact
// rule each render function uses (cardImageBits for "main", "whichever
// of banner/poster is present" for the three bottom panels via
// thumbCycleAttrs) - kept in sync with those so a patched <img> always
// shows what a full re-render of that same row would have shown.
function displaySrcFor(source, row) {
  if (source === "main") {
    const mode = getImageMode();
    const cfg = IMAGE_MODE_CONFIG[mode];
    return mode === "banner" ? (row.bannerUrl || row.posterUrl) : row[cfg.urlKey];
  }
  return row.bannerUrl || row.posterUrl;
}

// Updates every currently-rendered <img> for a show directly, in place -
// used after a cycle instead of a full renderRows()/renderAiringRows()
// rebuild. A full rebuild recreates every card's <img> tag across every
// panel, not just the one being cycled, which was flashing every
// thumbnail on screen blank on a single click while they all re-fetched
// (even already-loaded, unrelated) images. The cycled image itself is
// already shown as a thumbnail in the picker, so this swap is quick.
function patchImagesForTmdbId(tmdbId) {
  if (tmdbId == null) return;
  const groups = [
    { source: "main", rows: currentView === "airing" ? airingRows : lastRows },
    { source: "watched", rows: lastRecentlyWatched },
    { source: "plan", rows: lastPlanToWatch },
    { source: "airing", rows: lastAiringPreview },
  ];
  for (const { source, rows } of groups) {
    if (!rows) continue;
    rows.forEach((r, i) => {
      if (!r || r.tmdbId !== tmdbId) return;
      const wrap = document.querySelector(`[data-cycle-key="${source}-${i}"]`);
      const img = wrap && wrap.querySelector(".poster, .list-thumb");
      if (!img) return;
      const newSrc = displaySrcFor(source, r);
      if (newSrc && img.src !== newSrc) img.src = newSrc;
    });
  }
}

// Wired as the onerror handler on every poster/banner <img> (both the top
// carousel card and the three bottom-panel thumbnails) - covers the case
// the picker's own thumbnails can't: a show's *default*
// (never-clicked) image path is itself a broken/stale TMDB URL, so the
// very first render already 404s with nothing to fall back to. Walks
// forward through that show's other paths directly on the live <img>
// (no flip animation - this is a silent self-heal, not a user-driven
// cycle) until one actually loads, tracking attempts on the element
// itself so a show with every path broken settles on the placeholder
// tile instead of looping forever.
function handleThumbError(imgEl, source, idx, mode) {
  const rows = getCycleRows(source);
  const row = rows && rows[idx];
  const cfg = IMAGE_MODE_CONFIG[mode];
  const paths = row ? row[cfg.pathsKey] : null;
  const tried = Number(imgEl.dataset.errAttempts || 0) + 1;
  imgEl.dataset.errAttempts = String(tried);

  if (!row || !paths || !paths.length || tried > paths.length) {
    const placeholder = document.createElement("div");
    placeholder.className = imgEl.className + " placeholder";
    placeholder.textContent = ((row && row.title && row.title[0]) || "?").toUpperCase();
    imgEl.replaceWith(placeholder);
    return;
  }
  const nextIndex = (row[cfg.indexKey] + tried) % paths.length;
  const nextUrl = cfg.base + paths[nextIndex];
  row[cfg.indexKey] = nextIndex;
  row[cfg.urlKey] = nextUrl;
  saveImageOverride(row.tmdbId, mode, paths[nextIndex]);
  syncImageAcrossCards(row.tmdbId, cfg, nextIndex, nextUrl);
  imgEl.src = nextUrl;
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

function imdbButtonHtml(imdbId, rating, ratings) {
  if (!imdbId) return "";
  const url = `https://www.imdb.com/title/${imdbId}/`;
  const ratingHtml = (typeof rating === "number" && !isNaN(rating))
    ? `<span class="imdb-rating">${rating.toFixed(1)}</span>`
    : "";
  // With other ratings to show, hovering opens the popover instead of a
  // plain tooltip (the two would stack) - title="" there stops the
  // poster-wrap's own "Choose a different image" tooltip from bleeding
  // through instead (an absent title falls back to the nearest ancestor's).
  const attr = ratingsAttr(ratings);
  return `<button class="imdb-btn"${attr ? attr + ' title=""' : ' title="Open on IMDb"'}
              onclick="event.stopPropagation(); window.open('${url}', '_blank')">${IMDB_LOGO_SVG_INVERTED}${ratingHtml}</button>`;
}

// Plain (non-link) IMDb pill used inline in the My List card scrim and the
// Plan to Watch list rows - visually distinct from imdbButtonHtml's floating
// corner button (still used by Airing Next).
function imdbPillHtml(rating, imdbId, ratings) {
  const text = (typeof rating === "number" && !isNaN(rating)) ? rating.toFixed(1) : "N/A";
  const inner = `<span class="imdb-pill">IMDb</span><span class="imdb-pill-rating">${text}</span>`;
  if (!imdbId) return inner;
  const url = `https://www.imdb.com/title/${imdbId}/`;
  const attr = ratingsAttr(ratings);
  return `<button class="imdb-pill-btn"${attr || ' title="Open on IMDb"'} onclick="event.stopPropagation(); window.open('${url}', '_blank')">${inner}</button>`;
}

// ---------------------------------------------------------------------
// Ratings UI: source icons, the hover popover, and the tiles in the
// show-detail window
// ---------------------------------------------------------------------
// Small hand-drawn marks, not the official logos.
const RATING_ICON_SVG = {
  imdb: `<svg viewBox="0 0 64 32" width="30" height="15" aria-hidden="true"><rect width="64" height="32" rx="3" fill="#000"/><text x="32" y="23" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="18" fill="#F5C518">IMDb</text></svg>`,
  simkl: `<svg viewBox="0 0 44 16" width="34" height="12" aria-hidden="true"><rect width="44" height="16" rx="3" fill="#0f2a3d"/><text x="22" y="11.7" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="9" fill="#7dd3fc">SIMKL</text></svg>`,
  tmdb: `<svg viewBox="0 0 38 16" width="32" height="13" aria-hidden="true"><rect width="38" height="16" rx="8" fill="#0d253f"/><text x="19" y="11.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="9" fill="#01b4e4">TMDB</text></svg>`,
  trakt: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="#ed1c24"/><path d="M6.6 12.4l3.1 3.1 7.7-7.7M9.7 15.5l-1.6-1.6" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  // Fresh tomato (60%+) and the green splat Rotten Tomatoes uses below that.
  rtFresh: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="13.6" r="8.6" fill="#fa320a"/><path d="M12 5.2c1-1.9 2.6-2.5 4.3-2.1-.9.8-1.2 1.6-1.1 2.5 1.2-.4 2.3-.2 3 .6-1.5.2-2.4.8-2.9 1.6L12 8l-3.3.8c-.5-.8-1.4-1.4-2.9-1.6.7-.8 1.8-1 3-.6.1-.9-.2-1.7-1.1-2.5 1.7-.4 3.3.2 4.3 2.1z" fill="#3ea82a"/></svg>`,
  rtRotten: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 3c1.6 0 2 1.6 3.2 2 1.3.4 3-.5 3.8.8.8 1.3-.5 2.4-.3 3.7.2 1.4 1.9 2.5 1.2 3.9-.7 1.3-2.4.7-3.5 1.5-1.1.9-1 2.7-2.5 3-1.5.3-2.1-1.3-3.4-1.6-1.4-.3-3 .6-3.8-.6-.9-1.3.4-2.5.3-3.8-.1-1.4-1.9-2.2-1.4-3.7.5-1.4 2.3-1 3.4-1.7C10.1 5.4 10.3 3 12 3z" fill="#5bbf3a"/></svg>`,
  popcorn: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="8" cy="8.4" r="3" fill="#ffd24a"/><circle cx="12.2" cy="6.6" r="3.3" fill="#ffe08a"/><circle cx="16.2" cy="8.4" r="3" fill="#ffd24a"/><path d="M5.6 10.4h12.8l-1.5 11H7.1z" fill="#fff"/><path d="M8.6 10.4h2.4l-.4 11H8.2zM13.2 10.4h2.4l.7 11h-2.4z" fill="#e63b2e"/></svg>`,
};

// One entry per source that has a score, in display order.
function ratingEntries(r) {
  if (!r) return [];
  const out = [];
  const tenth = v => v.toFixed(1);
  const pct = v => `${Math.round(v)}%`;
  // Same number with a small, tight % sign, so six tiles fit in a narrow row.
  const pctHtml = v => `${Math.round(v)}<span class="unit">%</span>`;
  if (r.imdb != null) out.push({ key: "imdb", label: "IMDb", icon: RATING_ICON_SVG.imdb, text: tenth(r.imdb), pct: r.imdb * 10, color: "#f5c518" });
  if (r.simkl != null) out.push({ key: "simkl", label: "Simkl", icon: RATING_ICON_SVG.simkl, text: tenth(r.simkl), pct: r.simkl * 10, color: "#7dd3fc" });
  if (r.rtCritics != null) out.push({ key: "rt", label: "Tomatometer", icon: r.rtCritics >= 60 ? RATING_ICON_SVG.rtFresh : RATING_ICON_SVG.rtRotten, text: pct(r.rtCritics), html: pctHtml(r.rtCritics), pct: r.rtCritics, color: "#fa5a3c" });
  if (r.rtAudience != null) out.push({ key: "popcorn", label: "Audience", icon: RATING_ICON_SVG.popcorn, text: pct(r.rtAudience), html: pctHtml(r.rtAudience), pct: r.rtAudience, color: "#f2a93b" });
  if (r.tmdb != null) out.push({ key: "tmdb", label: "TMDB", icon: RATING_ICON_SVG.tmdb, text: tenth(r.tmdb), pct: r.tmdb * 10, color: "#01b4e4" });
  if (r.trakt != null) out.push({ key: "trakt", label: "Trakt", icon: RATING_ICON_SVG.trakt, text: pct(r.trakt), html: pctHtml(r.trakt), pct: r.trakt, color: "#ed4b55" });
  return out;
}

// Shown at the bottom of both views while no MDBList key is set - that's
// what Rotten Tomatoes and Trakt need.
function ratingsKeyHintHtml(entries) {
  if (getConfig().mdblistKey) return "";
  if (entries.some(e => e.key === "rt" || e.key === "trakt")) return "";
  return `<div class="ratings-hint">Add a free MDBList key in Settings for Rotten Tomatoes and Trakt.</div>`;
}

function ratingsAttr(ratings) {
  if (!ratings || ratingEntries(ratings).length < 2) return "";
  return ` data-ratings="${JSON.stringify(ratings).replace(/"/g, "&quot;")}"`;
}

// Same tiles as the show window, so both places read the same way.
function ratingsPopoverHtml(r) {
  return ratingTilesHtml(r);
}

// One shared popover, positioned with fixed coordinates: the poster wrappers
// clip their own overflow, so a popover living inside one would be cut off.
(function wireRatingsPopover() {
  if (!window.matchMedia || !window.matchMedia("(hover: hover)").matches) return; // touch: ratings live in the show window
  let pop = null, anchor = null, hideTimer = null;

  function hide() {
    clearTimeout(hideTimer);
    if (pop) { pop.remove(); pop = null; }
    anchor = null;
  }
  function show(el) {
    clearTimeout(hideTimer);
    if (anchor === el && pop) return;
    let ratings;
    try { ratings = JSON.parse(el.getAttribute("data-ratings")); } catch (e) { return; }
    hide();
    anchor = el;
    pop = document.createElement("div");
    pop.className = "ratings-popover";
    pop.innerHTML = ratingsPopoverHtml(ratings);
    // Laid out to fit whatever the pill sits on, so it never spills over the
    // neighbouring card: a poster or banner gets one row of tiles across its
    // full width, a Plan-to-Watch style row (thumbnail + text) three columns
    // spread across the whole row.
    const box = el.closest(".poster-wrap") || el.closest(".list-row") || el.closest(".card");
    const b = (box || el).getBoundingClientRect();
    const mode = box && box.classList.contains("list-row") ? "list" : "banner";
    pop.className = `ratings-popover rp-${mode}`;
    // In a thumbnail + text row the popover covers only the text side, so the
    // picture stays visible.
    const textBox = mode === "list" ? el.closest(".list-row-title-wrap") : null;
    const tb = textBox ? textBox.getBoundingClientRect() : b;
    pop.style.width = `${Math.max(150, mode === "list" ? tb.width : b.width - 16)}px`;
    if (mode === "banner") {
      const n = pop.querySelectorAll(".rating-tile").length;
      pop.querySelector(".rating-tiles").style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
    }
    document.body.appendChild(pop);
    const a = el.getBoundingClientRect(), p = pop.getBoundingClientRect();
    let top = a.top - p.height - 6;
    if (mode === "list") top = b.top + Math.max(0, (b.height - p.height) / 2); // centred on the row
    else if (box && box.classList.contains("list-row")) top = Math.max(top, b.top + 4); // inside the row
    else if (box && box.classList.contains("poster-wrap")) top = Math.max(top, b.top + 6); // on the image
    else if (top < 8) top = a.bottom + 6;        // no room above: open below
    const left = Math.max(8, Math.min(mode === "list" ? tb.left : b.left + 8, window.innerWidth - p.width - 8));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  }
  document.addEventListener("mouseover", e => {
    const el = e.target.closest && e.target.closest("[data-ratings]");
    if (el) show(el);
    else if (pop && !(e.target.closest && e.target.closest(".ratings-popover"))) scheduleHide();
  });
  document.addEventListener("focusin", e => {
    const el = e.target.closest && e.target.closest("[data-ratings]");
    if (el) show(el);
  });
  document.addEventListener("focusout", scheduleHide);
  document.addEventListener("scroll", hide, true);
})();

function ratingTilesHtml(r) {
  const entries = ratingEntries(r);
  if (!entries.length) return "";
  return `<div class="rating-tiles">${entries.map(e => `
    <div class="rating-tile" style="--c:${e.color}">
      <div class="rt-icon">${e.icon}</div>
      <div class="rt-text">
        <div class="rt-val">${e.html || e.text}</div>
        <div class="rt-label">${e.label}</div>
      </div>
    </div>`).join("")}</div>${ratingsKeyHintHtml(entries)}`;
}

// Fills the ratings block under a show's header in the search window. Works
// for any show (not just ones on the list): SIMKL id -> its rating, TMDB id
// -> TMDB score, IMDb id -> MDBList. Whatever's missing is just left out.
async function fillDetailRatings(show, libraryMatch) {
  const el = document.getElementById("detailRatings");
  if (!el) return;
  const ids = show.ids || {};
  const libIds = (libraryMatch && libraryMatch.item.show && libraryMatch.item.show.ids) || {};
  const simklId = ids.simkl || libIds.simkl;
  const tmdbId = ids.tmdb || libIds.tmdb;
  const imdbId = ids.imdb || libIds.imdb;
  try {
    const showDetail = tmdbId && sharedCache ? await sharedCache.getShow(tmdbId) : null;
    const recent = isRecentShow(showDetail && showDetail.first_air_date);
    const simklData = simklId && sharedRatingsCache ? await sharedRatingsCache.get(simklId, simklToken, recent) : null;
    const ratings = await loadRatings(simklData, showDetail && showDetail.vote_average, imdbId, recent);
    if (!el.isConnected) return; // navigated away while loading
    el.innerHTML = ratingTilesHtml(ratings);
  } catch (e) {
    if (el.isConnected) el.innerHTML = "";
  }
}

const CLOCK_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
// Solid/filled variant of the clock, used only for the RECENTLY WATCHED
// panel header (bold-underline style) - CLOCK_ICON_SVG above stays outline
// since it's also reused for the top card's inline "time left" icon, which
// wasn't part of this redesign. The "hands" are cut out using the card
// background color rather than a real transparent hole.
const CLOCK_ICON_SOLID_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="9" fill="var(--accent2)"></circle><rect x="11.2" y="6" width="1.6" height="6.5" rx="0.8" fill="var(--card)"></rect><rect x="11.6" y="11.3" width="4.2" height="1.6" rx="0.8" fill="var(--card)" transform="rotate(35 12 12)"></rect></svg>`;
// Same gold-circle-with-cutout language as the clock above, used only for
// the "Episodes Left" modal header - a list reads as "what's inside" more
// directly than a clock does.
const LIST_ICON_SOLID_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="9" fill="var(--gold)"></circle><rect x="6.5" y="8.2" width="1.8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="9.5" y="8.2" width="8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="6.5" y="11.1" width="1.8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="9.5" y="11.1" width="8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="6.5" y="14" width="1.8" height="1.8" rx="0.4" fill="var(--card)"></rect><rect x="9.5" y="14" width="8" height="1.8" rx="0.4" fill="var(--card)"></rect></svg>`;
// Same gold-circle-with-cutout language again, used only for the Cast
// modal header - a head-and-shoulders silhouette.
const CAST_ICON_SOLID_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="9" fill="var(--gold)"></circle><circle cx="12" cy="9.3" r="2.6" fill="var(--card)"></circle><path d="M6.3 17.2c0-3.1 2.6-4.4 5.7-4.4s5.7 1.3 5.7 4.4" fill="var(--card)"></path></svg>`;
// Stat-row icons for the top card's header: a TV screen for "Series", a
// stack of layers ("a pile of episodes") for "Episodes Left", and a
// clock for "Watch Time Left" - same stroke language as the rest of the
// app's line icons.
const STAT_TV_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="13" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="18" x2="12" y2="21"></line></svg>`;
const STAT_STACK_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 21 8 12 13 3 8 12 3"></polygon><polyline points="3 12 12 17 21 12"></polyline><polyline points="3 16 12 21 21 16"></polyline></svg>`;
const STAT_CLOCK_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--accent2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.25"></circle><polyline points="12 7 12 12 15.5 14"></polyline></svg>`;
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const BELL_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"></path><path d="M10 20a2 2 0 0 0 4 0"></path></svg>`;
const STAR_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 14.7 9.2 21.4 9.8 16.3 14.2 17.9 20.8 12 17.3 6.1 20.8 7.7 14.2 2.6 9.8 9.3 9.2"></polygon></svg>`;
const BOOKMARK_ICON_SVG = `<svg viewBox="0 0 24 24" width="17" height="17" fill="var(--accent2)"><path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.5.5 0 0 1-.77.42L12 16.5l-5.73 4.12a.5.5 0 0 1-.77-.42V4a.5.5 0 0 1 .5-.5z"></path></svg>`;
const CALENDAR_ICON_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><rect x="3" y="5" width="18" height="16" rx="2" fill="var(--accent2)"></rect><rect x="3" y="9" width="18" height="1.8" fill="var(--card)"></rect><rect x="7" y="2.5" width="1.8" height="4" rx="0.9" fill="var(--card)"></rect><rect x="15.2" y="2.5" width="1.8" height="4" rx="0.9" fill="var(--card)"></rect></svg>`;
// Same "pile of episodes" stack icon as the top stat row, in black to sit
// on the remaining-badge's yellow background.
const STAT_STACK_ICON_BLACK_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#000000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 3 21 8 12 13 3 8 12 3"></polygon><polyline points="3 12 12 17 21 12"></polyline><polyline points="3 16 12 21 21 16"></polyline></svg>`;
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
    ? `<img class="${posterClass}" src="${imageUrl}" alt="${row.title}" onerror="handleThumbError(this, 'main', ${arrIdx}, '${mode}')">`
    : `<div class="${posterClass} placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
  const altCount = (row[cfg.pathsKey] || []).length;
  const cycleable = altCount > 1 || !!row.imdbId;
  const cycleAttrs = cycleable
    ? ` data-cycle-key="main-${arrIdx}" title="Choose a different image" onclick="openImagePicker('main', ${arrIdx}, '${mode}')"`
    : "";
  // Network logo sits in the corner when known - the dark scrim keeps
  // colorful logos from blending into bright poster art underneath. Falls
  // back to "#N" live if the logo image itself 404s (data exists, just
  // failed to load); leaves the corner empty when there's no known network
  // at all, rather than showing a ranking number as a stand-in.
  // title="" on every badge below suppresses the poster-wrap's own
  // "Choose a different image" tooltip from bleeding through while
  // hovering a badge that sits on top of it - without it, an empty title
  // falls back to the nearest ancestor's title instead of showing nothing.
  const badgeHtml = row.networkLogoPath
    ? `<div class="badge network-badge" data-idx="${row.index}" title="">
        <img class="network-badge-logo" src="${row.networkLogoPath}" alt="${row.network || ""}"
          onerror="this.parentElement.classList.add('logo-failed')">
      </div>`
    : "";
  // Year range in the opposite top corner - also doubles as an at-a-glance
  // "has this ended" signal, since an open-ended show has no end year yet
  // ("2016-") while one that's wrapped up shows the full range.
  const yearBadgeHtml = row.yearRangeLabel
    ? `<div class="badge year-corner-badge" title="">${row.yearRangeLabel.replace("-", '<span class="year-badge-dash">-</span>')}</div>`
    : "";
  const wrapHtml = `<div class="poster-wrap${cycleable ? " cycleable" : ""}"${cycleAttrs}>${badgeHtml}${yearBadgeHtml}${posterHtml}${extraOverlayHtml || ""}</div>`;
  return { wrapHtml };
}

// Clicking a poster/banner opens this window with every image available for
// the show, to pick one from. Which kind is decided by what was clicked: a
// bottom-panel thumbnail and a top card in banner mode list banners only, a
// top card in poster mode lists posters only (`mode`).
//
// TMDB's candidates are already in memory (row.posterPaths / row.backdropPaths,
// from the same response that drew the card), so they cost no API request -
// only the small thumbnails, loaded lazily as the grid scrolls. More images
// from other free, keyless sources (see fetchExtraImages) are fetched when
// the window opens and slot in below, each tagged with where it came from.
// A pick is only applied when Done is pressed.
const TMDB_PICKER_THUMB_POSTER = "https://image.tmdb.org/t/p/w185";
const TMDB_PICKER_THUMB_BACKDROP = "https://image.tmdb.org/t/p/w300";
const CACHE_TTL_EXTRA_IMAGES_MS = 7 * 24 * 60 * 60 * 1000;

// wsrv.nl: a free, caching image resizer. Some sources only serve huge
// originals (TVMaze backgrounds are 1920x1080, 400-500 KB each), which would
// make a gallery of them slow and heavy - resized, a thumbnail is ~8 KB and
// the banner actually shown ~45 KB.
function resizedImage(url, width) {
  return `https://wsrv.nl/?output=jpg&q=75&w=${width}&url=${encodeURIComponent(url)}`;
}

// Extra posters/backgrounds for a show, from sources that need no API key.
// Returns { poster, banner, tvdbId }; the lists hold { url, thumb, src }:
// `url` is what's shown on the card once picked, `thumb` what the gallery shows.
//   - TVMaze: many posters and 16:9 backgrounds (found by IMDb id).
//   - Metahub: at most one poster and one background, and it doesn't have
//     every show (a tile whose image fails to load is simply dropped).
// Cached for a week per show; a network failure isn't cached.
async function fetchKeylessImages(imdbId) {
  const out = { poster: [], banner: [], tvdbId: null };
  if (!imdbId) return out;
  const cacheKey = `extraimages:${imdbId}`;
  const cached = readPersistedCache(cacheKey, CACHE_TTL_EXTRA_IMAGES_MS);
  if (cached !== undefined) return cached;
  try {
    const lookup = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId}`);
    if (lookup.ok) {
      const show = await lookup.json();
      out.tvdbId = (show.externals && show.externals.thetvdb) || null; // lets Fanart.tv find the show too
      const res = await fetch(`https://api.tvmaze.com/shows/${show.id}/images`);
      if (res.ok) {
        for (const img of await res.json()) {
          const original = img.resolutions && img.resolutions.original && img.resolutions.original.url;
          if (!original) continue;
          if (img.type === "poster") {
            const medium = img.resolutions.medium && img.resolutions.medium.url;
            out.poster.push({ url: resizedImage(original, 342), thumb: medium || resizedImage(original, 200), src: "TVMaze" });
          } else if (img.type === "background") {
            out.banner.push({ url: resizedImage(original, 780), thumb: resizedImage(original, 300), src: "TVMaze" });
          }
        }
      }
    } else if (lookup.status !== 404) {
      return out; // TVMaze hiccup: show what we have, try again next time
    }
  } catch (e) {
    return out; // offline / blocked
  }
  const meta = `https://images.metahub.space`;
  out.poster.push({ url: resizedImage(`${meta}/poster/medium/${imdbId}/img`, 342), thumb: `${meta}/poster/small/${imdbId}/img`, src: "Metahub" });
  out.banner.push({ url: resizedImage(`${meta}/background/medium/${imdbId}/img`, 780), thumb: resizedImage(`${meta}/background/medium/${imdbId}/img`, 300), src: "Metahub" });
  writePersistedCache(cacheKey, out);
  return out;
}

// Fanart.tv: community-curated artwork, by far the richest of the extra
// sources (Dexter: 12 posters, 36 backgrounds, 23 wide thumbs). Needs a free
// key from fanart.tv (Settings) and the show's TheTVDB id; without either it
// simply contributes nothing. It hands out full-size originals (a poster is
// >1 MB) plus a small /preview/ variant for the gallery.
const CACHE_TTL_FANART_MS = 7 * 24 * 60 * 60 * 1000;
let fanartKeyRejected = false;
async function fetchFanartImages(tvdbId) {
  const out = { poster: [], banner: [] };
  const key = getConfig().fanartKey;
  if (!key || !tvdbId || fanartKeyRejected) return out;
  const cacheKey = `fanart:${tvdbId}`;
  const cached = readPersistedCache(cacheKey, CACHE_TTL_FANART_MS);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(`https://webservice.fanart.tv/v3/tv/${tvdbId}?api_key=${encodeURIComponent(key)}`);
    if (res.status === 401 || res.status === 403) {
      fanartKeyRejected = true;
      showToast("Fanart.tv rejected the API key - check it in Settings.", true);
      return out;
    }
    if (res.status === 404) { writePersistedCache(cacheKey, out); return out; } // not in their database
    if (!res.ok) return out;
    const d = await res.json();
    const usable = x => x && x.url;
    const english = x => !x.lang || x.lang === "en" || x.lang === "00";
    const byLikes = (a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0);
    const preview = u => u.replace("/fanart/", "/preview/");
    for (const img of (d.tvposter || []).filter(usable).filter(english).sort(byLikes)) {
      out.poster.push({ url: resizedImage(img.url, 342), thumb: preview(img.url), src: "Fanart.tv" });
    }
    // Backgrounds and the 16:9 "thumbs" both work as banners.
    for (const img of (d.showbackground || []).concat(d.tvthumb || []).filter(usable).sort(byLikes)) {
      out.banner.push({ url: resizedImage(img.url, 780), thumb: preview(img.url), src: "Fanart.tv" });
    }
    writePersistedCache(cacheKey, out);
  } catch (e) {
    // offline / blocked: no Fanart.tv images this time
  }
  return out;
}

// All extra images for the picker: Fanart.tv first (curated), then TVMaze
// and Metahub.
async function fetchExtraImages(imdbId, tmdbId) {
  const keyless = await fetchKeylessImages(imdbId);
  let tvdbId = keyless.tvdbId;
  if (!tvdbId && tmdbId && sharedCache && getConfig().fanartKey) {
    const detail = await sharedCache.getShow(tmdbId); // already cached; carries external_ids
    tvdbId = detail && detail.external_ids && detail.external_ids.tvdb_id;
  }
  const fanart = await fetchFanartImages(tvdbId);
  return { poster: fanart.poster.concat(keyless.poster), banner: fanart.banner.concat(keyless.banner) };
}

// Applies a pick that isn't one of TMDB's numbered candidates: same effect as
// cycleImage (every card showing the show updates, the choice is stored for
// the next visit) but keyed by the picture's full URL instead of an index.
function applyExternalImage(source, idx, mode, url) {
  const row = (getCycleRows(source) || [])[idx];
  if (!row) return;
  const cfg = IMAGE_MODE_CONFIG[mode];
  row[cfg.indexKey] = -1; // not one of the TMDB candidates
  row[cfg.urlKey] = url;
  saveImageOverride(row.tmdbId, mode, url);
  syncImageAcrossCards(row.tmdbId, cfg, -1, url);
  patchImagesForTmdbId(row.tmdbId);
}

function openImagePicker(source, idx, mode) {
  const row = (getCycleRows(source) || [])[idx];
  if (!row) return;
  const cfg = IMAGE_MODE_CONFIG[mode];
  const paths = row[cfg.pathsKey] || [];
  if (paths.length < 2 && !row.imdbId) return; // nothing to choose between
  closeImagePicker();

  const thumbBase = mode === "banner" ? TMDB_PICKER_THUMB_BACKDROP : TMDB_PICKER_THUMB_POSTER;
  const noun = mode === "banner" ? "banner" : "poster";
  const year = row.year || (row.yearRangeLabel || "").slice(0, 4);
  // Nothing is applied to the card until Done: clicking a tile only selects
  // it (pendingUrl / pendingEntry), and the big image on the side previews
  // that selection. Closing any other way discards it.
  const originalUrl = row[cfg.urlKey];
  let pendingUrl = originalUrl;
  let pendingEntry = null;
  const previewSrc = originalUrl || row.posterUrl;
  const identityHtml = previewSrc
    ? `<img id="imagePickerPreview" src="${previewSrc}" alt="${row.title}">`
    : `<div class="picker-ident-placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
  const tmdbEntries = paths.map((p, i) => ({ url: cfg.base + p, thumb: thumbBase + p, index: i }));
  let extras = [];
  let extrasState = row.imdbId ? "loading" : "done";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "imagePickerOverlay";
  const headerEl = document.querySelector("header");
  overlay.style.paddingTop = `${(headerEl ? headerEl.offsetHeight : 0) + 24}px`;
  overlay.innerHTML = `
    <div class="modal-box picker-box">
      <div class="picker-head">
        <span class="picker-title">Choose ${noun}</span>
        <button class="modal-close-btn" id="imagePickerCloseBtn">&times;</button>
      </div>
      <div class="picker-cols">
        <div class="picker-ident">
          <div class="picker-ident-img is-${noun}">${identityHtml}</div>
          <div class="picker-ident-name">${row.title}</div>
          ${year ? `<div class="picker-ident-year">${year}</div>` : ""}
        </div>
        <div class="picker-main">
          <div class="picker-count" id="imagePickerCount"></div>
          <div class="picker-grid is-${noun}" id="imagePickerGrid"></div>
        </div>
      </div>
      <div class="picker-foot">
        <span>Your pick is applied when you press Done</span>
        <button class="picker-done" id="imagePickerDoneBtn">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  pushModalHistoryState(closeImagePicker);

  const grid = document.getElementById("imagePickerGrid");
  const countEl = document.getElementById("imagePickerCount");
  const all = () => tmdbEntries.concat(extras);
  function renderCount() {
    const more = extrasState === "loading" ? " · loading more…"
      : extras.length ? ` · ${extras.length} more from other sources` : "";
    countEl.textContent = `${tmdbEntries.length} ${noun}s${more}`;
  }
  function renderGrid() {
    const scroll = grid.scrollTop;
    const current = pendingUrl;
    grid.innerHTML = all().map((e, i) => `
      <button class="picker-th${e.url === current ? " cur" : ""}" data-i="${i}" aria-label="${noun} ${i + 1}">
        <img loading="lazy" alt="" src="${e.thumb}" onerror="this.closest('.picker-th').remove()">
        ${e.url === current ? `<span class="picker-tag">${e.url === originalUrl ? "Current" : "Selected"}</span>` : ""}
        ${e.src ? `<span class="picker-src">${e.src}</span>` : ""}
      </button>`).join("");
    grid.scrollTop = scroll;
    renderCount();
  }
  renderGrid();

  grid.onclick = e => {
    const btn = e.target.closest(".picker-th");
    if (!btn) return;
    const entry = all()[Number(btn.dataset.i)];
    if (!entry || entry.url === pendingUrl) return;
    pendingEntry = entry;
    pendingUrl = entry.url;
    const preview = document.getElementById("imagePickerPreview");
    if (preview) preview.src = entry.url;
    renderGrid();
  };

  if (row.imdbId) {
    fetchExtraImages(row.imdbId, row.tmdbId).then(found => {
      if (!overlay.isConnected) return; // closed while loading
      extras = found[mode] || [];
      extrasState = "done";
      renderGrid();
    });
  }

  document.getElementById("imagePickerCloseBtn").onclick = closeImagePicker;
  document.getElementById("imagePickerDoneBtn").onclick = () => {
    if (pendingEntry && pendingUrl !== originalUrl) {
      if (pendingEntry.index != null) cycleImage(source, idx, mode, 1, pendingEntry.index);
      else applyExternalImage(source, idx, mode, pendingEntry.url);
    }
    closeImagePicker();
  };
  overlay.addEventListener("click", e => { if (e.target === overlay) closeImagePicker(); });
  document.addEventListener("keydown", imagePickerEscHandler);
}

function imagePickerEscHandler(e) {
  if (e.key === "Escape") closeImagePicker();
}

function closeImagePicker() {
  const overlay = document.getElementById("imagePickerOverlay");
  if (!overlay) return;
  overlay.remove();
  document.removeEventListener("keydown", imagePickerEscHandler);
  consumeModalHistoryState();
}

// Computes the click-to-open-the-image-picker wrapper attributes for a bottom-panel
// thumbnail (Recently Watched / Plan to Watch / Airing Next), matching the
// same convention cardImageBits uses for the top carousel card.
//
// These thumbnails always show the banner if the show has one (falling
// back to the poster) regardless of the sidebar's poster/banner toggle -
// so the picker has to list whichever of the two is actually on screen,
// not blindly follow getImageMode() (which governs the top carousel and
// may point at the other, unrelated image type).
function thumbCycleAttrs(row, source, idx) {
  const mode = row.bannerUrl ? "banner" : "poster";
  const cfg = IMAGE_MODE_CONFIG[mode];
  const altCount = (row[cfg.pathsKey] || []).length;
  if (altCount <= 1 && !row.imdbId) return { cycleableClass: "", attrs: "", mode };
  return {
    cycleableClass: " cycleable",
    attrs: ` data-cycle-key="${source}-${idx}" title="Choose a different image" onclick="openImagePicker('${source}', ${idx}, '${mode}')"`,
    mode,
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

// Right-aligned show count for a bottom panel's header row - same
// margin-left:auto trick as .series-panel-updated in the top carousel's
// own header, just reused here instead of duplicated. Doubles as the
// entry point into that panel's "all shows" modal (openPanelShowsModal).
function listPanelCountHtml(count, source) {
  return `<button type="button" class="list-panel-count" onclick="openPanelShowsModal('${source}')"><span class="list-panel-count-num">${count}</span> SHOW${count === 1 ? "" : "S"}</button>`;
}

// Exact inner content of a row's .list-row-title-wrap, factored out of the
// three render*Html functions below so the "all shows" modal's flip-card
// back face (openPanelShowsModal) can show precisely the same info as the
// show's own row instead of a second, drift-prone copy of this markup.
// mode "row" is the row's own title (opens the cast modal, as always);
// mode "flip" is the flip-card back face's title (an IMDb link instead,
// since the cast modal doesn't make sense floating over a poster grid).
function rowInfoWrapHtml(row, idx, source, mode) {
  const titleHtml = mode === "flip"
    ? (row.imdbId
        ? `<div class="list-row-title"><a href="https://www.imdb.com/title/${row.imdbId}/" target="_blank" rel="noopener" onclick="event.stopPropagation()">${row.title}</a></div>`
        : `<div class="list-row-title">${row.title}</div>`)
    : `<div class="list-row-title" title="View cast" onclick="event.stopPropagation(); openCastModal('${source}', ${idx})">${row.title}</div>`;

  if (source === "watched") {
    const episodeCode = `S${String(row.season).padStart(2, "0")}E${String(row.episode).padStart(2, "0")}`;
    const episodeTitleHtml = row.episodeTitle ? `<div class="episode-title">${row.episodeTitle}</div>` : "";
    const badgeModifier = row.badge === "SEASON FINALE" ? " finale" : row.badge === "DROPPED" ? " dropped" : "";
    const badgeHtml = row.badge ? `<div class="premiere-badge${badgeModifier}">${row.badge}</div>` : "";
    return `
      ${titleHtml}
      ${networkSubHtml(row.network, row.networkLogoPath)}
      <div class="next-up-row">
        <div class="list-row-sub episode-code-sub">${episodeCode}</div>
        ${badgeHtml}
      </div>
      ${episodeTitleHtml}`;
  }

  if (source === "plan") {
    const badgeHtml = row.airedLabel
      ? `<div class="premiere-badge${row.ended ? " finale" : ""}">${row.airedLabel}</div>`
      : "";
    const yearBadgeHtml = row.yearRangeLabel
      ? `<div class="premiere-badge year-badge">${row.yearRangeLabel}</div>`
      : "";
    const contentMetaHtml = (row.contentRating || row.genreLabel)
      ? `<div class="content-meta-row">
          ${row.contentRating ? `<span class="content-rating-badge">${row.contentRating}</span>` : ""}
          ${row.genreLabel ? `<span class="genre-label">${row.genreLabel}</span>` : ""}
        </div>`
      : "";
    return `
      <div class="title-with-year">
        ${titleHtml}
        ${yearBadgeHtml}
      </div>
      ${networkSubHtml(row.network, row.networkLogoPath)}
      ${badgeHtml}
      <div class="list-imdb">${imdbPillHtml(row.imdbRating, row.imdbId, row.ratings)}</div>
      ${contentMetaHtml}`;
  }

  if (source === "main" && currentView !== "airing") {
    // The top panel's own "My Watch List" row shape (renderRows) - a
    // progress/remaining-episode count instead of an "aired" badge, no
    // genre/content-rating (that's Plan to Watch only).
    const episodeTitleHtml = row.episodeTitle ? `<div class="episode-title">${row.episodeTitle}</div>` : "";
    const badgeHtml = row.badge
      ? `<div class="premiere-badge${row.badge === "SEASON FINALE" ? " finale" : ""}">${row.badge}</div>`
      : "";
    const remainingText = row.remaining === 1 ? "1 episode left" : `${row.remaining} episodes left`;
    return `
      ${titleHtml}
      ${networkSubHtml(row.network, row.networkLogoPath)}
      <div class="next-up-row">
        <span class="next-up">Next: ${row.nextLabel}</span>
        ${badgeHtml}
      </div>
      ${episodeTitleHtml}
      <div class="list-row-sub">${remainingText}</div>
      <div class="list-imdb">${imdbPillHtml(row.imdbRating, row.imdbId, row.ratings)}</div>`;
  }

  // source === "airing", or source === "main" while showing the Airing
  // Next view (renderAiringRows) - both share the exact same row shape.
  const episodeTitle = row.nextEpisodeTitle ? `<div class="episode-title">${row.nextEpisodeTitle}</div>` : "";
  const badgeHtml = row.badge
    ? `<div class="premiere-badge${row.badge === "SEASON FINALE" ? " finale" : ""}">${row.badge}</div>`
    : "";
  return `
    ${titleHtml}
    ${networkSubHtml(row.network, row.networkLogoPath)}
    <div class="next-up-row">
      <span class="next-up">Next: ${row.nextLabel}</span>
      ${badgeHtml}
    </div>
    ${episodeTitle}
    <div class="list-row-airdate">&#128197; ${row.airDateLabel}</div>`;
}

function renderRecentlyWatchedHtml(list) {
  if (!list || !list.length) return "";
  const rowsHtml = list.map((ep, idx) => {
    const bannerSrc = ep.bannerUrl || ep.posterUrl;
    const { cycleableClass, attrs, mode } = thumbCycleAttrs(ep, "watched", idx);
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" src="${bannerSrc}" alt="${ep.title}" onerror="handleThumbError(this, 'watched', ${idx}, '${mode}')">`
      : `<div class="list-thumb placeholder">${(ep.title[0] || "?").toUpperCase()}</div>`;
    return `
      <div class="list-row">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}</div>
        <div class="list-row-title-wrap">${rowInfoWrapHtml(ep, idx, "watched", "row")}</div>
        <span class="list-check">${CHECK_ICON_SVG}</span>
      </div>`;
  }).join("\n");

  return `
    <div class="list-panel list-panel--watched">
      <div class="list-panel-header-row">
        <div class="list-panel-header">${CLOCK_ICON_SOLID_SVG}<span>RECENTLY WATCHED</span></div>
        ${listPanelCountHtml(list.length, "watched")}
      </div>
      <div class="list-rows-scroll">${rowsHtml}</div>
    </div>`;
}

function renderPlanToWatchHtml(list) {
  if (!list || !list.length) return "";
  const rowsHtml = list.map((row, idx) => {
    const bannerSrc = row.bannerUrl || row.posterUrl;
    const { cycleableClass, attrs, mode } = thumbCycleAttrs(row, "plan", idx);
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" src="${bannerSrc}" alt="${row.title}" onerror="handleThumbError(this, 'plan', ${idx}, '${mode}')">`
      : `<div class="list-thumb placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
    return `
      <div class="list-row">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}</div>
        <div class="list-row-title-wrap">${rowInfoWrapHtml(row, idx, "plan", "row")}</div>
        <span class="list-check">${STAR_ICON_SVG}</span>
        <button class="card-menu-btn plan-menu-btn" title="Manage" onclick="event.stopPropagation(); openPlanCardMenu(${idx}, this)">&#8942;</button>
      </div>`;
  }).join("\n");

  return `
    <div class="list-panel list-panel--plan">
      <div class="list-panel-header-row">
        <div class="list-panel-header">${BOOKMARK_ICON_SVG}<span>PLAN TO WATCH</span></div>
        ${listPanelCountHtml(list.length, "plan")}
      </div>
      <div class="list-rows-scroll">${rowsHtml}</div>
    </div>`;
}

function renderAiringNextPreviewHtml(list) {
  if (!list || !list.length) return "";
  const rowsHtml = list.map((row, idx) => {
    const bannerSrc = row.bannerUrl || row.posterUrl;
    const { cycleableClass, attrs, mode } = thumbCycleAttrs(row, "airing", idx);
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" src="${bannerSrc}" alt="${row.title}" onerror="handleThumbError(this, 'airing', ${idx}, '${mode}')">`
      : `<div class="list-thumb placeholder">${(row.title[0] || "?").toUpperCase()}</div>`;
    return `
      <div class="list-row">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}</div>
        <div class="list-row-title-wrap">${rowInfoWrapHtml(row, idx, "airing", "row")}</div>
        <span class="list-check">${BELL_ICON_SVG}</span>
      </div>`;
  }).join("\n");

  return `
    <div class="list-panel list-panel--airing">
      <div class="list-panel-header-row">
        <div class="list-panel-header">${CALENDAR_ICON_SVG}<span>AIRING NEXT</span></div>
        ${listPanelCountHtml(list.length, "airing")}
      </div>
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
  safeSetItem(LS_VIEW_MODE, "list");
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
  const carouselCardWidth = isWide ? 368 : 259;
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
    const overlayHtml = imdbButtonHtml(row.imdbId, row.imdbRating, row.ratings) + `<div class="remaining-badge" title="">${STAT_STACK_ICON_BLACK_SVG}${remainingText}</div>`;
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
          <button type="button" class="series-panel-stat-group series-panel-stat-clickable" onclick="openPanelShowsModal('main')">
            ${STAT_TV_ICON_SVG}
            <div class="series-panel-stat"><span class="num">${rows.length}</span><span class="label">Shows</span></div>
          </button>
          <div class="stats-divider"></div>
          <div class="series-panel-stat-group">
            ${STAT_STACK_ICON_SVG}
            <div class="series-panel-stat"><span class="num">${totalRemainingEps}</span><span class="label">Episodes Left</span></div>
          </div>
          <div class="stats-divider"></div>
          <div class="series-panel-stat-group">
            ${STAT_CLOCK_ICON_SVG}
            <div class="series-panel-stat"><span class="num">${totalHours}h ${totalMins}m</span><span class="label">Watch Time Left</span></div>
          </div>
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
  safeSetItem(LS_VIEW_MODE, "airing");
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
    const { wrapHtml } = cardImageBits(row, mode, arrIdx, imdbButtonHtml(row.imdbId, row.imdbRating, row.ratings));
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
  const { clientId, clientIdV2, tmdbKey } = getConfig();
  if ((!clientId && !clientIdV2) || !tmdbKey) {
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
  safeSetItem(LS_IMAGE_MODE, nextImageMode(current));
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

// Same click-and-drag pattern as enableCarouselDragScroll above, just
// vertical and targeting the three bottom panels' row lists instead of the
// horizontal top carousel - .list-rows-scroll gets replaced wholesale on
// every re-render, so this delegates from the stable `app` root rather
// than binding to elements that won't exist after the next refresh.
(function enableListPanelsDragScroll() {
  let dragTrack = null;
  let startY = 0;
  let startScrollTop = 0;
  let dragged = false;

  app.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const track = e.target.closest(".list-rows-scroll");
    if (!track) return;
    dragTrack = track;
    dragged = false;
    startY = e.pageY;
    startScrollTop = track.scrollTop;
    track.classList.add("dragging");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragTrack) return;
    const dy = e.pageY - startY;
    if (Math.abs(dy) > 4) dragged = true;
    dragTrack.scrollTop = startScrollTop - dy;
  });

  document.addEventListener("mouseup", () => {
    if (!dragTrack) return;
    dragTrack.classList.remove("dragging");
    dragTrack = null;
  });

  app.addEventListener("click", (e) => {
    if (dragged && e.target.closest(".list-rows-scroll")) {
      e.stopPropagation();
      e.preventDefault();
    }
    dragged = false;
  }, true);
})();

prunePersistedCache();
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
