"use strict";

// The three bottom panels' markup, the air countdowns, and the greeting
// with its today list and account menu.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// Computes the click-to-open-the-image-picker wrapper attributes for a bottom-panel
// thumbnail (Recently Watched / Plan to Watch / Airing Next), matching the
// same convention cardImageBits uses for the top carousel card.
//
// These thumbnails show the panels' own image kind (panelThumbSrc: banners,
// or posters with Panels to Posters), falling back to the other one - so
// the picker has to list whichever of the two is actually on screen, not
// follow getImageMode() (which governs the top carousel).
function thumbCycleAttrs(row, source, idx) {
  const mode = panelPosters() ? (row.posterUrl ? "poster" : "banner") : (row.bannerUrl ? "banner" : "poster");
  const cfg = IMAGE_MODE_CONFIG[mode];
  const altCount = (row[cfg.pathsKey] || []).length;
  if (altCount <= 1 && !row.imdbId) return { cycleableClass: "", attrs: "", mode };
  return {
    cycleableClass: " cycleable",
    attrs: ` data-cycle-key="${source}-${idx}" title="Choose a different image"${onClick("imagePicker", source, idx, mode)}`,
    mode,
  };
}

// Network sub-line: shows the TMDB network logo image when available,
// falling back to the plain text name (both if the show has no logo_path,
// and live if the logo image itself fails to load).
function networkSubHtml(name, logoPath) {
  if (logoPath) {
    return `<div class="list-row-sub network-sub">
        <img class="network-logo" loading="lazy" src="${esc(logoPath)}" alt="${esc(name || "")}"${onError("networkLogoFailed")}>
        <span class="network-name-fallback" style="display:none">${esc(name || "")}</span>
      </div>`;
  }
  return name ? `<div class="list-row-sub">${esc(name)}</div>` : "";
}

// Right-aligned show count for a bottom panel's header row - same
// margin-left:auto trick as .series-panel-updated in the top carousel's
// own header, just reused here instead of duplicated. Doubles as the
// entry point into that panel's "all shows" modal (openPanelShowsModal).
function listPanelCountHtml(count, source) {
  const word = `Show${count === 1 ? "" : "s"}`;
  return `<button type="button" class="list-panel-count" title="${count} ${word.toLowerCase()}"${onClick("panelShows", source)}><span class="list-panel-count-num">${count}</span><span class="list-panel-count-word"> ${word}</span></button>`;
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
    ? (isImdbId(row.imdbId)
        ? `<div class="list-row-title"><a href="https://www.imdb.com/title/${row.imdbId}/" target="_blank" rel="noopener"${clickStop()}>${esc(row.title)}</a></div>`
        : `<div class="list-row-title">${esc(row.title)}</div>`)
    : `<div class="list-row-title" title="View cast"${onClickStop("cast", source, idx)}>${esc(row.title)}</div>`;
  // In the one-page layout the badges and IMDb rating sit on the thumbnail
  // (thumbBarHtml), so the row's text leaves them out; the flip-card back
  // face and the older scrolling layout keep them as text.
  const rich = mode === "flip" || isScrollLayout();

  if (source === "watched") {
    const episodeCode = `S${String(row.season).padStart(2, "0")}E${String(row.episode).padStart(2, "0")}`;
    const episodeTitleHtml = row.episodeTitle ? `<div class="episode-title">${esc(row.episodeTitle)}</div>` : "";
    const badgeModifier = row.badge === "SEASON FINALE" ? " finale" : row.badge === "DROPPED" ? " dropped" : "";
    const badgeHtml = (rich && row.badge) ? `<div class="premiere-badge${badgeModifier}">${badgeText(row)}</div>` : "";
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
      ? `<div class="premiere-badge${row.ended ? " finale" : ""}${row.airedTone ? " tag-" + row.airedTone : ""}">${row.airedLabel}</div>`
      : "";
    const yearBadgeHtml = row.yearRangeLabel
      ? `<div class="premiere-badge year-badge">${row.yearRangeLabel}</div>`
      : "";
    const contentMetaHtml = (row.contentRating || row.genreLabel)
      ? `<div class="content-meta-row">
          ${row.contentRating ? `<span class="content-rating-badge">${row.contentRating}</span>` : ""}
          ${row.genreLabel ? `<span class="genre-label">${esc(row.genreLabel)}</span>` : ""}
        </div>`
      : "";
    const imdbHtml = rich ? `<div class="list-imdb">${imdbPillHtml(row.imdbRating, row.imdbId, row.ratings)}</div>` : "";
    // The older scrolling layout keeps the year badge beside the title.
    const titleBlockHtml = isScrollLayout()
      ? `<div class="title-with-year">${titleHtml}${yearBadgeHtml}</div>`
      : `${titleHtml}${yearBadgeHtml}`;
    return `
      ${titleBlockHtml}
      ${networkSubHtml(row.network, row.networkLogoPath)}
      ${badgeHtml}
      ${imdbHtml}
      ${rich ? contentMetaHtml : ""}`;
  }

  if (source === "main" && currentView !== "airing") {
    // The top panel's own "My Watch List" row shape (renderRows) - a
    // progress/remaining-episode count instead of an "aired" badge, no
    // genre/content-rating (that's Plan to Watch only).
    const episodeTitleHtml = row.episodeTitle ? `<div class="episode-title">${esc(row.episodeTitle)}</div>` : "";
    const badgeHtml = row.badge
      ? `<div class="premiere-badge${row.badge === "SEASON FINALE" ? " finale" : ""}">${badgeText(row)}</div>`
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
  const episodeTitle = row.nextEpisodeTitle ? `<div class="episode-title">${esc(row.nextEpisodeTitle)}</div>` : "";
  const badgeHtml = (rich && row.badge)
    ? `<div class="premiere-badge${row.badge === "SEASON FINALE" ? " finale" : ""}">${badgeText(row)}</div>`
    : "";
  const imdbRowHtml = rich ? `<div class="list-imdb">${imdbPillHtml(row.imdbRating, row.imdbId, row.ratings)}</div>` : "";
  return `
    ${titleHtml}
    <div class="network-imdb-row">
      ${networkSubHtml(row.network, row.networkLogoPath)}
      ${imdbRowHtml}
    </div>
    <div class="next-up-row">
      <span class="next-up">Next: ${row.nextLabel}</span>
      ${badgeHtml}
    </div>
    ${episodeTitle}
    ${row.airDateLabel ? `<div class="list-row-airdate">&#128197; ${airDateText(row)}</div>` : ""}`;
}

function pagedRangeLabel(start, end, total) {
  return start + 1 === end ? `${end} of ${total}` : `${start + 1}-${end} of ${total}`;
}

function pagerControlsHtml(firstLabel, hasMore) {
  return `
    <div class="list-pager">
      <button type="button" class="list-pager-arrow prev off" title="Previous"${onClick("pager", -1)}>&lsaquo;</button>
      <span class="list-pager-range">${firstLabel}</span>
      <button type="button" class="list-pager-arrow next${hasMore ? "" : " off"}" title="Next"${onClick("pager", 1)}>&rsaquo;</button>
    </div>`;
}

// A page's rows no longer sit back to back - the leftover height that
// equalizes this panel with its tallest sibling (.bottom-panels-row) all
// lands in the one gap between them (.list-page's justify-content:
// space-between), so a dedicated divider rides in the middle of that gap
// instead of a border glued to the first row's own bottom edge.
function stackedRowsHtml(items, start, rowHtmlFn) {
  return items.map((item, i) =>
    (i > 0 ? `<div class="list-row-divider"></div>` : "") + rowHtmlFn(item, start + i)
  ).join("\n");
}

// Builds the paged, swipeable replacement for a bottom panel's row list:
// `pageSize` stacked rows per page, the last page holding whatever is left
// (no show repeated across pages). Row markup itself comes from
// `rowHtmlFn(item, idx)`, idx being the item's index in the FULL list (not
// the page), since row handlers like openCastModal/openPlanCardMenu index
// into that full list.
function pagedPanelHtml(list, pageSize, rowHtmlFn) {
  const n = list.length;
  const windows = [];
  for (let s = 0; s < n; s += pageSize) windows.push({ start: s, items: list.slice(s, s + pageSize) });
  const pagesHtml = windows.map(({ start, items }) =>
    `<div class="list-page" data-range="${pagedRangeLabel(start, start + items.length, n)}">${stackedRowsHtml(items, start, rowHtmlFn)}</div>`
  ).join("\n");
  const firstLabel = windows.length ? pagedRangeLabel(windows[0].start, windows[0].start + windows[0].items.length, n) : "";
  return { pagerHtml: pagerControlsHtml(firstLabel, windows.length > 1), rowsWrapHtml: `<div class="list-rows-paged">${pagesHtml}</div>` };
}

// Airing Next's wider panel: 2-show columns, each half the panel wide, so a
// drag or an arrow click can stop after any single column (2 shows) instead
// of only every 4. Each column's range label covers the 4 shows visible
// when that column sits on the left.
function pagedColumnsHtml(list, rowHtmlFn) {
  const n = list.length;
  const starts = [];
  for (let s = 0; s < n; s += 2) starts.push(s);
  const colsHtml = starts.map(s =>
    `<div class="list-page list-page--half" data-range="${pagedRangeLabel(s, Math.min(s + 4, n), n)}">${stackedRowsHtml(list.slice(s, s + 2), s, rowHtmlFn)}</div>`
  ).join("\n");
  return {
    pagerHtml: pagerControlsHtml(n ? pagedRangeLabel(0, Math.min(4, n), n) : "", starts.length > 2),
    rowsWrapHtml: `<div class="list-rows-paged list-rows-paged--cols">${colsHtml}</div>`,
  };
}

// Panels to Posters: one page per pair of shows, an L-shaped tile each (see
// .panel-pair, the top panel's .poster-pair rules), an odd last show on its
// own. A pair is as wide as it needs - wider than a narrow panel, where the
// second poster is cut at the edge and comes in with a drag. byShow: the
// arrows step one show (poster + its details) at a time, not a pair
// (trackStops) - for the narrow panels.
function pairedPanelHtml(list, rowHtmlFn, { byShow = false } = {}) {
  const n = list.length;
  const pages = [];
  for (let s = 0; s < n; s += 2) {
    const items = list.slice(s, s + 2);
    pages.push(`<div class="list-page list-page--pair" data-range="${pagedRangeLabel(s, s + items.length, n)}">` +
      `<div class="panel-pair${items.length === 1 ? " single" : ""}">${items.map((item, i) => rowHtmlFn(item, s + i)).join("")}</div></div>`);
  }
  return {
    pagerHtml: pagerControlsHtml(n ? pagedRangeLabel(0, byShow ? 1 : Math.min(2, n), n) : "", byShow ? n > 1 : pages.length > 1),
    rowsWrapHtml: `<div class="list-rows-paged list-rows-paged--pairs${byShow ? " by-show" : ""}">${pages.join("\n")}</div>`,
  };
}

// A row's details: in a pair they sit in the tile's half-height box
// (.list-row-body), its text measured inside it (fitPanelRowLines), over
// the poster's glow (posterGlowHtml) - `src`, the poster shown beside it.
function rowDetailsHtml(inner, src) {
  const wrap = `<div class="list-row-title-wrap">${inner}</div>`;
  return panelPosters() ? `<div class="list-row-body"${posterGlowStyle(src)}>${posterGlowHtml(src)}${wrap}</div>` : wrap;
}

// Bottom-panel row frames alternate between the top panel's two pair colors
// (blue / brown) - Airing Next's two visible columns as a checkerboard.
function rowToneClass(idx, checker) {
  const n = checker ? idx + Math.floor(idx / 2) : idx;
  return n % 2 ? "tone-b" : "tone-a";
}

// The older scrolling layout: every row in one vertically scrolling list,
// no pager.
function scrollPanelHtml(list, rowHtmlFn) {
  return { pagerHtml: "", rowsWrapHtml: `<div class="list-rows-scroll">${list.map(rowHtmlFn).join("\n")}</div>` };
}

function renderRecentlyWatchedHtml(list) {
  if (!list || !list.length) return "";
  const scroll = isScrollLayout();
  const rowHtmlFn = (ep, idx) => {
    const bannerSrc = panelThumbSrc(ep);
    const { cycleableClass, attrs, mode } = thumbCycleAttrs(ep, "watched", idx);
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" loading="lazy" src="${esc(bannerSrc)}" alt="${esc(ep.title)}"${onError("thumbError", "watched", idx, mode)}>`
      : `<div class="list-thumb placeholder">${esc((ep.title[0] || "?").toUpperCase())}</div>`;
    return `
      <div class="list-row ${rowToneClass(idx)}">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}${scroll ? "" : thumbBarHtml("", ep)}</div>
        ${rowDetailsHtml(rowInfoWrapHtml(ep, idx, "watched", "row"), bannerSrc)}
        ${scroll ? `<span class="list-check">${CHECK_ICON_SVG}</span>` : ""}
      </div>`;
  };
  const { pagerHtml, rowsWrapHtml } = scroll ? scrollPanelHtml(list, rowHtmlFn) : panelPosters() ? pairedPanelHtml(list, rowHtmlFn, { byShow: true }) : pagedPanelHtml(list, 2, rowHtmlFn);

  return `
    <div class="list-panel list-panel--watched">
      <div class="list-panel-header-row">
        <div class="list-panel-header">${titleIcons(CLOCK_ICON_SOLID_SVG, "watched")}<span>Just Watched</span></div>
        ${pagerHtml}
        ${listPanelCountHtml(list.length, "watched")}
      </div>
      ${rowsWrapHtml}
    </div>`;
}

function renderPlanToWatchHtml(list) {
  if (!list || !list.length) return "";
  const scroll = isScrollLayout();
  const rowHtmlFn = (row, idx) => {
    const bannerSrc = panelThumbSrc(row);
    const { cycleableClass, attrs, mode } = thumbCycleAttrs(row, "plan", idx);
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" loading="lazy" src="${esc(bannerSrc)}" alt="${esc(row.title)}"${onError("thumbError", "plan", idx, mode)}>`
      : `<div class="list-thumb placeholder">${esc((row.title[0] || "?").toUpperCase())}</div>`;
    return `
      <div class="list-row ${rowToneClass(idx)}">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}${scroll ? "" : thumbBarHtml(imdbButtonHtml(row.imdbId, row.imdbRating, row.ratings))}</div>
        ${rowDetailsHtml(rowInfoWrapHtml(row, idx, "plan", "row"), bannerSrc)}
        ${scroll ? `<span class="list-check">${STAR_ICON_SVG}</span>` : ""}
        <button class="card-menu-btn plan-menu-btn" title="Manage"${onClickStop("planMenu", idx)}>&#8942;</button>
      </div>`;
  };
  const { pagerHtml, rowsWrapHtml } = scroll ? scrollPanelHtml(list, rowHtmlFn) : panelPosters() ? pairedPanelHtml(list, rowHtmlFn, { byShow: true }) : pagedPanelHtml(list, 2, rowHtmlFn);

  return `
    <div class="list-panel list-panel--plan">
      <div class="list-panel-header-row">
        <div class="list-panel-header">${titleIcons(BOOKMARK_ICON_SVG, "plan")}<span>Plan to Watch</span></div>
        ${pagerHtml}
        ${listPanelCountHtml(list.length, "plan")}
      </div>
      ${rowsWrapHtml}
    </div>`;
}

// The corner chip on an Airing Next thumbnail: empty here, filled in (and
// kept current) by tickAirCountdowns from the time or date it carries.
// The tag under an Airing Next chip: where its date/time came from.
const AIR_SOURCE_LABELS = { tvmaze: "TVMAZE", tmdb: "TMDB", simkl: "SIMKL", yes: "YES", tvdb: "TVDB" };
function airCountHtml(row) {
  if (row.airStart == null && !row.airDay) return "";
  const attrs = row.airStart != null
    ? `data-air-start="${row.airStart}"${row.airEnd != null ? ` data-air-end="${row.airEnd}"` : ""}`
    : `data-air-day="${row.airDay}"`;
  const from = AIR_SOURCE_LABELS[row.airFrom] ? row.airFrom : null;
  return `<div class="air-count${from ? ` from-${from}` : ""}" ${attrs}${from ? ` data-from="${AIR_SOURCE_LABELS[from]}"` : ""} hidden></div>`;
}

function paintAirCount(el, now) {
  const start = el.dataset.airStart ? Number(el.dataset.airStart) : null;
  const end = el.dataset.airEnd ? Number(el.dataset.airEnd) : null;
  const c = airCountdown(start, end, now, el.dataset.airDay || null);
  el.hidden = !c;
  el.classList.toggle("live", !!(c && c.live));
  el.classList.toggle("day", !!(c && c.dateOnly));
  if (!c) return;
  const clock = ms => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  // An episode with an exact time shows it small under the count (the
  // panels' date line has no room for it with long titles).
  const at = !c.live && !c.dateOnly && start != null ? `<span class="air-count-t">${clock(start)}</span>` : "";
  el.innerHTML = c.live
    ? `<span class="air-count-n"><span class="air-dot"></span>NOW</span><span class="air-count-u">ends ${clock(end)}</span>`
    : `<span class="air-count-n">${c.n}</span>${c.unit ? `<span class="air-count-u">${c.unit}</span>` : ""}${at}`;
}

function tickAirCountdowns() {
  const now = Date.now();
  document.querySelectorAll(".air-count").forEach(el => paintAirCount(el, now));
  updateGreetingStatus(now); // the day may have turned
  paintBridgeAlert(); // the bridge may have gone quiet
  // A report going stale ends the watch: its show goes back to its place.
  if (embyNow) syncWatchingOrder() || applyNowWatching();
}

// ---------------------------------------------------------------------
// The greeting at the foot of the box on the left: under "Hi Elad" a line
// with what's on today - how many episodes in Airing Next air today (a
// button: it opens their list, each with its time) and how many shows are
// Ready to Watch. The profile picture is a button: it opens a small menu - who is
// signed in, change the picture (kept in the account, so every device
// shows it), sign out.
// ---------------------------------------------------------------------
const LS_PROFILE_PHOTO = "profile_photo";
const PROFILE_PHOTO_PX = 160;

function localDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The Airing Next rows that air today (this device's day), in air order.
function airingToday(list, now) {
  const today = localDayKey(now);
  return (list || [])
    .filter(r => r.airStart != null
      ? localDayKey(r.airStart) === today || (r.airEnd != null && r.airStart <= now && now < r.airEnd)
      : r.airDay === today)
    .sort((a, b) => (a.airStart ?? Infinity) - (b.airStart ?? Infinity));
}

function updateGreetingStatus(now = Date.now()) {
  const el = document.getElementById("greetingStatus");
  if (!el) return;
  if (!lastRows) { el.hidden = true; return; }
  const today = airingToday(lastAiringPreview, now);
  const timeOf = r => (r.airStart == null ? "Today"
    : r.airEnd != null && r.airStart <= now && now < r.airEnd ? "NOW"
    : new Date(r.airStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
  // Two lines under "Hi Elad": what's on today (opens tonight's list), and
  // how many shows are ready to watch.
  const ready = `<span class="gs-sum gs-ready"><b>${lastRows.length}</b> ready to watch</span>`;
  el.innerHTML = (today.length
    ? `<button type="button" class="gs-sum gs-open" id="todayBtn" aria-haspopup="dialog" aria-expanded="${!todayPop().hidden}" title="What's on today"><b>${today.length}</b> on today <span class="gs-caret">▴</span></button>`
    : `<span class="gs-sum">Nothing on today</span>`) + ready;
  el.hidden = false;
  const pop = todayPop();
  if (!today.length) { pop.hidden = true; return; }
  pop.innerHTML = `<div class="today-pop-h">Today</div>`
    + today.map(r => `<div class="today-pop-ep"><em>${timeOf(r)}</em><span>${esc(r.title)}</span></div>`).join("");
}
const todayPop = () => document.getElementById("todayPop");

// The summary opens tonight's list above it; a click elsewhere or Esc
// closes it (and the account menu closes it too).
(function wireTodayPop() {
  const status = document.getElementById("greetingStatus");
  if (!status) return;
  const close = () => {
    todayPop().hidden = true;
    const btn = document.getElementById("todayBtn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  };
  status.addEventListener("click", e => {
    const btn = e.target.closest("#todayBtn");
    if (!btn) return;
    e.stopPropagation();
    const pop = todayPop();
    if (!pop.hidden) { close(); return; }
    document.getElementById("profileMenu").hidden = true;
    document.getElementById("profileMenuBtn").setAttribute("aria-expanded", "false");
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  });
  todayPop().addEventListener("click", e => e.stopPropagation());
  document.addEventListener("click", () => { if (!todayPop().hidden) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !todayPop().hidden) close(); });
})();

function applyProfilePhoto(src) {
  const img = document.querySelector("#profileMenuBtn .profile-pic-small");
  if (src && img && img.src !== src) img.src = src;
}
function safeRemoveProfilePhoto() {
  try { localStorage.removeItem(LS_PROFILE_PHOTO); } catch (e) { /* storage blocked */ }
}
try { applyProfilePhoto(localStorage.getItem(LS_PROFILE_PHOTO)); } catch (e) { /* storage blocked */ }

// The account's picture, once signed in (this device keeps a copy, so the
// next load shows it at once).
async function loadProfilePhotoFromAccount() {
  try {
    const doc = await library.backend.getMeta("profile");
    if (doc && typeof doc.photo === "string" && doc.photo.startsWith("data:image/")) {
      applyProfilePhoto(doc.photo);
      safeSetItem(LS_PROFILE_PHOTO, doc.photo);
    }
  } catch (e) {
    console.warn("Couldn't read the profile picture:", e.message);
  }
}

// A picked image cropped to a centred square and shrunk, as a JPEG data URL.
function squarePhotoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = PROFILE_PHOTO_PX;
      canvas.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, PROFILE_PHOTO_PX, PROFILE_PHOTO_PX);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("that file isn't an image")); };
    img.src = url;
  });
}

(function wireProfileMenu() {
  const btn = document.getElementById("profileMenuBtn");
  const menu = document.getElementById("profileMenu");
  if (!btn || !menu) return;
  const currentUser = () => (library && library.backend ? library.backend.currentUser() : null);
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open = () => {
    todayPop().hidden = true;
    const user = currentUser();
    document.getElementById("profileMenuWho").textContent = user ? `Signed in as ${user.email}` : "Not signed in";
    document.getElementById("profilePhotoBtn").hidden = !user;
    document.getElementById("profileSignOutBtn").hidden = !user;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };
  btn.onclick = e => { e.stopPropagation(); if (menu.hidden) open(); else close(); };
  menu.onclick = e => e.stopPropagation();
  document.addEventListener("click", () => { if (!menu.hidden) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { close(); btn.focus(); } });

  const input = document.getElementById("profilePhotoInput");
  document.getElementById("profilePhotoBtn").onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files && input.files[0];
    input.value = "";
    close();
    if (!file || !currentUser()) return;
    try {
      const photo = await squarePhotoDataUrl(file);
      applyProfilePhoto(photo);
      safeSetItem(LS_PROFILE_PHOTO, photo);
      await library.backend.setMeta("profile", { photo, savedAt: Date.now() });
      showToast("Profile picture saved");
    } catch (err) {
      showToast(`Couldn't save the picture: ${err.message}`, true);
    }
  };
  document.getElementById("profileSignOutBtn").onclick = () => { close(); signOutLibrary(); };
})();
