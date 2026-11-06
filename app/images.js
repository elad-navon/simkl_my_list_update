"use strict";

// Drawing helpers: image modes, theme and layout switches, posters and
// banners, ratings, and the image picker.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
let lastRows = null;
// The top panel's rows in their own order, before a show being watched on
// Emby moves to the front (watchingFirst) - so it goes back when it ends.
let lastBaseRows = null;
let lastTotalEps = 0;
let lastTotalMinutes = 0;
let lastRecentlyWatched = [];
let lastPlanToWatch = [];
let lastAiringPreview = [];
let airingRows = null;       // lazily fetched, cached until next Refresh
let sharedCache = null;      // TmdbCache reused across both views for one session
let sharedEpisodeCache = null; // the library's episode lists, same idea
let currentView = "list";    // "list" | "airing"

function updateImageModeButton() {
  const btn = document.getElementById("imageModeBtn");
  const mode = getImageMode();
  const nextLabel = mode === "poster" ? "Banners" : "Posters";
  const icon = mode === "poster" ? withCineIcon(ICON_BANNER_SHAPE, CINE_NAV_ICONS.banner) : withCineIcon(ICON_POSTER_SHAPE, CINE_NAV_ICONS.poster);
  btn.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-label">Switch to <br>${nextLabel}</span>`;
}

// The bottom panels' thumbnails: banners (two shows stacked per page) or
// posters in L-shaped pairs, exactly like the top panel's poster mode (two
// posters as tall as the two banner rows were, sharing the details column
// between them) - the panels keep their size either way; a pair wider than
// its panel is cut at the edge and comes in with a drag. Only in the
// one-page layout; the older scrolling panels stay with banners.
function panelPosters() {
  const phone = phoneLayout();
  if (phone) return phone === "landscape";
  return localStorage.getItem(LS_PANEL_IMAGES) === "poster" && !isScrollLayout();
}

function applyPanelImages() {
  document.body.classList.toggle("panel-posters", panelPosters());
  const btn = document.getElementById("panelImagesBtn");
  if (!btn) return;
  btn.hidden = isScrollLayout();
  const posters = panelPosters();
  btn.title = posters ? "Show banners in the panels below" : "Show posters in the panels below";
  btn.innerHTML = `<span class="nav-icon">${posters ? withCineIcon(ICON_BANNER_SHAPE, CINE_NAV_ICONS.banner) : withCineIcon(ICON_POSTER_SHAPE, CINE_NAV_ICONS.poster)}</span><span class="nav-label">Panels to <br>${posters ? "Banners" : "Posters"}</span>`;
}

// A bottom-panel thumbnail's image: the kind the panels show, else the other.
function panelThumbSrc(row) {
  return panelPosters() ? (row.posterUrl || row.bannerUrl) : (row.bannerUrl || row.posterUrl);
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

function isScrollLayout() {
  const phone = phoneLayout();
  if (phone) return phone === "portrait"; // upright: every panel one swipeable row
  return localStorage.getItem(LS_PANEL_LAYOUT) === "scroll";
}

function applyPanelLayout() {
  document.body.classList.toggle("panels-scroll", isScrollLayout());
  updateLayoutToggleButton();
  applyPanelImages();
}

function updateLayoutToggleButton() {
  const btn = document.getElementById("layoutToggleBtn");
  if (!btn) return; // only present while the Settings panel is open
  btn.classList.toggle("on", !isScrollLayout());
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
  saveImageOverride(row.tmdbId, mode, newPath, imageAreaOf(source)); // survives the next refresh
  syncImageAcrossCards(row.tmdbId, cfg, row[cfg.indexKey], row[cfg.urlKey], imageAreaOf(source));
  patchImagesForTmdbId(row.tmdbId);
}

// The same show can appear in more than one of the three bottom panels at
// once, each with its own separate row object (see getCycleRows) - without
// this, cycling the poster/banner in one place would only change that one
// card, leaving the others showing the old image until the next full
// refresh. The top carousel keeps its own pick. computeImages always populates both
// posterPaths and backdropPaths on every row regardless of that row's own
// display mode, so the same index/url is valid to apply everywhere.
function syncImageAcrossCards(tmdbId, cfg, index, url, area = "top") {
  if (tmdbId == null) return;
  // Only that side's cards: the top panel and the bottom ones keep their
  // own picks (IMAGE_AREA_KEYS). airingRows are Airing Next's own rows.
  const lists = area === "top" ? [lastRows] : [lastRecentlyWatched, lastPlanToWatch, lastAiringPreview, airingRows];
  for (const arr of lists) {
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
// rule each render function uses (cardImageBits for "main", panelThumbSrc
// for the three bottom panels - banners, or posters with Panels to
// Posters) - kept in sync with those so a patched <img> always shows what
// a full re-render of that same row would have shown.
function displaySrcFor(source, row) {
  if (source === "main") {
    const mode = getImageMode();
    const cfg = IMAGE_MODE_CONFIG[mode];
    return mode === "banner" ? (row.bannerUrl || row.posterUrl) : row[cfg.urlKey];
  }
  return panelThumbSrc(row);
}

// Poster pairs: the poster's own colors glowing into its text box from the
// side it touches - the same image, blown up and blurred, fading out across
// the box (.pp-glow).
function posterGlowHtml(src) {
  return src ? `<div class="pp-glow" aria-hidden="true"><i style="background-image:url('${esc(src)}')"></i></div>` : "";
}
// The same poster as a variable on the text box itself: the rounded inside
// corner (the box's ::before, just outside it) paints its glass from it.
function posterGlowStyle(src) {
  return src ? ` style="--pp-img:url('${esc(src)}')"` : "";
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
      const tile = newSrc && wrap.closest(".card, .list-row");
      const glow = tile && tile.querySelector(".pp-glow i");
      if (glow) {
        glow.style.backgroundImage = `url('${newSrc}')`;
        glow.parentElement.parentElement.style.setProperty("--pp-img", `url('${newSrc}')`);
      }
    });
  }
}

// A bottom-panel banner row paints its background from the banner itself
// (blurred - see the banner-row rules in style.css): whenever a row's
// banner loads - first render, a cycle, an error fallback - its wrap takes
// that image as --row-img.
document.addEventListener("load", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("list-thumb")) return;
  const wrap = img.parentElement;
  if (wrap && wrap.classList.contains("list-thumb-wrap") && wrap.parentElement.classList.contains("list-row")) {
    wrap.style.setProperty("--row-img", `url("${img.currentSrc || img.src}")`);
  }
}, true);

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
  saveImageOverride(row.tmdbId, mode, paths[nextIndex], imageAreaOf(source));
  syncImageAcrossCards(row.tmdbId, cfg, nextIndex, nextUrl, imageAreaOf(source));
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
  if (!isImdbId(imdbId)) return "";
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
  if (!isImdbId(imdbId)) return inner;
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
    // .panel-shows-flip-back (the "all shows" grid's flipped-open, 2-column-
    // wide card back) has no .list-row of its own but holds the exact same
    // .list-row-title-wrap shape and just as much real width - without it
    // here, box fell through to null and the popover sized itself off the
    // tiny badge instead, squeezing every rating tile into a 150px sliver.
    const box = el.closest(".poster-wrap") || el.closest(".list-row") || el.closest(".panel-shows-flip-back") || el.closest(".card");
    const b = (box || el).getBoundingClientRect();
    const mode = box && (box.classList.contains("list-row") || box.classList.contains("panel-shows-flip-back")) ? "list" : "banner";
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
        <div class="rt-label">${esc(e.label)}</div>
      </div>
    </div>`).join("")}</div>${ratingsKeyHintHtml(entries)}`;
}

// Fills the ratings block under a show's header in the search window. Works
// for any show (not just ones on the list): TMDB id -> TMDB score, IMDb id ->
// MDBList. Whatever's missing is just left out.
async function fillDetailRatings(show, libraryMatch) {
  const el = document.getElementById("detailRatings");
  if (!el) return;
  const ids = show.ids || {};
  const libIds = (libraryMatch && libraryMatch.item.show && libraryMatch.item.show.ids) || {};
  const tmdbId = ids.tmdb || libIds.tmdb;
  const imdbId = ids.imdb || libIds.imdb;
  try {
    const showDetail = tmdbId && sharedCache ? await sharedCache.getShow(tmdbId) : null;
    const recent = isRecentShow(showDetail && showDetail.first_air_date);
    const ratings = await loadRatings(showDetail && showDetail.vote_average, imdbId, recent);
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
// The top panel's title icon: a screen with a play mark (the logo's).
const READY_ICON_SVG = `<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="3" width="18" height="15" rx="3.5" fill="var(--accent2)"></rect><polygon points="10,7.6 10,13.4 15,10.5" fill="var(--card)"></polygon><rect x="8" y="20" width="8" height="2" rx="1" fill="var(--accent2)"></rect></svg>`;
const CALENDAR_ICON_SVG = `<svg viewBox="0 0 24 24" width="17" height="17"><rect x="3" y="5" width="18" height="16" rx="2" fill="var(--accent2)"></rect><rect x="3" y="9" width="18" height="1.8" fill="var(--card)"></rect><rect x="7" y="2.5" width="1.8" height="4" rx="0.9" fill="var(--card)"></rect><rect x="15.2" y="2.5" width="1.8" height="4" rx="0.9" fill="var(--card)"></rect></svg>`;
// The cinematic look's title icons (theme/cinematic.css): solid, in the
// title's ink on its gold brush stroke - a clapperboard, a calendar of
// days, an eye with a tick (seen), and a star. Each title carries both its usual icon and this
// one; the stylesheet shows the one its theme wants.
const CINE_TITLE_ICONS = {
  ready: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" fill-rule="evenodd"><path transform="rotate(-13 3 9)" d="M3 3.8h18v5.2H3z M5.60 3.8h2.4l-1.7 5.2h-2.4z M9.90 3.8h2.4l-1.7 5.2h-2.4z M14.20 3.8h2.4l-1.7 5.2h-2.4z M18.50 3.8h2.4l-1.7 5.2h-2.4z"></path><path d="M4.6 10.4h14.8a1.6 1.6 0 0 1 1.6 1.6v8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 20v-8a1.6 1.6 0 0 1 1.6-1.6z M4.90 11.2h2.3l1.4 2.8h-2.3z M9.00 11.2h2.3l1.4 2.8h-2.3z M13.10 11.2h2.3l1.4 2.8h-2.3z M17.20 11.2h2.3l1.4 2.8h-2.3z"></path></svg>`,
  airing: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><rect x="6" y="1.5" width="2.4" height="5" rx="1.2"></rect><rect x="15.6" y="1.5" width="2.4" height="5" rx="1.2"></rect><path fill-rule="evenodd" d="M4.5 4h15A2.5 2.5 0 0 1 22 6.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 19.5v-13A2.5 2.5 0 0 1 4.5 4zM4.4 9.2v10.2c0 .2.1.3.3.3h14.6c.2 0 .3-.1.3-.3V9.2z"></path><rect x="6" y="11" width="3.2" height="3" rx="0.5"></rect><rect x="10.4" y="11" width="3.2" height="3" rx="0.5"></rect><rect x="14.8" y="11" width="3.2" height="3" rx="0.5"></rect><rect x="6" y="15.3" width="3.2" height="3" rx="0.5"></rect><rect x="10.4" y="15.3" width="3.2" height="3" rx="0.5"></rect><rect x="14.8" y="15.3" width="3.2" height="3" rx="0.5"></rect></svg>`,
  watched: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" fill-rule="evenodd"><path d="M12 4.5c5.4 0 9.3 4.3 10.5 6.5-1.2 2.2-5.1 6.5-10.5 6.5S2.7 13.2 1.5 11C2.7 8.8 6.6 4.5 12 4.5zM12 7.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z"></path><circle cx="12" cy="11" r="1.5"></circle><circle cx="18.2" cy="17.8" r="5" fill="var(--card)"></circle><circle cx="18.2" cy="17.8" r="3.9"></circle><path d="M16.2 17.9l1.5 1.5 2.8-2.8" fill="none" stroke="var(--card)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>`,
  plan: `<svg viewBox="0 0 24 24" width="24" height="24"><polygon points="12,1.8 14.9,8.6 22.3,9.2 16.7,14.1 18.4,21.4 12,17.5 5.6,21.4 7.3,14.1 1.7,9.2 9.1,8.6" fill="currentColor"></polygon></svg>`,
};
// ...and the buttons' icons, in the same solid style, on their gold tiles.
const CINE_NAV_ICONS = {
  poster: `<svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path fill-rule="evenodd" d="M7.5 1.5h9A2.5 2.5 0 0 1 19 4v16a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 20V4a2.5 2.5 0 0 1 2.5-2.5zM7.6 4.2v11.6h8.8V4.2z"></path><polygon points="7.6,15.8 10.6,11 12.4,13.4 13.6,12 16.4,15.8"></polygon><circle cx="14.2" cy="7" r="1.4"></circle></svg>`,
  banner: `<svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path fill-rule="evenodd" d="M3.5 5h17A2.5 2.5 0 0 1 23 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 1 16.5v-9A2.5 2.5 0 0 1 3.5 5zM3.6 7.6v8.8h16.8V7.6z"></path><polygon points="3.6,16.4 8.5,10.8 11.5,14 13.5,12.2 17.5,16.4"></polygon><circle cx="16.8" cy="10" r="1.4"></circle></svg>`,
  search: `<svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><path fill-rule="evenodd" d="M10 1.8a8.2 8.2 0 1 1 0 16.4 8.2 8.2 0 0 1 0-16.4zM10 5.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6z"></path><line x1="15.9" y1="15.9" x2="21" y2="21" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"></line><path d="M7.4 8.6a3.2 3.2 0 0 1 2.4-1.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path></svg>`,
  stats: `<svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor"><rect x="2.5" y="12" width="5" height="9.5" rx="1.5"></rect><rect x="9.5" y="3.5" width="5" height="18" rx="1.5"></rect><rect x="16.5" y="8" width="5" height="13.5" rx="1.5"></rect></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="23" height="23"><path fill="currentColor" fill-rule="evenodd" d="M19.94 9.96 L22.46 10.28 L22.46 13.72 L19.94 14.04 L19.06 16.17 L20.61 18.18 L18.18 20.61 L16.17 19.06 L14.04 19.94 L13.72 22.46 L10.28 22.46 L9.96 19.94 L7.83 19.06 L5.82 20.61 L3.39 18.18 L4.94 16.17 L4.06 14.04 L1.54 13.72 L1.54 10.28 L4.06 9.96 L4.94 7.83 L3.39 5.82 L5.82 3.39 L7.83 4.94 L9.96 4.06 L10.28 1.54 L13.72 1.54 L14.04 4.06 L16.17 4.94 L18.18 3.39 L20.61 5.82 L19.06 7.83Z M15.4 12a3.4 3.4 0 1 0-6.8 0 3.4 3.4 0 1 0 6.8 0z"></path></svg>`,
};
// ...and Ready to Watch's three stats, solid like the rest.
const CINE_STAT_ICONS = {
  tv: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" fill-rule="evenodd"><path d="M8.2 1.6l3.8 3.2 3.8-3.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path><path d="M4 5.4h16A2.5 2.5 0 0 1 22.5 7.9v10.2a2.5 2.5 0 0 1-2.5 2.5H4a2.5 2.5 0 0 1-2.5-2.5V7.9A2.5 2.5 0 0 1 4 5.4zM4.3 8.1v9.8h15.4V8.1z"></path><polygon points="10,10.2 10,15.8 14.8,13"></polygon><rect x="6.5" y="21.3" width="11" height="1.9" rx="0.95"></rect></svg>`,
  stack: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="12 1.8 22 7.4 12 13 2 7.4"></polygon><polyline points="2.6 12 12 17.2 21.4 12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></polyline><polyline points="2.6 16.6 12 21.8 21.4 16.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" fill-rule="evenodd"><path d="M12 1.5a10.5 10.5 0 1 1 0 21 10.5 10.5 0 0 1 0-21zM11 5.4h2v6.1l3.9 2.3-1 1.7-4.9-2.9z"></path></svg>`,
};
const withCineIcon = (usual, cineSvg) =>
  `<span class="title-icon-usual">${usual}</span><span class="title-icon-cine">${cineSvg}</span>`;
const titleIcons = (usual, cine) => withCineIcon(usual, CINE_TITLE_ICONS[cine]);
// The three buttons written into index.html get theirs once, here.
for (const [id, key] of [["addShowBtn", "search"], ["statsBtn", "stats"], ["settingsBtn", "settings"]]) {
  const icon = document.querySelector(`#${id} .nav-icon`);
  if (icon) icon.innerHTML = withCineIcon(icon.innerHTML, CINE_NAV_ICONS[key]);
}

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
    ? `<img class="${posterClass}" loading="lazy" src="${esc(imageUrl)}" alt="${esc(row.title)}" onerror="handleThumbError(this, 'main', ${arrIdx}, '${mode}')">`
    : `<div class="${posterClass} placeholder">${esc((row.title[0] || "?").toUpperCase())}</div>`;
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
        <img class="network-badge-logo" loading="lazy" src="${esc(row.networkLogoPath)}" alt="${esc(row.network || "")}"
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

// Pictures resized by wsrv.nl (outside-sources.js says why).
const resizedImage = OutsideSources.resizedImage;

// The picker's extra sources are other people's servers, and one of them now
// and then just doesn't answer: every request to them gives up after
// EXTRA_IMAGES_TIMEOUT_MS (a failure, so nothing is cached and the next
// opening tries again) instead of keeping "loading more…" up for good.
const EXTRA_IMAGES_TIMEOUT_MS = 8000;
function fetchWithTimeout(url, options = {}, timeoutMs = EXTRA_IMAGES_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// TVMaze allows about 20 calls per 10 seconds per address, and the episode
// lists spend most of that while the page loads - so a picker opened soon
// after was turned away and showed no TVMaze pictures until it was opened
// again. Its "429 Too Many Requests" usually reaches the page as a plain
// network error (the refusal lacks the header that lets a page read it), so
// both wait and try again (1.5s, 3s, 6s); a timeout doesn't.
async function tvmazePickerGet(url, timeoutMs) {
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      await tvmazeSlot();
      res = await fetchWithTimeout(url, {}, timeoutMs);
    } catch (e) {
      if (e.name === "AbortError" || attempt >= 3) throw e;
    }
    if (res && (res.status !== 429 || attempt >= 3)) return res;
    await new Promise(r => setTimeout(r, 1500 * 2 ** attempt));
  }
}

// The picker's extra sources (outside-sources.js): TVMaze and Metahub with no
// key, Fanart.tv and TheTVDB with the keys from Settings.
const metahubImages = OutsideSources.metahubImages;
const imageSources = OutsideSources.createImageSources({
  fetchWithTimeout,
  tvmazeGet: tvmazePickerGet,
  persisted: { read: readPersistedCache, write: writePersistedCache },
  fanartKey: () => getConfig().fanartKey,
  tvdbKey: () => getConfig().tvdbKey,
  tokenStore: {
    read() { try { return JSON.parse(localStorage.getItem(LS_TVDB_TOKEN) || "null"); } catch (e) { return null; } },
    write(v) { safeSetItem(LS_TVDB_TOKEN, JSON.stringify(v)); },
  },
  onRejected: name => showToast(`${name} rejected the API key - check it in Settings.`, true),
});
const fetchKeylessImages = imageSources.keyless;
const fetchFanartImages = imageSources.fanart;
const fetchTvdbImages = imageSources.tvdb;
const tvdbToken = imageSources.tvdbToken;
const TVDB_API = "https://api4.thetvdb.com/v4"; // also for the air-date check (library.js)

// All extra images for the picker: Fanart.tv first (curated), then TheTVDB,
// then TVMaze and Metahub. The same picture can come from more than one of
// them, so repeats are dropped. The sources load side by side, not one after
// another, and `onUpdate` gets the list so far each time one of them
// arrives, so the picker fills in as they come. Fanart.tv and TheTVDB need
// the show's TheTVDB id: TMDB's (already cached) when it has one, so they
// needn't wait for TVMaze, else TVMaze's.
async function fetchExtraImages(imdbId, tmdbId, onUpdate = () => {}) {
  const empty = { poster: [], banner: [] };
  const parts = { fanart: empty, tvdb: empty, keyless: empty, metahub: empty };
  const merged = kind => {
    const seen = new Set();
    return parts.fanart[kind].concat(parts.tvdb[kind], parts.keyless[kind], parts.metahub[kind]).filter(e => !seen.has(e.url) && seen.add(e.url));
  };
  const result = () => ({ poster: merged("poster"), banner: merged("banner") });
  const arrive = name => found => { parts[name] = found; onUpdate(result()); return found; };
  // Metahub's pictures are plain links by IMDb id - nothing to ask first - so
  // they show at once instead of waiting behind TVMaze (which still lists
  // them too, for its cache; repeats are dropped).
  if (imdbId) arrive("metahub")(metahubImages(imdbId));

  const keylessLoad = fetchKeylessImages(imdbId).then(arrive("keyless"));
  const cfg = getConfig();
  const keyed = (async () => {
    if (!cfg.fanartKey && !cfg.tvdbKey) return;
    let tvdbId = null;
    if (tmdbId && sharedCache) {
      try {
        const detail = await sharedCache.getShow(tmdbId); // already cached; carries external_ids
        tvdbId = detail && detail.external_ids && detail.external_ids.tvdb_id;
      } catch (e) { /* TMDB unreachable: TVMaze's id below */ }
    }
    if (!tvdbId) tvdbId = (await keylessLoad).tvdbId;
    await Promise.all([
      fetchFanartImages(tvdbId).then(arrive("fanart")),
      fetchTvdbImages(tvdbId).then(arrive("tvdb")),
    ]);
  })();
  await Promise.all([keylessLoad, keyed]);
  return result();
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
  saveImageOverride(row.tmdbId, mode, url, imageAreaOf(source));
  syncImageAcrossCards(row.tmdbId, cfg, -1, url, imageAreaOf(source));
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
    ? `<img id="imagePickerPreview" src="${esc(previewSrc)}" alt="${esc(row.title)}">`
    : `<div class="picker-ident-placeholder">${esc((row.title[0] || "?").toUpperCase())}</div>`;
  const tmdbEntries = paths.map((p, i) => ({ url: cfg.base + p, thumb: thumbBase + p, index: i }));
  let extras = [];
  let extrasState = row.imdbId ? "loading" : "done";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "imagePickerOverlay";
  overlay.style.paddingTop = `${modalTopGap()}px`;
  overlay.innerHTML = `
    <div class="modal-box picker-box">
      <div class="picker-head">
        <span class="picker-title">Choose ${noun}</span>
        <button class="modal-close-btn" id="imagePickerCloseBtn">&times;</button>
      </div>
      <div class="picker-cols">
        <div class="picker-ident">
          <div class="picker-ident-img is-${noun}">${identityHtml}</div>
          <div class="picker-ident-name">${esc(row.title)}</div>
          ${year ? `<div class="picker-ident-year">${year}</div>` : ""}
        </div>
        <div class="picker-main">
          <div class="picker-count" id="imagePickerCount"></div>
          <div class="picker-grid is-${noun}" id="imagePickerGrid"></div>
        </div>
      </div>
      <div class="picker-foot">
        <span>Your pick is applied when you press Done<span class="picker-credit" id="imagePickerCredit" hidden>
          &middot; Images from <a href="https://thetvdb.com" target="_blank" rel="noopener">TheTVDB.com</a></span></span>
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
        <img loading="lazy" alt="" src="${esc(e.thumb)}" onerror="this.closest('.picker-th').remove()">
        ${e.url === current ? `<span class="picker-tag">${e.url === originalUrl ? "Current" : "Selected"}</span>` : ""}
        ${e.src ? `<span class="picker-src">${esc(e.src)}</span>` : ""}
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
    if (preview) {
      // A picture that turns out to be gone (the source dropped it) leaves
      // the gallery, and the selection goes back to what the card shows.
      preview.onerror = () => {
        if (pendingEntry !== entry) return;
        extras = extras.filter(x => x !== entry);
        pendingEntry = null;
        pendingUrl = originalUrl;
        preview.onerror = null;
        preview.src = originalUrl || row.posterUrl || "";
        renderGrid();
        showToast("That picture is no longer available - pick another.", true);
      };
      preview.src = entry.url;
    }
    renderGrid();
  };

  if (row.imdbId) {
    // Each source's pictures join the grid as soon as that source answers.
    const show = (found, done) => {
      if (!overlay.isConnected) return; // closed while loading
      extras = found[mode] || [];
      if (done) extrasState = "done";
      const credit = document.getElementById("imagePickerCredit");
      if (credit) credit.hidden = !extras.some(e => e.src === "TheTVDB");
      renderGrid();
    };
    fetchExtraImages(row.imdbId, row.tmdbId, found => show(found, false))
      .then(found => show(found, true), () => show({ poster: extras, banner: extras }, true));
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
