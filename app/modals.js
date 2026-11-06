"use strict";

// The windows over the page (episodes, cast, all-shows, search), the back
// button, and each card's menu.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

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

// The Android app's back button (android-app MainActivity) asks this first
// and closes the app only on false: it steps back out of whatever is open -
// a card's menu, a show's details or episodes back to the search / list
// they came from, a modal (through history, as above), Settings or
// Clean up - the way that screen's own X or Back button does.
window.appBackPressed = () => {
  if (document.getElementById("cardMenuDropdown")) { closeCardMenu(); return true; }
  const innerBack = activeModalClose && document.querySelector("[data-ep-back], #detailBackBtn");
  if (innerBack) { innerBack.click(); return true; }
  if (activeModalClose) { history.back(); return true; }
  const screenClose = document.getElementById("cleanupCloseBtn") || document.getElementById("settingsCloseBtn");
  if (screenClose) { screenClose.click(); return true; }
  return false;
};

// Every episode of a top-card show, season by season - opened by clicking
// the "Xh Ym left" line. Watched episodes are dimmed, the ones left to
// watch stand out (the next one marked UP NEXT), and episodes that haven't
// aired yet close each season with their air date. allEpisodes and the
// remaining total were already computed alongside the card (see
// estimateRemainingMinutes), so this is pure rendering, no extra fetch -
// IMDb links (desktop only, see enrichEpisodesWithImdbLinks) are fetched
// lazily afterward instead. A show with no episode list falls back to just
// its remaining episodes.
function openEpisodesModal(arrIdx) {
  const row = getCycleRows("main")[arrIdx];
  if (!row || !row.episodesLeft || !row.episodesLeft.length) return;

  const pad = n => String(n).padStart(2, "0");
  const episodeName = ep => ep.title || (ep.episode != null ? `Episode ${ep.episode}` : "Episode");
  const badgeHtml = ep => ep.badge && ep.status !== "watched"
    ? `<span class="episode-badge${ep.badge === "SEASON FINALE" ? " finale" : ""}">${ep.badge}</span>` : "";
  const shortDate = date => {
    const ts = date ? episodeTimestamp(date) : NaN;
    return isNaN(ts) ? "TBA" : new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const listed = row.allEpisodes && row.allEpisodes.length
    ? row.allEpisodes
    : row.episodesLeft.map(ep => ({ ...ep, status: "left" }));
  const nextIdx = listed.findIndex(ep => ep.status === "left");

  const rowHtml = (ep, i) => {
    const code = ep.season != null && ep.episode != null ? `S${pad(ep.season)}E${pad(ep.episode)}` : "";
    const isNext = i === nextIdx;
    const right = ep.status === "future"
      ? `<span class="episode-runtime episode-airs">${shortDate(ep.date)}</span>`
      : `<span class="episode-runtime">${formatEpisodeRuntime(ep.runtime)}</span>`;
    return `
      <div class="episode-row is-${ep.status}${isNext ? " is-next" : ""}">
        <span class="episode-mark" aria-label="${ep.status === "watched" ? "Watched" : ep.status === "left" ? "Not watched" : "Not aired yet"}">${EPISODE_MARK_SVG[ep.status]}</span>
        <span class="episode-code">${code}</span>
        <span class="episode-name" data-ep-key="${i}">${esc(episodeName(ep))}</span>
        ${isNext ? `<span class="episode-badge up-next">UP NEXT</span>` : badgeHtml(ep)}
        ${right}
      </div>`;
  };

  let rowsHtml = "";
  if (row.allEpisodes && row.allEpisodes.length) {
    const seasonNums = [...new Set(listed.map(ep => ep.season))];
    for (const n of seasonNums) {
      const eps = listed.map((ep, i) => [ep, i]).filter(([ep]) => ep.season === n);
      const watched = eps.filter(([ep]) => ep.status === "watched").length;
      const left = eps.filter(([ep]) => ep.status === "left").length;
      const aired = watched + left;
      const stat = aired === 0 ? "Not aired yet"
        : left === 0 ? `Watched &middot; ${watched}/${eps.length}`
        : `${watched}/${eps.length} watched &middot; ${left} left`;
      const tone = aired === 0 ? "future" : left === 0 ? "done" : "left";
      rowsHtml += `
        <div class="episodes-season-head">
          <span class="episodes-season-name">SEASON ${n}</span>
          <span class="episodes-season-stat tone-${tone}">${stat}</span>
        </div>
        ${eps.map(([ep, i]) => rowHtml(ep, i)).join("")}`;
    }
  } else {
    rowsHtml = listed.map(rowHtml).join("");
  }
  const [totalH, totalM] = formatTime(row.episodesLeft.reduce((sum, ep) => sum + ep.runtime, 0));

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "episodesModalOverlay";
  overlay.style.paddingTop = `${modalTopGap()}px`;
  overlay.innerHTML = `
    <div class="modal-box episodes-modal">
      <div class="episodes-modal-head">
        <div class="list-panel-header">${LIST_ICON_SOLID_SVG}<span>EPISODES</span></div>
        <button class="modal-close-btn" id="episodesModalCloseBtn">&times;</button>
      </div>
      <div class="episodes-modal-subtitle">${esc(row.title)}</div>
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

  // Open on the episode up next rather than the top of season 1.
  const nextEl = overlay.querySelector(".episode-row.is-next");
  if (nextEl) {
    const list = overlay.querySelector(".episodes-list");
    const head = nextEl.previousElementSibling && nextEl.previousElementSibling.classList.contains("episodes-season-head")
      ? nextEl.previousElementSibling : nextEl;
    list.scrollTop = Math.max(head.offsetTop - list.offsetTop - 8, 0);
  }

  if (!window.matchMedia("(max-width: 720px)").matches) {
    enrichEpisodesWithImdbLinks(row, listed);
  }
}

// The status mark at the start of each row in the episodes modal.
const EPISODE_MARK_SVG = {
  watched: `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2f6b45"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#bff3d1" stroke-width="2.6"/></svg>`,
  left: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/></svg>`,
  future: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/></svg>`,
};

// Turns each episode name into a link to its own IMDb page, once TMDB's
// per-episode id lookup resolves - desktop only (see the matchMedia guard
// at the call site), since it's an extra network request per episode and
// this modal already lays out differently below the mobile breakpoint.
// Cached persistently (see getEpisodeExternalIds), so this only costs a
// real fetch the first time a given episode is looked up, ever. Only the
// episodes left to watch, so a long show doesn't fire hundreds at once.
function enrichEpisodesWithImdbLinks(row, episodes) {
  if (!row.tmdbId || !sharedCache) return;
  episodes.forEach((ep, i) => {
    if (ep.season == null || ep.episode == null || ep.status !== "left") return;
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
  overlay.style.paddingTop = `${modalTopGap()}px`;

  const gridHtml = top.length
    ? top.map((person, i) => {
        const photoHtml = person.profile_path
          ? `<img class="cast-photo" loading="lazy" src="${TMDB_PROFILE_BASE}${esc(person.profile_path)}" alt="${esc(person.name)}">`
          : `<div class="cast-photo placeholder">${esc((person.name[0] || "?").toUpperCase())}</div>`;
        const character = (person.roles && person.roles[0] && person.roles[0].character) || "";
        const epCount = person.epCount || person.total_episode_count || 0;
        return `
          <div class="cast-item">
            ${photoHtml}
            <div class="cast-info">
              <span class="cast-name" data-person-idx="${i}">${esc(person.name)}</span>
              ${character ? `<span class="cast-character">${esc(character)}</span>` : ""}
              ${epCount ? `<span class="cast-episodes">${epCount} episode${epCount === 1 ? "" : "s"}</span>` : ""}
            </div>
          </div>`;
      }).join("\n")
    : `<p style="color:var(--muted);font-size:0.85rem;padding:10px 4px">No cast information available.</p>`;

  overlay.innerHTML = `
    <div class="modal-box cast-modal">
      <div class="episodes-modal-head">
        <div class="modal-tabs" role="tablist">
          <button class="list-panel-header modal-tab active" data-tab="cast" role="tab" aria-selected="true">${CAST_ICON_SOLID_SVG}<span>CAST</span></button>
          <button class="list-panel-header modal-tab" data-tab="episodes" role="tab" aria-selected="false">${LIST_ICON_SOLID_SVG}<span>EPISODES</span></button>
        </div>
        <button class="modal-close-btn" id="castModalCloseBtn">&times;</button>
      </div>
      <div class="episodes-modal-subtitle">${esc(row.title)}</div>
      <div class="cast-grid" id="castGrid">${gridHtml}</div>
      <div class="cast-episodes-tab" id="castEpisodes" hidden></div>
    </div>`;
  document.body.appendChild(overlay);
  pushModalHistoryState(closeCastModal);

  document.getElementById("castModalCloseBtn").onclick = closeCastModal;
  // Episodes tab: the same episodes manager as in search, loaded the first
  // time it's opened; switching tabs keeps whatever is on it.
  let episodesLoaded = false;
  overlay.querySelectorAll(".modal-tab").forEach(tab => {
    tab.onclick = async () => {
      const toEpisodes = tab.dataset.tab === "episodes";
      overlay.querySelectorAll(".modal-tab").forEach(t => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      document.getElementById("castGrid").hidden = toEpisodes;
      const episodesEl = document.getElementById("castEpisodes");
      episodesEl.hidden = !toEpisodes;
      if (!toEpisodes || episodesLoaded) return;
      episodesLoaded = true;
      episodesEl.innerHTML = `<div class="spinner" style="margin:30px auto"></div>`;
      const match = library && library.adapter
        ? await library.adapter.findStatus({ library: row.showId, tmdb: row.tmdbId, imdb: row.imdbId })
        : null;
      if (!match) {
        episodesEl.innerHTML = `<div class="error-box">This show isn't in your list.</div>`;
        return;
      }
      openEpisodesManager({ title: row.title }, match, {
        body: episodesEl,
        overlay: episodesEl,
        setGuard: fn => { castModalCloseGuard = fn; },
        onBack: null,
      });
    };
  });
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

// Set while the cast window's Episodes tab holds unsaved changes (same as
// searchModalCloseGuard): closing asks first.
let castModalCloseGuard = null;

function closeCastModal() {
  if (castModalCloseGuard && !castModalCloseGuard()) return;
  castModalCloseGuard = null;
  const overlay = document.getElementById("castModalOverlay");
  if (!overlay) return;
  overlay.remove();
  document.removeEventListener("keydown", castModalEscHandler);
  consumeModalHistoryState();
  // Watched marks changed on the Episodes tab: the panels behind are stale.
  if (watchedMarksChanged) {
    watchedMarksChanged = false;
    main();
  }
}

// Icon/title for the "all shows" modal opened from a bottom panel's show-count
// link (listPanelCountHtml) - same icon+label each panel's own header uses.
// A function rather than a module-level object because the icon constants
// themselves are declared further down the file (TDZ at load time otherwise).
function panelShowsModalConfig(source) {
  switch (source) {
    case "watched": return { icon: CLOCK_ICON_SOLID_SVG, title: "Just Watched" };
    case "plan": return { icon: BOOKMARK_ICON_SVG, title: "Plan to Watch" };
    case "airing": return { icon: CALENDAR_ICON_SVG, title: "Airing Next" };
    // The top panel's own "N Shows" stat - title follows currentView since
    // that stat only actually exists in the "list" header today, but the
    // underlying rows (getCycleRows("main")) already switch on it too.
    case "main": return { icon: STAT_TV_ICON_SVG, title: currentView === "airing" ? "Airing Next" : "Ready to Watch" };
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
  overlay.style.paddingTop = `${modalTopGap()}px`;

  // Each card is a flip card, not a link: clicking the poster (front) does
  // a half-turn to a wider, horizontal back face holding the exact same
  // info the show's own row shows (rowInfoWrapHtml, mode "flip" - only the
  // title there links to IMDb, matching how it used to work when the whole
  // card was the link).
  const itemsHtml = rows.map((row, idx) => {
    const posterSrc = row.posterUrl || row.bannerUrl;
    const thumbHtml = posterSrc
      ? `<img class="list-thumb" loading="lazy" src="${esc(posterSrc)}" alt="${esc(row.title)}">`
      : `<div class="list-thumb placeholder">${esc((row.title[0] || "?").toUpperCase())}</div>`;
    const infoHtml = rowInfoWrapHtml(row, idx, source, "flip");
    // Landscape banner (not the portrait poster - already used on the
    // front) as a lightly blurred backdrop behind the back face's text, so
    // the show is still visually recognizable once flipped rather than
    // reading as a plain vignette. Falls back to the poster when a show
    // has no banner; the base gradient in .panel-shows-flip-back's own CSS
    // still shows through when neither is available.
    const backBannerSrc = row.bannerUrl || row.posterUrl;
    const backBgHtml = backBannerSrc
      ? `<div class="panel-shows-flip-back-bg" style="background-image:url('${esc(backBannerSrc)}')"></div>`
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

  // Sized to exactly as many fixed 150px columns as this list needs, up to
  // however many fit on screen - a short list gets a narrow window instead
  // of one sparse row stretched across a wide monitor, while a long one
  // still uses the full width available to cut down on scrolling. Skipped
  // on the mobile layout, which has its own fixed 2-column grid (see the
  // max-width: 720px rule below) that this would otherwise override, since
  // an inline style always wins over an external stylesheet rule.
  if (!window.matchMedia || !window.matchMedia("(max-width: 720px)").matches) {
    const TILE = 150, GAP = 20, GRID_PAD = 44; // .panel-shows-grid's own left+right padding
    const BOX_BORDER = 2; // .modal-box's 1px focus-ring border (both sides) - border-box, so it eats into content width and has to be budgeted for too, or the grid overflows by exactly that much and grows its own scrollbar
    const CHROME = GRID_PAD + BOX_BORDER;
    const available = Math.max(TILE, window.innerWidth - 40 - CHROME); // 40 = .modal-overlay's own padding
    const columnsFit = Math.max(1, Math.floor((available + GAP) / (TILE + GAP)));
    // At least 2 when there's more than one show, so a flipped card (spans
    // 2 columns) always has a real second column to expand into.
    const columns = Math.max(Math.min(rows.length, columnsFit), rows.length >= 2 ? 2 : 1);
    const grid = overlay.querySelector(".panel-shows-grid");
    const modalBox = overlay.querySelector(".panel-shows-modal");
    grid.style.gridTemplateColumns = `repeat(${columns}, ${TILE}px)`;
    modalBox.style.maxWidth = `${columns * TILE + (columns - 1) * GAP + CHROME}px`;
  }

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
  if (!library || !library.adapter) return; // not signed in yet
  document.getElementById("addShowBtn").classList.add("active");
  lastSearchQuery = "";
  lastSearchResults = [];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "searchModalOverlay";
  overlay.style.paddingTop = `${modalTopGap()}px`;
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

// Opens under its button - or above it when there isn't room below (a
// bottom-panel row near the window's bottom edge).
function fitCardMenuOnScreen(menu, rect) {
  const h = menu.offsetHeight;
  if (rect.bottom + 6 + h > window.innerHeight - 8) menu.style.top = `${Math.max(8, rect.top - 6 - h)}px`;
}

function openCardMenu(arrIdx, btnEl) {
  const alreadyOpenForThisBtn = cardMenuOpenerBtn === btnEl;
  closeCardMenu();
  if (alreadyOpenForThisBtn) return; // second click on the same button toggles it closed

  const row = lastRows && lastRows[arrIdx];
  if (!row || !row.showId) return;

  const rect = btnEl.getBoundingClientRect();
  const menu = document.createElement("div");
  menu.className = "card-menu-dropdown";
  menu.id = "cardMenuDropdown";
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 190)}px`;

  const statusButtons = ALL_STATUS_OPTIONS.map(opt => `
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
  fitCardMenuOnScreen(menu, rect);
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
    // Sent to PLAN TO WATCH by hand: keep autoStartAiredPremieres from
    // moving a just-premiered show straight back to WATCHING (the mark is
    // kept on the show, saved with the status itself).
    await saveShowStatus(
      { library: row.showId, tmdb: row.tmdbId, imdb: row.imdbId }, status,
      status === "plantowatch" ? { title: row.title, year: row.year, autoStarted: "manual" } : { title: row.title, year: row.year }
    );
    const label = (ALL_STATUS_OPTIONS.find(o => o.value === status) || {}).label || status;
    showToast(`Moved "${row.title}" to ${label}`);
    main();
  } catch (err) {
    reportWriteError(err);
  }
}

async function markNextEpisodeWatched(row) {
  closeCardMenu();
  try {
    await markEpisodeWatched(row.showId, row.nextSeason, row.nextEpisode);
    showToast(`Marked "${row.title}" ${row.nextLabel} as watched`);
    main();
  } catch (err) {
    reportWriteError(err);
  }
}

async function removeShowFromMyList(row) {
  closeCardMenu();
  if (!confirm(`Remove "${row.title}" from your list entirely?`)) return;
  try {
    await removeShowFromList(row.showId);
    showToast(`Removed "${row.title}"`);
    main();
  } catch (err) {
    reportWriteError(err);
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
  if (!row || !row.showId) return;

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
  fitCardMenuOnScreen(menu, rect);
  cardMenuOpenerBtn = btnEl;

  menu.querySelectorAll("[data-status]").forEach(b => {
    b.onclick = () => changeShowStatus(row, b.dataset.status);
  });
  document.getElementById("cardMenuRemoveBtn").onclick = () => removeShowFromMyList(row);

  setTimeout(() => document.addEventListener("click", cardMenuOutsideClickHandler), 0);
  document.addEventListener("keydown", cardMenuEscHandler);
  document.addEventListener("scroll", cardMenuScrollHandler, true);
}
