"use strict";

// Library changes (status, remove, watched episodes), search, the show
// window and the episodes manager.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// ---------------------------------------------------------------------
// Library changes - add / status change, remove, watched episodes - and search
// ---------------------------------------------------------------------
// Each resolves once the change is saved, or rejects with what happened
// instead (waiting for the connection, a conflict, an error - see
// reportWriteError).
// Adds a show with this status, or moves it there if it's already in the
// library. extra: { title, year, autoStarted }.
async function saveShowStatus(ids, toStatus, extra) {
  return library.adapter.setStatus(ids, toStatus, extra);
}

// The corner ribbon on a My List card. It has no dismiss control: it shows
// while the show's next episode is a series premiere, a season premiere, or
// a season finale, and goes away on its own once that episode is watched.
// Season comes from nextSeason on My List / Airing Next rows, and from the
// watched episode's own season on Recently Watched rows.
function activeCardBadge(row) {
  const season = row.nextSeason ?? row.season;
  if (row.badge === "SERIES PREMIERE") return { text: "SERIES PREMIERE", tone: "new" };
  if (row.badge === "SEASON PREMIERE") return { text: season != null ? `SEASON ${season} PREMIERE` : "SEASON PREMIERE", tone: "premiere" };
  if (row.badge === "SEASON FINALE") return { text: season != null ? `SEASON ${season} FINALE` : "SEASON FINALE", tone: "finale" };
  return null;
}

function badgeText(row) {
  const badge = activeCardBadge(row);
  return badge ? badge.text : row.badge;
}

// Recently Watched can also carry "DROPPED", which activeCardBadge doesn't
// know (that's a My List-only badge set).
// Bottom strip on a bottom-panel thumbnail: the IMDb badge, with the
// premiere/finale/dropped tag (when `row` has one) right beside it.
function thumbBarHtml(imdbHtml, row) {
  const badge = !row ? null : row.badge === "DROPPED" ? { text: "DROPPED", tone: "dropped" } : activeCardBadge(row);
  const tagHtml = badge ? `<span class="list-thumb-tag tone-${badge.tone}">${badge.text}</span>` : "";
  return (imdbHtml || tagHtml) ? `<div class="list-thumb-bar">${imdbHtml}${tagHtml}</div>` : "";
}

// A PLAN TO WATCH show whose first episode has aired (and that's recent
// enough to be a new premiere, not old backlog) moves to WATCHING, so it
// shows up in My List. Each premiere is moved only once - remembered on the
// show itself (autoStarted: its first-air date, or "manual" once sent back
// to PLAN TO WATCH by hand), so it's the same on every device and a show
// sent back by hand stays there instead of bouncing back on the next load.
async function autoStartAiredPremieres(planRows) {
  const now = Date.now();
  const due = planRows.filter(r => r.showId && r.firstAirDate
    && new Date(r.firstAirDate + "T00:00:00").getTime() <= now
    && isRecentShow(r.firstAirDate)
    && r.watchedCount === 0
    && r.autoStarted !== r.firstAirDate
    && r.autoStarted !== "manual");
  if (!due.length) return;
  let moved = 0;
  for (const r of due) {
    try {
      await saveShowStatus({ library: r.showId, tmdb: r.tmdbId, imdb: r.imdbId }, "watching", { title: r.title, autoStarted: r.firstAirDate });
      moved++;
    } catch (err) {
      showToast(`Couldn't move "${r.title}" to Watching: ${err.message}`, true);
    }
  }
  if (moved) {
    showToast(`${moved} show${moved === 1 ? "" : "s"} started airing - moved to Watching`);
    main();
  }
}

async function removeShowFromList(showId) {
  return library.adapter.remove(showId);
}

async function markEpisodeWatched(showId, season, episode) {
  return library.adapter.setWatched(showId, season, [episode], true);
}

// Marks a batch of one season's episodes watched or not watched.
async function setEpisodesWatched(showId, season, episodeNumbers, watched) {
  return library.adapter.setWatched(showId, season, episodeNumbers, watched);
}

// TMDB in English: the titles stored when a show is added. The Hebrew search
// below runs alongside it (see wireSearchInput).
async function searchTvShows(query) {
  return searchTvShowsTmdb(query, "en-US");
}

// TMDB in Hebrew: its language param improves matching for Hebrew queries
// (it only affects which localized title TMDB returns, not whether a show
// matches at all). Results carry only a tmdb id - saveShowStatus and
// findShowLibraryStatus accept any subset of library/tmdb/imdb ids.
async function searchTvShowsTmdb(query, language = "he-IL") {
  const data = await tmdbGet("/search/tv", { query, language }).catch(() => null);
  const results = (data && data.results) || [];
  return results.map(r => ({
    title: r.name || r.original_name || "Unknown",
    year: (r.first_air_date || "").slice(0, 4),
    posterUrl: r.poster_path ? TMDB_IMAGE_BASE + r.poster_path : null,
    ids: { tmdb: r.id },
  }));
}

// Combines both searches: the English results first, then each Hebrew one
// whose show isn't already among them.
function mergeSearchResults(primaryResults, extraResults) {
  const seenTmdb = new Set(
    primaryResults.map(r => r.ids && r.ids.tmdb).filter(v => v != null).map(String)
  );
  const extra = extraResults.filter(r => !(r.ids && r.ids.tmdb != null && seenTmdb.has(String(r.ids.tmdb))));
  return [...primaryResults, ...extra];
}

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

// The show's status in the library and its list item: { status, item } or
// null when it isn't in the library.
async function findShowLibraryStatus(ids) {
  return library.adapter.findStatus(ids);
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
      ? `<img class="search-result-poster" loading="lazy" src="${esc(r.posterUrl)}" alt="${esc(r.title || "")}">`
      : `<div class="search-result-poster placeholder">${esc(((r.title || "?")[0] || "?").toUpperCase())}</div>`;
    return `
      <div class="search-result-row" data-idx="${i}">
        ${posterHtml}
        <div class="search-result-info">
          <div class="search-result-title">${esc(r.title || "Unknown")}</div>
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
        const [englishResults, hebrewResults] = await Promise.all([
          searchTvShows(queryAtRequestTime).catch(() => []),
          searchTvShowsTmdb(queryAtRequestTime).catch(() => []),
        ]);
        if (queryAtRequestTime !== lastSearchQuery) return; // superseded by newer input
        lastSearchResults = mergeSearchResults(englishResults, hebrewResults);
        renderSearchResults(lastSearchResults);
      } catch (err) {
        if (queryAtRequestTime !== lastSearchQuery) return;
        document.getElementById("searchResults").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
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
    // search result never carries an imdb id on its
    // own, which used to mean no link at all for anything not already in
    // the user's library. getShow's own response already includes
    // external_ids (see TmdbCache.getShow), so this reuses the exact same
    // cached per-show fetch every other TMDB-backed feature here does,
    // rather than a dedicated request.
    const [match, showDetail] = await Promise.all([
      findShowLibraryStatus(ids),
      (!ids.imdb && ids.tmdb && sharedCache) ? sharedCache.getShow(ids.tmdb) : null,
    ]);
    libraryMatch = match;
    const fetchedImdbId = showDetail && showDetail.external_ids && showDetail.external_ids.imdb_id;
    if (fetchedImdbId) ids.imdb = fetchedImdbId;
  } catch (err) {
    body.innerHTML = `
      <button class="modal-back-btn" id="detailBackBtn">&larr; Back to search</button>
      <div class="error-box">${esc(err.message)}</div>`;
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
    ? `<img class="detail-poster" src="${esc(show.posterUrl)}" alt="${esc(show.title || "")}">`
    : `<div class="detail-poster placeholder">${esc(((show.title || "?")[0] || "?").toUpperCase())}</div>`;

  let statusHtml;
  if (!libraryMatch) {
    statusHtml = `<div class="detail-status not-in-list">Not in your list yet</div>`;
  } else {
    const item = libraryMatch.item;
    const watched = item.watched_episodes_count || 0;
    const total = item.total_episodes_count || 0;
    const progress = total ? ` — ${watched}/${total} episodes watched` : "";
    const label = `${STATUS_LABELS[libraryMatch.status]}${progress}`;
    // Only shows in the library can be managed episode-by-episode.
    const canOpenEpisodes = !!(item.show && item.show.ids && item.show.ids.library);
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

  // A TMDB search result has no imdb id of its own (openShowDetail fills it
  // in from TMDB's details when it can); a show already in the library
  // carries one - falls back to no link at all rather than a dead one.
  const libraryShowIds = libraryMatch && libraryMatch.item.show && libraryMatch.item.show.ids;
  const imdbId = [show.ids && show.ids.imdb, libraryShowIds && libraryShowIds.imdb].find(isImdbId) || null;
  const titleText = esc(show.title || "Unknown");
  const detailTitleHtml = imdbId
    ? `<a class="detail-title" href="https://www.imdb.com/title/${imdbId}/" target="_blank" rel="noopener" title="Open on IMDb"${clickStop()}>${titleText}</a>`
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
  const showId = (libraryMatch.item.show || {}).ids && libraryMatch.item.show.ids.library;
  if (!showId) {
    showToast("This result has no usable ID.", true);
    return;
  }
  if (!confirm(`Remove "${show.title}" from your list entirely?`)) return;
  const buttons = btnEl.parentElement.querySelectorAll("button");
  buttons.forEach(b => { b.disabled = true; });
  try {
    await removeShowFromList(showId);
    showToast(`Removed "${show.title}"`);
    closeSearchModal();
    main();
  } catch (err) {
    buttons.forEach(b => { b.disabled = false; });
    reportWriteError(err);
  }
}

async function setShowStatusFromDetail(show, status, btnEl) {
  const ids = show.ids || {};
  if (!ids.library && !ids.tmdb && !ids.imdb) {
    showToast("This result has no usable ID.", true);
    return;
  }
  const buttons = btnEl.parentElement.querySelectorAll("button");
  buttons.forEach(b => { b.disabled = true; });
  try {
    await saveShowStatus(ids, status, { title: show.title, year: show.year });
    showToast(`"${show.title}" set to ${STATUS_LABELS[status]}`);
    closeSearchModal();
    main();
  } catch (err) {
    buttons.forEach(b => { b.disabled = false; });
    reportWriteError(err);
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

// Where the episodes manager lives: in the search window by default (in place
// of the show's page, with a Back to it), or in the cast window's Episodes
// tab. A host gives the element to draw into, the scrolling element around
// it, how to register the "unsaved changes" check that closing asks first,
// and what Back does (none: no Back button).
function searchEpisodesHost(show, libraryMatch) {
  const title = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  if (!title || !body) return null;
  title.textContent = show.title || "Episodes";
  // The two-column layout needs more room than the search modal's usual
  // width - dropped again on the way back to the detail view.
  const box = body.closest(".modal-box");
  if (box) box.classList.add("modal-wide");
  return {
    body,
    overlay: document.getElementById("searchModalOverlay"),
    setGuard: fn => { searchModalCloseGuard = fn; },
    onBack: () => {
      if (box) box.classList.remove("modal-wide");
      searchModalCloseGuard = null;
      title.textContent = show.title || "Show";
      renderShowDetail(show, libraryMatch);
    },
  };
}

async function openEpisodesManager(show, libraryMatch, host) {
  host = host || searchEpisodesHost(show, libraryMatch);
  if (!host || !host.body) return;
  const body = host.body;
  const item = libraryMatch.item;
  const showId = item.show.ids.library;
  // Changes are staged locally until Save: `watched` is the working copy,
  // `saved` the last state the library is known to have (null until loaded).
  let saved = null, saving = false;
  const backBtnHtml = host.onBack ? `<button class="modal-back-btn" data-ep-back>&larr; Back</button>` : "";
  const wireBack = () => {
    const btn = body.querySelector("[data-ep-back]");
    if (btn) btn.onclick = () => { if (confirmLeave()) host.onBack(); };
  };
  body.innerHTML = `${backBtnHtml}<div class="spinner" style="margin:30px auto"></div>`;
  wireBack();

  const episodeCache = sharedEpisodeCache || newEpisodeCache();
  const all = await episodeCache.get(showId);
  if (!all || !all.length) {
    body.innerHTML = `${backBtnHtml}<div class="error-box">No episode list is available for this show.</div>`;
    wireBack();
    return;
  }

  // season number -> [{episode, title, aired}] (specials excluded, same as
  // everywhere else here)
  const now = Date.now();
  const seasons = new Map();
  for (const ep of all) {
    if (ep.season == null || ep.season === 0 || ep.episode == null) continue;
    if (!seasons.has(ep.season)) seasons.set(ep.season, []);
    seasons.get(ep.season).push({
      episode: ep.episode, title: ep.title || "", dated: !!ep.date,
      aired: episodeHasAired(ep, now, item.show && item.show.runtime),
    });
  }
  const seasonNums = [...seasons.keys()].sort((a, b) => a - b);
  for (const n of seasonNums) seasons.get(n).sort((a, b) => a.episode - b.episode);

  const watched = watchedEpisodeNumbersBySeason(item);
  const watchedSet = n => watched[n] || (watched[n] = new Set());
  // Watched means it aired, whatever its date says; and an episode with no
  // date that comes before one that aired by its date did air too (many
  // older episodes have no date in any source). Both can be marked, and
  // count toward their season's box.
  let lastAired = null;
  for (const n of seasonNums) for (const e of seasons.get(n)) if (e.aired) lastAired = { n, ep: e.episode };
  for (const n of seasonNums) {
    for (const e of seasons.get(n)) {
      if (e.aired) continue;
      if (watchedSet(n).has(e.episode)) e.aired = true;
      else if (!e.dated && lastAired && (n < lastAired.n || (n === lastAired.n && e.episode < lastAired.ep))) e.aired = true;
    }
  }
  // A show may have no per-episode `seasons` list (only the counts - e.g.
  // a watched count kept from the import). A fully-watched show is the one
  // case that's still unambiguous without it: every aired episode counts.
  const hasWatchedDetail = Array.isArray(item.seasons) && item.seasons.length > 0;
  // Without the per-episode list there are just the counts plus a
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
    const overlayEl = host.overlay;
    const listScroll = listEl ? listEl.scrollTop : 0;
    const overlayScroll = overlayEl ? overlayEl.scrollTop : 0;

    body.innerHTML = `
      ${backBtnHtml}
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
    wireBack();
    const saveBtn = body.querySelector("#epSaveBtn");
    if (saveBtn) saveBtn.onclick = saveChanges;
    const discardBtn = body.querySelector("#epDiscardBtn");
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

  // Clicks only edit the local working copy; nothing is saved until Save.
  function setLocal(season, episodeNumbers, makeWatched) {
    if (saving) return;
    const set = watchedSet(season);
    episodeNumbers.forEach(n => makeWatched ? set.add(n) : set.delete(n));
    render();
  }

  // Per-season difference between the working copy and the library.
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
          await setEpisodesWatched(showId, c.season, c.add, true);
          c.add.forEach(x => saved[c.season].add(x));
          savedCount += c.add.length;
        }
        if (c.remove.length) {
          await setEpisodesWatched(showId, c.season, c.remove, false);
          c.remove.forEach(x => saved[c.season].delete(x));
          savedCount += c.remove.length;
        }
      }
      showToast(`Saved ${savedCount} change${savedCount === 1 ? "" : "s"}`);
    } catch (err) {
      reportWriteError(err);
    } finally {
      if (savedCount) watchedMarksChanged = true;
      item.watched_episodes_count = seasonNums.reduce((s, n) => s + saved[n].size, 0);
      saving = false;
      render();
    }
  }

  saved = {};
  for (const n of seasonNums) saved[n] = new Set(watchedSet(n));
  host.setGuard(confirmLeave);
  render();
}
