"use strict";

// The library: sign-in, the store and its saving, shared air times, Emby's
// live state, and the Watching clean-up.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// ---------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------
// The user's own library - Firestore behind a Google sign-in
// (library-store.js, firebase-backend.js) - with episode lists from TVMaze /
// TMDB (episode-source.js). library-adapter.js answers in the item shape
// the row builders below were written against (SIMKL's /sync/all-items
// format, from before the move off SIMKL).
// { backend, store, source, adapter, bridge } - the store, adapter and
// bridge exist once signed in and loaded.
let library = null;

// Only the TVMaze and SIMKL parts of the episode lists go to disk
// (IndexedDB): the TMDB requests the episode source makes go through the
// app's own TmdbCache (see libraryTmdbGet), which already persists them.
let libraryCache = null;
function libraryListCache() {
  if (!libraryCache) {
    libraryCache = LibraryAdapter.idbCache({ persist: key => key.startsWith("tvmaze-") || key.startsWith("simkl-") || key.startsWith("yes-") });
  }
  return libraryCache;
}

// One pace for every TVMaze call on the page (about 20 per 10 seconds per
// address is all it allows): the episode lists and the image picker each
// take the next free slot, so a picker opened while the lists load slots in
// between them instead of being turned away.
const TVMAZE_GAP_MS = 520;
let tvmazeNextAt = 0;
function tvmazeSlot() {
  const now = Date.now();
  const at = Math.max(now, tvmazeNextAt);
  tvmazeNextAt = at + TVMAZE_GAP_MS;
  return at > now ? new Promise(r => setTimeout(r, at - now)) : Promise.resolve();
}
async function pacedFetch(url, options) {
  if (String(url).startsWith("https://api.tvmaze.com/")) await tvmazeSlot();
  return fetch(url, options);
}

function libraryEpisodeSource() {
  return EpisodeSource.createEpisodeSource({
    fetch: (...args) => pacedFetch(...args),
    tmdbGet: libraryTmdbGet,
    cache: libraryListCache(),
    useUpdates: true,
  });
}

// Air times from SIMKL for episodes the lists know only the date of (see
// air-times.js): the computer's Emby bridge signs in to SIMKL, takes them,
// and keeps them in the account (meta "airTimes"), so every device - the
// phone app too - shows the same times without a SIMKL sign-in of its own.
function libraryAirTimes() {
  return async (ids, eps) => {
    const shared = await sharedAirTimes();
    return AirTimes.applySharedTimes(eps, shared && shared[AirTimes.sharedKey(ids)]);
  };
}

// Air times from yes's TV guide for Israeli shows (see yes-times.js); the
// order of the steps is AirTimeChain's.
function libraryYesTimes() {
  return YesTimes.createYesAirTimes({
    fetch: (...args) => fetch(...args),
    cache: libraryListCache(),
    showInfo: async ids => {
      if (ids.tmdb == null) return null;
      const cache = sharedCache || (sharedCache = new TmdbCache());
      return AirTimeChain.israeliShowInfo(await cache.getShow(ids.tmdb));
    },
  });
}

// Every air-time step, in AirTimeChain's order: yes, then SIMKL (the
// bridge's shared times), then TheTVDB's check.
function libraryAirTimeChain() {
  return AirTimeChain.createAirTimeChain({ yes: libraryYesTimes(), simkl: libraryAirTimes(), tvdb: libraryTvdbCheck() });
}

// The bridge's times (meta "airTimes"), read at most every 30 minutes;
// null when there are none or they can't be read.
const SHARED_AIR_TIMES_TTL_MS = 30 * 60 * 1000;
let sharedAirTimesRead = null;
function sharedAirTimes() {
  if (!sharedAirTimesRead || Date.now() - sharedAirTimesRead.at > SHARED_AIR_TIMES_TTL_MS) {
    const backend = library && library.backend;
    const promise = (backend && backend.getMeta ? backend.getMeta("airTimes") : Promise.resolve(null))
      .then(doc => (doc && typeof doc.json === "string" ? JSON.parse(doc.json).shows || null : null))
      .catch(() => null);
    sharedAirTimesRead = { at: Date.now(), promise };
  }
  return sharedAirTimesRead.promise;
}

// TheTVDB (the source SIMKL uses) as a second opinion on air dates, with
// the TheTVDB key from Settings (AirTimeChain.createTvdbCheck says how).
// TMDB's list it compares with is already cached from the episode source's
// own lookup.
function libraryTvdbCheck() {
  return AirTimeChain.createTvdbCheck({
    EpisodeSource,
    source: { getSourceLists: ids => library.source.getSourceLists(ids), streamingHome: ids => library.source.streamingHome(ids) },
    recentEpisodes: tvdbRecentEpisodes,
    enabled: () => !!getConfig().tvdbKey && !tvdbKeyRejected,
  });
}

// A show's episodes on TheTVDB from a month back on, as
// [{ season, episode, date }], cached 3 hours; null if TheTVDB couldn't
// answer (not cached - the next load asks again). Five shows at a time:
// one at a time, a load with 40-odd shows to check waited ~12 seconds.
// Only shows with an episode within two weeks are asked, and TheTVDB fixes
// those dates: a 12-hour copy held Dexter: Resurrection back to a day they
// had already dropped.
const CACHE_TTL_TVDB_EPS_MS = 3 * 60 * 60 * 1000;
const TVDB_EPS_PARALLEL = 5;
let tvdbEpisodesActive = 0;
const tvdbEpisodesWaiting = [];
async function tvdbEpisodesSlot(fn) {
  if (tvdbEpisodesActive >= TVDB_EPS_PARALLEL) await new Promise(r => tvdbEpisodesWaiting.push(r));
  tvdbEpisodesActive++;
  try {
    return await fn();
  } finally {
    tvdbEpisodesActive--;
    const next = tvdbEpisodesWaiting.shift();
    if (next) next();
  }
}
function tvdbRecentEpisodes(tvdbId) {
  const cacheKey = `tvdb-eps:${tvdbId}`;
  return readPersistedCache(cacheKey, CACHE_TTL_TVDB_EPS_MS).then(cached => cached !== undefined ? cached : tvdbEpisodesSlot(async () => {
    const key = getConfig().tvdbKey;
    let token = key && await tvdbToken(key, false);
    if (!token) return null;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const out = [];
    for (let page = 0; page < 20; page++) {
      const url = `${TVDB_API}/series/${tvdbId}/episodes/default?page=${page}`;
      let res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 && (token = await tvdbToken(key, true))) {
        res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
      }
      if (res.status === 404) break; // not in their database
      if (!res.ok) return null;
      const body = await res.json();
      for (const ep of ((body.data || {}).episodes) || []) {
        if (ep.aired && ep.aired >= since) out.push({ season: ep.seasonNumber, episode: ep.number, date: ep.aired });
      }
      if (!body.links || !body.links.next) break;
    }
    writePersistedCache(cacheKey, out);
    return out;
  }));
}

// The episode source asks TMDB for a show and its seasons - the same two
// requests TmdbCache already makes (and keeps) for the cards, so they're
// shared instead of repeated.
function libraryTmdbGet(path, params) {
  const cache = sharedCache || (sharedCache = new TmdbCache());
  let m = /^\/tv\/(\d+)$/.exec(path);
  if (m && !params) return cache.getShow(m[1]);
  m = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(path);
  if (m && !params) return cache.getSeason(m[1], Number(m[2]));
  return tmdbGet(path, params);
}

// English title, year and outside ids of a show being added (search
// results come from TMDB, partly in Hebrew, with only a TMDB id).
async function libraryShowMeta(tmdbId) {
  const cache = sharedCache || (sharedCache = new TmdbCache());
  const d = await cache.getShow(tmdbId);
  if (!d) return null;
  const ext = d.external_ids || {};
  return {
    title: d.name || d.original_name || null,
    year: d.first_air_date ? d.first_air_date.slice(0, 4) : null,
    imdb: ext.imdb_id || null,
    tvdb: ext.tvdb_id || null,
  };
}

// Signs in and loads the library once per page load (every later change
// goes through the store, which keeps its copy current). Resolves to false
// while the sign-in screen is showing instead.
// The library's backend (Google sign-in + the database), created once.
function ensureLibrary() {
  if (!library) {
    const backend = FirebaseBackend.create();
    library = { backend, store: null, source: libraryEpisodeSource(), adapter: null };
    window.addEventListener("online", () => {
      if (library.store && library.store.status().pending) library.store.retry().then(afterLibraryRetry);
    });
  }
}

// The API keys travel with your account (users/{uid}/meta/keys, private to
// you like the library): a device that has them saves them there, and a new
// one - another browser, or the Android app - gets them from there once
// signed in, instead of having them typed again.
const ACCOUNT_KEY_FIELDS = { tmdbKey: LS_TMDB_KEY, mdblistKey: LS_MDBLIST_KEY, fanartKey: LS_FANART_KEY, tvdbKey: LS_TVDB_KEY, clientId: LS_CLIENT_ID, clientIdV2: LS_CLIENT_ID_V2 };
function localAccountKeys() {
  const cfg = getConfig();
  return Object.fromEntries(Object.keys(ACCOUNT_KEY_FIELDS).map(k => [k, cfg[k] || ""]));
}
// Resolves to "restored" (the keys are now on this device), "signin" (the
// sign-in screen is showing; signing in runs main again) or "none".
async function restoreKeysFromAccount() {
  ensureLibrary();
  subtitle.textContent = "Signing in…";
  await library.backend.ready();
  if (!library.backend.currentUser()) {
    showLibrarySignIn();
    return "signin";
  }
  const saved = await library.backend.getMeta("keys").catch(() => null);
  if (!saved || !saved.tmdbKey) return "none";
  for (const [field, lsKey] of Object.entries(ACCOUNT_KEY_FIELDS)) {
    if (typeof saved[field] === "string" && saved[field]) safeSetItem(lsKey, saved[field]);
  }
  return getConfig().tmdbKey ? "restored" : "none";
}
// Saves this device's keys to the account when they differ from what's there.
async function saveKeysToAccount() {
  if (!library || !library.backend.currentUser()) return;
  const mine = localAccountKeys();
  if (!mine.tmdbKey) return;
  try {
    const saved = (await library.backend.getMeta("keys")) || {};
    if (Object.keys(mine).every(k => (saved[k] || "") === mine[k])) return;
    await library.backend.setMeta("keys", { ...mine, savedAt: Date.now() });
  } catch (e) {
    console.warn("Couldn't save the keys to your account:", e.message);
  }
}

async function openLibrary() {
  ensureLibrary();
  subtitle.textContent = "Signing in…";
  await library.backend.ready();
  if (!library.backend.currentUser()) {
    showLibrarySignIn();
    return false;
  }
  loadProfilePhotoFromAccount();
  if (!library.store) {
    const store = LibraryStore.createLibraryStore({
      core: LibraryCore, backend: library.backend, storage: localStorage, onChange: renderSaveStatus,
    });
    subtitle.textContent = "Loading your library…";
    await store.load();
    library.store = store;
    library.adapter = LibraryAdapter.createLibraryAdapter({
      core: LibraryCore, store, source: library.source, appendAfter: EpisodeSource.appendAfter,
      showMeta: libraryShowMeta,
      airTimes: libraryAirTimeChain(),
      onProgress: (done, total) => {
        if (total > 5 && done < total) subtitle.textContent = `Loading episode lists… ${done}/${total}`;
      },
    });
    // What's playing on Emby (tools/emby-bridge), for the top cards.
    if (library.backend.watchMeta) {
      library.backend.watchMeta("emby", data => { embyNow = data; syncWatchingOrder() || applyNowWatching(); });
      library.backend.watchMeta("embyMarked", onEmbyMarked);
    }
  }
  library.adapter.reset();
  return true;
}

// "Now watching" on the top cards: tools/emby-bridge (on the computer
// running Emby) keeps meta "emby" up to date with the episodes open on a TV
// right now, playing or paused, each with its position to the minute. A
// card whose next episode is one of them gets a ribbon in its top-left
// corner (WATCHING or PAUSED), clear of the premiere/finale ribbon on the
// right, and a progress bar along the poster with the minutes in a box at
// its end. Nothing for an episode merely stopped partway some other time,
// and nothing once the report is over 3 minutes old (the computer went off).
let embyNow = null;
const EMBY_STALE_MS = 3 * 60 * 1000;

// A top card's episode is its next one (nextLabel); a Just Watched row's,
// the one it shows (season/episode) - marked at 90%, it's still playing.
function nowWatchingFor(row, season, episode) {
  if (!embyNow) return null;
  let s = season, e = episode;
  if (s == null) {
    const m = /S(\d+)E(\d+)/.exec(row.nextLabel || "");
    if (!m) return null;
    s = Number(m[1]); e = Number(m[2]);
  }
  const same = x => x.s === s && x.e === e && ((x.docId != null && String(x.docId) === String(row.showId)) ||
    (x.tmdb != null && row.tmdbId != null && String(x.tmdb) === String(row.tmdbId)) || (!!x.imdb && x.imdb === row.imdbId));
  if (Date.now() - Date.parse(embyNow.updatedAt || 0) >= EMBY_STALE_MS) return null;
  const playing = (embyNow.playing || []).find(same);
  return playing ? { ...playing, paused: !!playing.paused } : null;
}

// The top panel's shows being watched (WATCHING or PAUSED) go first, the
// rest keep their order.
function watchingFirst(rows) {
  const watching = rows.filter(row => nowWatchingFor(row));
  return watching.length ? [...watching, ...rows.filter(row => !watching.includes(row))] : rows;
}

// When a show starts or stops being watched, the top panel is drawn again
// in the new order - scrolled back to the start when a show moved to the
// front, so it's in view. Returns whether it re-rendered.
function syncWatchingOrder() {
  if (currentView !== "list" || !lastRows || !lastBaseRows) return false;
  const next = watchingFirst(lastBaseRows);
  if (next.length === lastRows.length && next.every((row, i) => row === lastRows[i])) return false;
  const movedToFront = next[0] !== lastRows[0] && !!nowWatchingFor(next[0]);
  renderRows(lastRows, lastTotalEps, lastTotalMinutes);
  const track = document.getElementById("myListCarouselTrack");
  if (movedToFront && track) {
    track.scrollLeft = 0;
    updateCarouselArrows();
  }
  return true;
}

function applyNowWatching() {
  document.querySelectorAll(".nw-overlay").forEach(el => el.remove());
  if (currentView !== "list") return;
  (lastRows || []).forEach((row, i) => {
    paintNowWatching(nowWatchingFor(row), document.querySelector(`.carousel-card[data-row="${i}"] .poster-wrap`));
  });
  // An episode already marked (at 90%) and still playing: the same dimmed
  // picture on its Just Watched thumbnail, the watch carrying on there.
  (lastRecentlyWatched || []).forEach((ep, i) => {
    paintNowWatching(nowWatchingFor(ep, ep.season, ep.episode), document.querySelector(`.list-panel--watched [data-cycle-key="watched-${i}"]`));
  });
}

// Seconds as a player shows them: 29:12, or 1:05:09 past an hour.
function playerTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function paintNowWatching(nw, wrap) {
  if (!nw || !wrap) return;
  const pct = nw.len ? Math.min(100, Math.round((nw.pos / nw.len) * 100)) : 0;
  const left = Math.max(0, Math.ceil((nw.len - nw.pos) / 60));
  wrap.insertAdjacentHTML("beforeend", `
    <div class="nw-overlay nw-dim${nw.paused ? " paused" : ""}" title="">
      <div class="nw-eq"><i></i><i></i><i></i><i></i></div>
      <div class="nw-word">${nw.paused ? "PAUSED" : "WATCHING"}</div>
      <div class="nw-min">${playerTime(nw.pos)} / ${playerTime(nw.len)}</div>
      <div class="nw-sub">${pct}% · ${left} MIN LEFT</div>
    </div>`);
}

// "Marked as watched" from Emby: tools/emby-bridge writes meta "embyMarked"
// ({ at, episodes }) whenever it marks an episode. A site open on a screen
// reloads its panels quietly and says so for 10 seconds, large, in the top
// corner, with the show's next episode once it's known. The first report
// (already there when the site opened) and stale ones are skipped.
let embyMarkedSeen = null;
const EMBY_MARKED_FRESH_MS = 3 * 60 * 1000;

async function onEmbyMarked(data) {
  const first = embyMarkedSeen === null;
  const at = data && data.at;
  if (!at || at === embyMarkedSeen) { if (first) embyMarkedSeen = at || ""; return; }
  embyMarkedSeen = at;
  if (first || Date.now() - Date.parse(at) > EMBY_MARKED_FRESH_MS) return;
  const episodes = (data.episodes || []).filter(x => x && x.s != null && x.e != null);
  if (!episodes.length) return;
  // The bridge saved the watch to the library (from the Emby computer)
  // before sending this message: reload the library so the boxes show it -
  // the episode in Just Watched, the next one in Ready to Watch.
  if (library && library.store) await library.store.load().catch(() => {});
  await refreshPanelsQuietly();
  // My Stats, if it's open, counts the episode too (stats.js).
  if (typeof statsRefreshIfOpen === "function") statsRefreshIfOpen();
  const lines = await Promise.all(episodes.map(x => watchedToastLine(x)));
  showCornerToast(lines);
}

// While the tab isn't on the screen (another tab or window in front), the
// message waits and shows once the site is back in view.
let cornerToastWaiting = [];
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !cornerToastWaiting.length) return;
  const lines = cornerToastWaiting;
  cornerToastWaiting = [];
  showCornerToast(lines);
});

let cornerToastTimer = null;
// One line of the message: the show's poster, name, the episode's code and
// title, and the season so far - from the Just Watched row the quiet refresh
// just drew, and the show's episode list for how many the season has.
async function watchedToastLine(x) {
  const sameShow = r => (x.tmdb != null && r.tmdbId != null && String(r.tmdbId) === String(x.tmdb)) || (!!x.imdb && r.imdbId === x.imdb);
  const row = (lastRecentlyWatched || []).find(r => sameShow(r) && r.season === x.s && r.episode === x.e)
    || (lastRecentlyWatched || []).find(sameShow) || (lastRows || []).find(sameShow) || {};
  let seasonEps = null;
  if (row.showId && library && library.adapter) {
    const eps = await library.adapter.showEpisodes(row.showId).catch(() => null);
    const nums = (eps || []).filter(e => e.season === x.s && e.episode != null).map(e => e.episode);
    if (nums.length && Math.max(...nums) >= x.e) seasonEps = Math.max(...nums);
  }
  return {
    title: x.title || row.title || "", season: x.s, episode: x.e,
    episodeTitle: row.season === x.s && row.episode === x.e ? row.episodeTitle || null : null,
    poster: row.posterUrl || null, seasonEps,
  };
}

// The season as segments: those before in blue, this one in gold (it fills
// and pulses), the rest dim - or, when the season's length isn't known,
// nothing after this one.
function watchedToastSegmentsHtml(l) {
  const total = l.seasonEps || l.episode;
  if (total > 40) return ""; // a long season: a bar of hairlines says nothing
  return `<div class="wt-segs" style="--wt-n:${total}">` + Array.from({ length: total }, (_, i) =>
    `<i class="${i + 1 < l.episode ? "on" : i + 1 === l.episode ? "now" : ""}"></i>`).join("") + `</div>`;
}

function showCornerToast(lines) {
  if (document.hidden) {
    cornerToastWaiting = cornerToastWaiting.concat(lines);
    return;
  }
  let el = document.getElementById("cornerToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "cornerToast";
    el.className = "corner-toast";
    el.setAttribute("role", "status");
    el.addEventListener("click", () => el.classList.remove("show"));
    document.body.appendChild(el);
  }
  const code = (a, b) => `S${String(a).padStart(2, "0")}E${String(b).padStart(2, "0")}`;
  el.replaceChildren(...lines.map(l => {
    const item = document.createElement("div");
    item.className = "corner-toast-item";
    item.innerHTML =
      (l.poster
        ? `<div class="wt-poster" style="background-image:url('${esc(l.poster)}')"><span class="wt-badge" aria-hidden="true">✓</span></div>`
        : `<span class="corner-toast-icon" aria-hidden="true">✓</span>`) +
      `<div class="wt-body"><div class="wt-kicker">Watched</div><b>${esc(l.title)}</b>` +
      `<div class="wt-ep">${code(l.season, l.episode)}${l.episodeTitle ? ` · <i>${esc(l.episodeTitle)}</i>` : ""}</div>` +
      watchedToastSegmentsHtml(l) +
      (l.seasonEps ? `<div class="wt-meta">${l.episode} of ${l.seasonEps} this season</div>` : "") + `</div>`;
    return item;
  }));
  clearTimeout(cornerToastTimer);
  requestAnimationFrame(() => el.classList.add("show"));
  cornerToastTimer = setTimeout(() => el.classList.remove("show"), 10000);
}

// Premiere / finale / new-series alerts on the phone: inside the Android
// app only (native/episode-alerts.js), every time fresh Airing Next rows
// arrive. A browser never loads it.
let episodeAlertsModule = null;
function syncEpisodeAlerts(rows) {
  const cap = window.Capacitor;
  if (!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform())) return;
  episodeAlertsModule = episodeAlertsModule || import(new URL("native/episode-alerts.js", document.baseURI).href);
  episodeAlertsModule.then(m => m.sync(rows || [])).catch(e => console.warn("Episode alerts:", e && e.message));
}

// Watches marked on SIMKL never reach the library: the auto-marking from
// SIMKL was removed - a mark made on SIMKL's own site
// can't be told from one its Emby plugin made. Emby marks come straight in
// through tools/emby-bridge.

function showLibrarySignIn() {
  app.innerHTML = `
    <div class="center-box">
      <h2>Sign in</h2>
      <p style="color:var(--muted);font-size:0.85rem">
        Your list is kept in your own private database. Sign in with the
        Google account it belongs to.
      </p>
      <div style="margin-top:18px">
        <button class="pill" id="librarySignInBtn">Sign in with Google</button>
      </div>
      <div class="error-box" id="librarySignInError"></div>
    </div>
  `;
  subtitle.textContent = "Sign in required";
  document.getElementById("librarySignInBtn").onclick = async () => {
    try {
      await library.backend.signIn();
      main();
    } catch (err) {
      document.getElementById("librarySignInError").textContent = `Sign-in failed: ${err.message}`;
    }
  };
}

// The topbar's save state (library mode only): nothing while all is saved,
// otherwise saving / waiting for the connection / failed / a conflict to
// decide - clicking it retries or opens the conflict choice.
function renderSaveStatus(s) {
  let el = document.getElementById("saveStatus");
  if (!el) {
    const host = document.querySelector(".topbar-controls");
    if (!host) return;
    el = document.createElement("button");
    el.id = "saveStatus";
    el.className = "save-status";
    host.prepend(el);
    el.onclick = () => {
      const st = library && library.store && library.store.status();
      if (!st) return;
      if (st.state === "conflict") promptLibraryConflict();
      else if (st.pending) library.store.retry().then(afterLibraryRetry);
    };
  }
  const text = s.state === "saving" ? "Saving…"
    : s.state === "offline" ? `Offline – ${s.pending} waiting`
    : s.state === "error" ? "Not saved – retry"
    : s.state === "conflict" ? "Conflict – choose"
    : "";
  el.textContent = text;
  el.hidden = !text;
  el.dataset.state = s.state;
  el.title = s.error || (s.conflict && s.conflict.reason) || "";
}

function afterLibraryRetry() {
  const st = library.store.status();
  if (st.state === "saved") {
    showToast("Waiting changes saved");
    main();
  }
}

// A change that collided with one made on another device: nothing was
// written - the user picks which version stays.
async function promptLibraryConflict() {
  const c = library.store.status().conflict;
  if (!c) return;
  const show = library.store.view().get(c.docId);
  const name = show ? show.title : "A show";
  const keepMine = confirm(`"${name}" was changed on another device: ${c.reason}.\n\nOK - apply your change on top of it.\nCancel - keep the other device's version.`);
  const result = await library.store.resolveConflict(keepMine ? "mine" : "theirs");
  if (result === "saved") showToast("Your change was saved");
  else if (result === "dropped") showToast("Kept the other device's version");
  else showToast(library.store.status().error || "Not saved yet", true);
  main();
}

// Every write's failure goes through here. In library mode a change that is
// waiting for the connection is still shown (marked by the topbar status),
// and a conflict asks which version to keep.
function reportWriteError(err) {
  showToast(err.message, true);
  if (err.outcome === "queued") main();
  if (err.outcome === "conflict") setTimeout(promptLibraryConflict, 300);
}

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function backupFileName(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;
}

// Settings section (library mode): who's signed in, sign out, and backups.
function librarySettingsHtml() {
  if (!library || !library.store) return "";
  const user = library.backend.currentUser();
  return `
      <div class="library-settings">
        <p style="color:var(--muted);font-size:0.85rem;margin:0 0 8px">Library: signed in as ${esc(user ? user.email : "?")}</p>
        <div class="bridge-status" id="bridgeStatus" hidden></div>
        <button class="pill" id="libraryCleanupBtn">Clean up Watching</button>
        <button class="pill" id="libraryBackupBtn">Download backup</button>
        <button class="pill" id="libraryRestoreBtn">Restore from backup</button>
        <button class="pill" id="librarySignOutBtn">Sign out</button>
        <input type="file" id="libraryRestoreInput" accept="application/json,.json" hidden>
      </div>`;
}

// The computer bridge's pulse (meta "bridgeStatus", bridge-status.js): one
// line with a colored dot, and what's wrong under it, if anything.
async function showBridgeStatus() {
  const el = document.getElementById("bridgeStatus");
  if (!el) return;
  const doc = await library.backend.getMeta(BridgeStatus.META).catch(() => undefined);
  if (doc === undefined || !el.isConnected) return; // couldn't read it: say nothing
  const s = BridgeStatus.summarizeBridgeStatus(doc, Date.now());
  el.className = `bridge-status is-${s.level}`;
  const line = document.createElement("div");
  line.className = "bridge-status-line";
  line.textContent = s.text;
  el.replaceChildren(line, ...s.problems.map(p => {
    const d = document.createElement("div");
    d.className = "bridge-status-problem";
    d.textContent = p;
    return d;
  }));
  el.hidden = false;
}

function wireLibrarySettings() {
  const backupBtn = document.getElementById("libraryBackupBtn");
  if (!backupBtn) return;
  showBridgeStatus();
  backupBtn.onclick = () => downloadJson(backupFileName("tv-library-backup"), library.store.exportBackup());
  const input = document.getElementById("libraryRestoreInput");
  document.getElementById("libraryRestoreBtn").onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const count = backup && backup.shows ? Object.keys(backup.shows).length : 0;
      if (!confirm(`Replace your whole library with this backup (${count} shows)? A backup of the current library is downloaded first.`)) return;
      downloadJson(backupFileName("tv-library-before-restore"), library.store.exportBackup());
      await library.store.restoreBackup(backup);
      showToast(`Restored ${count} shows from the backup`);
      main();
    } catch (err) {
      showToast(`Restore failed: ${err.message}`, true);
    }
  };
  document.getElementById("librarySignOutBtn").onclick = signOutLibrary;
  document.getElementById("libraryCleanupBtn").onclick = showWatchingCleanup;
}

// Signing out (Settings, and the menu under the profile picture).
async function signOutLibrary() {
  if (library.store && library.store.status().pending && !confirm("Some changes aren't saved yet and will be lost. Sign out anyway?")) return;
  await library.backend.signOut();
  writePersistedCache(PANELS_SNAPSHOT_KEY, null); // not shown to whoever signs in next
  safeRemoveProfilePhoto();
  library.store = null;
  library.adapter = null;
  main();
}

// ---------------------------------------------------------------------
// Watching clean-up (from Settings)
// ---------------------------------------------------------------------
// Suggests moving shows that no longer belong in Watching, for the user to
// confirm one by one: a show that has officially ended and is fully watched
// (-> Completed); one with episodes left but untouched for over a year
// (-> On Hold). A fully watched show that hasn't ended is never suggested,
// however long since its last episode - a new season may still come, and
// only Watching shows are checked for one. Nothing moves until "Move".
const CLEANUP_IDLE_DAYS = 365;

function idleText(days) {
  if (days == null) return "never watched";
  if (days >= 365) { const y = Math.round(days / 365); return `last watched ${y} year${y === 1 ? "" : "s"} ago`; }
  const m = Math.max(1, Math.round(days / 30));
  return `last watched ${m} month${m === 1 ? "" : "s"} ago`;
}

async function watchingCleanupSuggestions() {
  const items = await library.adapter.items("watching");
  const now = Date.now();
  const cache = sharedCache || (sharedCache = new TmdbCache());
  const out = [];
  await Promise.all(items.map(async item => {
    const show = item.show || {};
    const ids = show.ids || {};
    const left = airedMinusWatchedCount(item);
    const lastTs = mostRecentWatchedAt(item) || (item.last_watched_at ? Date.parse(item.last_watched_at) : null);
    const idleDays = lastTs ? Math.floor((now - lastTs) / 86400000) : null;
    // Never watched: idle only if it started airing over a year ago (a show
    // that just premiered isn't stale).
    let idle = idleDays != null && idleDays > CLEANUP_IDLE_DAYS;
    if (idleDays == null) {
      const dates = ((await library.adapter.showEpisodes(ids.library)) || [])
        .filter(e => e.season && e.date).map(e => airDateToTimestamp(e.date)).filter(t => !isNaN(t));
      idle = dates.length > 0 && now - Math.min(...dates) > CLEANUP_IDLE_DAYS * 86400000;
    }
    const detail = ids.tmdb ? await cache.getShow(ids.tmdb) : null;
    const ended = !!detail && (detail.status === "Ended" || detail.status === "Canceled");
    let status = null, reason = "";
    if (left === 0 && ended) {
      status = "completed";
      reason = "The series has ended and you've watched it all";
    } else if (left > 0 && idle) {
      status = "hold";
      reason = `${left} episode${left === 1 ? "" : "s"} left, ${idleText(idleDays)}`;
    }
    if (status) out.push({ id: ids.library, tmdbId: ids.tmdb, imdbId: ids.imdb, title: show.title || "Unknown", status, reason });
  }));
  const order = { completed: 0, hold: 1 };
  return out.sort((a, b) => (order[a.status] - order[b.status]) || a.title.localeCompare(b.title));
}

async function showWatchingCleanup() {
  document.getElementById("settingsBtn").classList.add("active");
  app.innerHTML = `<div class="spinner" style="margin-top:80px"></div>`;
  subtitle.textContent = "Looking through your Watching list…";
  let list;
  try {
    list = await watchingCleanupSuggestions();
  } catch (err) {
    showError(err);
    return;
  }
  subtitle.textContent = "Clean up Watching";
  const options = ALL_STATUS_OPTIONS.filter(o => o.value !== "watching");
  const rowsHtml = list.map((s, i) => `
    <label class="cleanup-row">
      <input type="checkbox" class="cleanup-check" data-idx="${i}" checked>
      <span class="cleanup-text">
        <span class="cleanup-title">${esc(s.title)}</span>
        <span class="cleanup-reason">${s.reason}</span>
      </span>
      <select class="cleanup-status" data-idx="${i}" aria-label="Move ${esc(s.title)} to">
        ${options.map(o => `<option value="${o.value}"${o.value === s.status ? " selected" : ""}>${o.label}</option>`).join("")}
      </select>
    </label>`).join("");
  app.innerHTML = `
    <div class="center-box cleanup-box" style="position:relative">
      <button class="modal-close-btn" id="cleanupCloseBtn" style="position:absolute;top:14px;right:14px" title="Back">&times;</button>
      <h2>Clean up Watching</h2>
      ${list.length ? `
        <p style="color:var(--muted);font-size:0.85rem">
          Shows that look like they no longer belong in Watching. Untick any to keep,
          change where one goes, then press Move.
        </p>
        <div class="cleanup-list">${rowsHtml}</div>
        <div style="margin-top:16px"><button class="pill" id="cleanupMoveBtn"></button></div>
        <p id="cleanupProgress" style="color:var(--muted);font-size:0.85rem"></p>`
      : `<p style="color:var(--muted)">Nothing to clean up: every show in Watching has something to watch or is still airing.</p>`}
    </div>`;
  document.getElementById("cleanupCloseBtn").onclick = () => showSettings(main);
  if (!list.length) return;

  const moveBtn = document.getElementById("cleanupMoveBtn");
  const chosen = () => [...app.querySelectorAll(".cleanup-check")].filter(c => c.checked).map(c => Number(c.dataset.idx));
  const updateButton = () => {
    const n = chosen().length;
    moveBtn.textContent = n ? `Move ${n} show${n === 1 ? "" : "s"}` : "Nothing selected";
    moveBtn.disabled = !n;
  };
  app.querySelectorAll(".cleanup-check").forEach(c => { c.onchange = updateButton; });
  updateButton();

  moveBtn.onclick = async () => {
    const picks = chosen();
    app.querySelectorAll("input, select, button").forEach(el => { el.disabled = true; });
    const progress = document.getElementById("cleanupProgress");
    let moved = 0, waiting = 0;
    const failed = [];
    for (const i of picks) {
      const s = list[i];
      const status = app.querySelector(`.cleanup-status[data-idx="${i}"]`).value;
      progress.textContent = `Moving ${moved + waiting + failed.length + 1} of ${picks.length}…`;
      try {
        await saveShowStatus({ library: s.id, tmdb: s.tmdbId, imdb: s.imdbId }, status, { title: s.title });
        moved++;
      } catch (err) {
        if (err.outcome === "queued") waiting++;
        else failed.push(`${s.title}: ${err.message}`);
      }
    }
    const parts = [`Moved ${moved} show${moved === 1 ? "" : "s"}`];
    if (waiting) parts.push(`${waiting} waiting for the connection`);
    if (failed.length) parts.push(`${failed.length} not moved (${failed[0]})`);
    showToast(parts.join(", "), failed.length > 0);
    main();
  };
}

// The episode lists the row builders read: { get(showId) } resolving to
// [{ season, episode, date, title }] (or null), from the library adapter.
function newEpisodeCache() {
  return { get: id => library.adapter.showEpisodes(id) };
}

// Has an episode (from the episode cache) aired by `now`? An exact air time
// counts once the broadcast has ended (its runtime, else fallbackMinutes -
// the show's average); a date-only one from 10:00 local time that day
// (LibraryCore.isAired).
function episodeHasAired(ep, now, fallbackMinutes) {
  return LibraryCore.isAired(ep, now, fallbackMinutes);
}
function episodeTimestamp(dateStr) {
  return airDateToTimestamp(dateStr);
}

async function getWatchingShows() {
  return library.adapter.items("watching");
}

// My List and Airing Next both need the watching list, and they load in the
// same pass, so it's requested once per page load and shared.
let watchingListLoad = null;
function getWatchingShowsOnce() {
  if (!watchingListLoad) watchingListLoad = getWatchingShows();
  return watchingListLoad;
}

// Same shape as getWatchingShows (only the last watched episode matters), for
// the "recently watched, then dropped" case in Recently Watched below - a
// show you stopped following shouldn't vanish from there instantly, since
// you did just watch something of it.
async function getDroppedShows() {
  return library.adapter.items("dropped", { withEpisodes: false });
}

async function getPlanToWatchShows() {
  return library.adapter.items("plantowatch");
}
