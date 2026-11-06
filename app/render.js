"use strict";

// Drawing the page: quiet refreshes, panel pagers and fitting, My List,
// Airing Next, errors and toasts.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// At the next moment something changes state - an episode starting (NOW in
// Airing Next) or ending (it moves to My List) - the panels refresh quietly.
// A moment that already passed since the panels were drawn (the page was
// in the background, its timers held back) refreshes right away.
let airBoundaryTimer = null;
let panelsRenderedAt = 0;
function scheduleAirRefresh() {
  clearTimeout(airBoundaryTimer);
  const now = Date.now();
  const moments = [];
  for (const r of lastAiringPreview || []) moments.push(r.airStart, r.airEnd);
  // A date-only episode counts as aired from 10:00 local time that day:
  // refresh then (today's or tomorrow's) while any is listed.
  if ((lastAiringPreview || []).some(r => r.airDay)) {
    const at = new Date(now);
    at.setHours(LibraryCore.DATE_ONLY_HOUR, 0, 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    moments.push(at.getTime());
  }
  let next = Infinity;
  for (const t of moments) {
    if (t == null) continue;
    if (t > panelsRenderedAt && t <= now) { next = now; break; }
    if (t > now) next = Math.min(next, t);
  }
  if (next - now > 24 * 60 * 60 * 1000) return; // also Infinity; a later render reschedules
  airBoundaryTimer = setTimeout(refreshPanelsQuietly, Math.max(0, next - now) + 2000);
}

// The panels again from what's already loaded and cached - no loading
// screen, scroll positions kept. Skipped while another screen (Settings,
// sign-in, an error, a load already under way) is showing.
async function refreshPanelsQuietly() {
  const showingPanels = () => !!document.querySelector(".bottom-panels-row, .series-panel")
    && !app.querySelector(".spinner, .film-loader") && currentView === "list";
  if (!library || !library.adapter || !showingPanels()) return;
  try {
    library.adapter.reset();
    watchingListLoad = null;
    sharedEpisodeCache = newEpisodeCache();
    const [[rows, totalEps, totalMinutes, recentlyWatched], planToWatchRows, airingNextRows] = await Promise.all([
      getMyListRows(sharedCache, sharedEpisodeCache),
      getPlanToWatchRows(sharedCache),
      getAiringNextRows(sharedCache, sharedEpisodeCache),
    ]);
    if (!showingPanels()) return; // the user moved on meanwhile
    airingRows = airingNextRows;
    renderRows(rows, totalEps, totalMinutes, recentlyWatched, planToWatchRows, airingNextRows);
  } catch (err) {
    console.warn("Quiet refresh skipped:", err.message);
  }
}

function renderAiringNextPreviewHtml(list) {
  if (!list || !list.length) return "";
  const scroll = isScrollLayout();
  const rowHtmlFn = (row, idx) => {
    const bannerSrc = panelThumbSrc(row);
    const { cycleableClass, attrs, mode } = thumbCycleAttrs(row, "airing", idx);
    const thumbHtml = bannerSrc
      ? `<img class="list-thumb" loading="lazy" src="${esc(bannerSrc)}" alt="${esc(row.title)}" onerror="handleThumbError(this, 'airing', ${idx}, '${mode}')">`
      : `<div class="list-thumb placeholder">${esc((row.title[0] || "?").toUpperCase())}</div>`;
    return `
      <div class="list-row ${rowToneClass(idx, true)}">
        <div class="list-thumb-wrap${cycleableClass}"${attrs}>${thumbHtml}${scroll ? "" : thumbBarHtml(imdbButtonHtml(row.imdbId, row.imdbRating, row.ratings), row)}${airCountHtml(row)}</div>
        ${rowDetailsHtml(rowInfoWrapHtml(row, idx, "airing", "row"), bannerSrc)}
        ${scroll ? `<span class="list-check">${BELL_ICON_SVG}</span>` : ""}
      </div>`;
  };
  const { pagerHtml, rowsWrapHtml } = scroll ? scrollPanelHtml(list, rowHtmlFn) : panelPosters() ? pairedPanelHtml(list, rowHtmlFn) : pagedColumnsHtml(list, rowHtmlFn);

  return `
    <div class="list-panel list-panel--airing">
      <div class="list-panel-header-row">
        <div class="list-panel-header">${titleIcons(CALENDAR_ICON_SVG, "airing")}<span>Airing Next</span></div>
        ${pagerHtml}
        ${listPanelCountHtml(list.length, "airing")}
      </div>
      ${rowsWrapHtml}
    </div>`;
}

function pagerArrowClick(btn, dir) {
  if (btn.classList.contains("off")) return;
  const track = btn.closest(".list-panel").querySelector(".list-rows-paged");
  if (track) scrollTrackByPage(track, dir);
}

// Where the arrows stop: [{ left, range }] - each page (a full page, one
// half-width column of Airing Next, or a pair of posters), or in a by-show
// track each show (a pair's first show at the pair, its second where its
// details box starts - or, if the panel is narrower than that show, where
// its poster ends at the panel's right edge). A stop past the end lands on the end; of stops that
// land together, the first one's range is kept.
function trackStops(track) {
  const base = track.getBoundingClientRect().left - track.scrollLeft;
  const leftOf = el => el.getBoundingClientRect().left - base;
  const stops = [];
  if (track.classList.contains("by-show")) {
    const rows = [...track.querySelectorAll(".list-row")];
    rows.forEach((row, i) => {
      const second = !!row.previousElementSibling;
      const anchor = second ? row.querySelector(".list-row-body") : row.parentElement;
      let left = leftOf(anchor);
      // A second show wider than the panel: its poster whole, at the right edge.
      const thumb = second && row.querySelector(".list-thumb-wrap");
      if (thumb) left = Math.max(left, leftOf(thumb) + thumb.getBoundingClientRect().width - track.clientWidth);
      stops.push({ left, range: pagedRangeLabel(i, i + 1, rows.length) });
    });
  } else {
    for (const page of track.children) stops.push({ left: leftOf(page), range: page.dataset.range });
  }
  const max = Math.max(0, track.scrollWidth - track.clientWidth);
  const out = [];
  for (const st of stops) {
    const left = Math.round(Math.min(Math.max(0, st.left), max));
    if (!out.length || Math.abs(out[out.length - 1].left - left) >= 2) out.push({ left, range: st.range });
  }
  return out;
}

// The stops, and the one nearest the track's current position.
function trackSnapMetrics(track) {
  const stops = trackStops(track);
  if (!stops.length) return null;
  let idx = 0;
  stops.forEach((st, i) => { if (Math.abs(st.left - track.scrollLeft) < Math.abs(stops[idx].left - track.scrollLeft)) idx = i; });
  return { stops, idx, maxIdx: stops.length - 1 };
}

function scrollTrackByPage(track, dir) {
  const m = trackSnapMetrics(track);
  if (!m || !m.maxIdx) return;
  const next = Math.max(0, Math.min(m.maxIdx, m.idx + dir));
  track.scrollTo({ left: m.stops[next].left, behavior: "smooth" });
}

// Keeps a panel's header range text ("3-4 of 20") and arrow disabled-states
// in sync with wherever the track actually is - needed because the track
// can move via a direct drag or a trackpad/touch swipe, not just the arrow
// buttons' own scrollTrackByPage calls.
function updatePagerUiForTrack(track) {
  const panel = track.closest(".list-panel");
  const m = trackSnapMetrics(track);
  if (!panel || !m) return;
  const stop = m.stops[m.idx];
  const rangeEl = panel.querySelector(".list-pager-range");
  const prevBtn = panel.querySelector(".list-pager-arrow.prev");
  const nextBtn = panel.querySelector(".list-pager-arrow.next");
  if (rangeEl && stop && stop.range) rangeEl.textContent = stop.range;
  if (prevBtn) prevBtn.classList.toggle("off", m.idx === 0);
  if (nextBtn) nextBtn.classList.toggle("off", m.idx === m.maxIdx);
}

// Every bottom-panel row gets up to 6 lines: each other line takes 1, and
// the show name and episode name split the rest by how many lines each
// actually needs (ties go to the show name). The text also never grows
// taller than the row's thumbnail, so every framed row is exactly the same
// height: a row that doesn't fit first gets a smaller show-name font (two
// steps, ROW_TITLE_SIZES), and only at the smallest size are lines cut.
// Each size step is batched as clamp-1 reads, unclamped reads, then writes.
// With body.equal-panels the banner fills the row and the text sits on it
// in the row's left third: up to 8 lines, the show name up to 3 of them,
// as high as the row.
const ROW_LINE_BUDGET = 6;
const ROW_LINE_BUDGET_TALL = 8;
const ROW_TITLE_LINES_TALL = 3;
const ROW_TITLE_SIZES = ["", "title-fs-1", "title-fs-2"];
function fitPanelRowLines() {
  // (Rows in poster pairs are fitted whole instead - fitPairText.)
  const items = [...document.querySelectorAll(".list-rows-paged .list-row-title-wrap")].filter(wrap => !wrap.closest(".panel-pair")).map(wrap => ({
    wrap,
    title: wrap.querySelector(":scope > .list-row-title"),
    ep: wrap.querySelector(":scope > .episode-title"),
  })).filter(it => it.title);
  const flexOf = list => list.flatMap(it => it.ep ? [it.title, it.ep] : [it.title]);
  const sizeClasses = ROW_TITLE_SIZES.filter(Boolean);
  if (window.matchMedia("(max-width: 720px)").matches) {
    flexOf(items).forEach(el => el.style.removeProperty("-webkit-line-clamp"));
    items.forEach(it => it.title.classList.remove(...sizeClasses));
    return;
  }
  const tall = document.body.classList.contains("equal-panels");
  const budget = tall ? ROW_LINE_BUDGET_TALL : ROW_LINE_BUDGET;
  let pending = items;
  ROW_TITLE_SIZES.forEach((cls, level) => {
    if (!pending.length) return;
    const smallest = level === ROW_TITLE_SIZES.length - 1;
    pending.forEach(it => {
      it.title.classList.remove(...sizeClasses);
      if (cls) it.title.classList.add(cls);
    });
    const flex = flexOf(pending);
    flex.forEach(el => el.style.setProperty("-webkit-line-clamp", "1"));
    const lineH = new Map(flex.map(el => [el, el.getBoundingClientRect().height]));
    pending.forEach(it => {
      it.fixedH = it.wrap.getBoundingClientRect().height - lineH.get(it.title) - (it.ep ? lineH.get(it.ep) : 0);
      it.fixedLines = [...it.wrap.children].filter(c => c !== it.title && c !== it.ep && c.offsetHeight > 0).length;
      // The text never grows taller than the thumbnail - or, in a pair,
      // than the half-height box it sits in.
      const box = it.wrap.closest(".list-row-body");
      if (box) {
        const cs = getComputedStyle(box);
        it.maxH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + 0.5;
      } else if (tall) {
        // The text over the banner, padding included (fixedH has it).
        it.maxH = it.wrap.parentElement.clientHeight + 0.5;
      } else {
        const thumb = it.wrap.parentElement.querySelector(".list-thumb-wrap");
        it.maxH = (thumb ? thumb.getBoundingClientRect().height : 0) + 0.5;
      }
    });
    flex.forEach(el => el.style.setProperty("-webkit-line-clamp", "none"));
    const need = new Map(flex.map(el => [el, Math.max(1, Math.round(el.getBoundingClientRect().height / (lineH.get(el) || 1)))]));
    const textH = (it, t, e) => it.fixedH + t * lineH.get(it.title) + (it.ep ? e * lineH.get(it.ep) : 0);
    const shrink = (t, e) => (e >= t && e > 1) ? [t, e - 1] : [t - 1, e];

    const next = [];
    pending.forEach(it => {
      // A name longer than its lines tries the smaller fonts before it's cut.
      if (tall && need.get(it.title) > ROW_TITLE_LINES_TALL && !smallest) { next.push(it); return; }
      let t = tall ? Math.min(ROW_TITLE_LINES_TALL, need.get(it.title)) : need.get(it.title);
      let e = it.ep ? need.get(it.ep) : 0;
      while (t + e + it.fixedLines > budget && (t > 1 || e > 1)) [t, e] = shrink(t, e);
      if (textH(it, t, e) > it.maxH) {
        let [ct, ce] = [t, e];
        while (textH(it, ct, ce) > it.maxH && (ct > 1 || ce > 1)) [ct, ce] = shrink(ct, ce);
        // Something has to be cut at every size: cut at the normal size.
        if (level === 0) it.fallback = [ct, ce];
        if (!smallest) { next.push(it); return; }
        it.title.classList.remove(...sizeClasses);
        [t, e] = it.fallback || [ct, ce];
      }
      it.title.style.setProperty("-webkit-line-clamp", String(t));
      if (it.ep) it.ep.style.setProperty("-webkit-line-clamp", String(e));
    });
    pending = next;
  });
}
// The text boxes of the L-shaped pairs (top panel, and the bottom panels
// with Panels to Posters) never cut a show's name, and give the episode's
// name every line the box has room for: it starts unclamped and gives back
// lines (down to one) while the box overflows; then the show name's type
// steps down a pixel at a time; if it still doesn't fit, the network line,
// then the air date, then the episode's name give way.
const PAIR_TITLE_MIN_PX = 13;
function fitPairText() {
  const boxes = [...document.querySelectorAll(".poster-pair .card-body, .panel-pair .list-row-body")];
  for (const box of boxes) {
    const title = box.querySelector("h3, .list-row-title");
    if (title) title.style.removeProperty("font-size");
    box.querySelectorAll("[data-fit-dropped]").forEach(el => { el.style.removeProperty("display"); delete el.dataset.fitDropped; });
    box.querySelectorAll(".watch-ring.compact").forEach(el => el.classList.remove("compact"));
    const ep = box.querySelector(".episode-title");
    if (ep) {
      Object.assign(ep.style, { whiteSpace: "normal", maxHeight: "none", display: "-webkit-box", webkitBoxOrient: "vertical" });
      ep.style.setProperty("-webkit-line-clamp", "none");
    }
  }
  for (const box of boxes) {
    const title = box.querySelector("h3, .list-row-title");
    if (!title || !box.clientHeight) continue;
    // The bottom boxes' text sits in one wrap: measure that against the
    // box's inner height. The top boxes' text fills the box itself (its
    // last line pinned to the bottom): it fits while that line ends inside.
    // (Not scrollHeight: the rounded inside corner hangs just outside.)
    const wrap = box.querySelector(".list-row-title-wrap");
    const cs = getComputedStyle(box);
    const room = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const last = box.lastElementChild;
    const fits = wrap
      ? () => wrap.scrollHeight <= room + 1
      : () => last.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom) + 1;
    const ep = box.querySelector(".episode-title");
    if (ep && !fits()) {
      const lineH = parseFloat(getComputedStyle(ep).lineHeight) || 16;
      let lines = Math.max(1, Math.round(ep.getBoundingClientRect().height / lineH));
      while (!fits() && lines > 1) { lines -= 1; ep.style.setProperty("-webkit-line-clamp", String(lines)); }
    }
    // Then the season ring goes small, its count beside it on one line -
    // about the old bar's height - before the name gets any smaller.
    const ring = box.querySelector(".watch-ring");
    if (ring && !fits()) ring.classList.add("compact");
    let size = parseFloat(getComputedStyle(title).fontSize);
    while (!fits() && size > PAIR_TITLE_MIN_PX) { size -= 1; title.style.fontSize = `${size}px`; }
    for (const sel of [".network-sub, .network-imdb-row", ".list-row-airdate", ".episode-title"]) {
      if (fits()) break;
      box.querySelectorAll(sel).forEach(el => { el.style.display = "none"; el.dataset.fitDropped = "1"; });
    }
  }
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitPairText());

// A dialog opens just under the top bar - or, with the bar as a box beside
// the top panel (body.equal-panels), near the top of the screen.
function modalTopGap() {
  const headerEl = document.querySelector("header");
  const barH = headerEl && !document.body.classList.contains("equal-panels") ? headerEl.offsetHeight : 0;
  return barH + 24;
}

// One-page layout on desktop: sizes the top panel's posters / banners
// (--top-img-h) and the bottom panels' rows (--bot-h, body.equal-panels)
// so the top box and the bottom boxes are equally tall and the page fills
// the window exactly - no scrolling, whatever the screen height. A few
// passes, since a banner's width follows its height and can rewrap the
// card text under it.
const TOP_IMG_MIN = { banner: 120, poster: 300 };
// With equal panels a short screen lets the posters go lower - the boxes
// stay equal and the page doesn't scroll.
const EQUAL_TOP_IMG_MIN = { banner: 120, poster: 180 };
const BOTTOM_ROWS_MIN = 200;
function clearEqualPanels() {
  document.body.classList.remove("equal-panels");
  document.documentElement.style.removeProperty("--bot-h");
  document.documentElement.style.removeProperty("--top-box-h");
  document.documentElement.style.removeProperty("--bot-text");
  document.documentElement.style.removeProperty("--airing-w");
}
// Panels to Posters with equal panels: Airing Next as wide as one pair
// (two posters + the details column between them + the pair's gap), each
// other panel as wide as one show (a poster + its details box) - the
// details box the same width everywhere, exactly filling the room (at
// least 120px), so the next show's box, half hidden at a panel's right
// edge, ends level with the shown one's.
const BOTTOM_TEXT_MIN = 120, PAIR_GAP = 12;
function fitBottomPairWidths() {
  const root = document.documentElement;
  const row = document.querySelector(".bottom-panels-row");
  const airing = row && row.querySelector(".list-panel--airing");
  const track = airing && airing.querySelector(".list-rows-paged");
  if (!track || !row.querySelector(".panel-pair")) {
    root.style.removeProperty("--bot-text");
    root.style.removeProperty("--airing-w");
    return;
  }
  const panels = [...row.children].filter(el => el.classList.contains("list-panel"));
  const others = panels.length - 1;
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  // The panel's own padding + border around its track.
  const chrome = airing.getBoundingClientRect().width - track.clientWidth;
  const posterW = (parseFloat(root.style.getPropertyValue("--bot-h")) || 280) * 2 / 3;
  const room = row.clientWidth - gap * others - chrome * panels.length;
  // room = (2 posters + text + gap) + others x (poster + text)
  const text = Math.floor((room - (2 + others) * posterW - PAIR_GAP) / (1 + others));
  const t = Math.max(BOTTOM_TEXT_MIN, text);
  root.style.setProperty("--bot-text", t + "px");
  root.style.setProperty("--airing-w", Math.ceil(2 * posterW + t + PAIR_GAP + chrome) + "px");
}
function fitTopPanelToWindow() {
  const root = document.documentElement;
  // A phone on its side shows one panel (a tab) at a time: its pairs take
  // the whole screen below the header - the top panel's and the others'.
  if (phoneLayout() === "landscape") {
    clearEqualPanels();
    const header = document.querySelector(".topbar");
    const h = Math.max(200, Math.floor(window.innerHeight - (header ? header.getBoundingClientRect().height : 0) - 24));
    root.style.setProperty("--top-img-h", h + "px");
    root.style.setProperty("--phone-pair-h", h + "px");
    return;
  }
  root.style.removeProperty("--phone-pair-h");
  const track = document.getElementById("myListCarouselTrack");
  const main = document.querySelector(".main-content");
  const img = track && track.querySelector(".poster-wrap");
  if (!img || !main || currentView !== "list" || isScrollLayout() || window.matchMedia("(max-width: 720px)").matches) {
    root.style.removeProperty("--top-img-h");
    clearEqualPanels();
    return;
  }
  const min = TOP_IMG_MIN[getImageMode() === "banner" ? "banner" : "poster"];
  const topBox = document.querySelector(".series-panel");
  const bottomBoxes = [...document.querySelectorAll(".bottom-panels-row .list-panel")];
  if (topBox && bottomBoxes.length) {
    document.body.classList.add("equal-panels");
    const eqMin = EQUAL_TOP_IMG_MIN[getImageMode() === "banner" ? "banner" : "poster"];
    for (let pass = 0; pass < 4; pass++) {
      const slack = window.innerHeight - (main.getBoundingClientRect().bottom + window.scrollY) - 1;
      const topH = topBox.getBoundingClientRect().height;
      const botH = Math.max(...bottomBoxes.map(b => b.getBoundingClientRect().height));
      if (Math.abs(slack) < 1 && Math.abs(topH - botH) < 1) break;
      // Half of everything below the header each: the top box and the
      // bottom ones grow or shrink by what they're off that height.
      const target = (topH + botH + slack) / 2;
      const rowsH = parseFloat(root.style.getPropertyValue("--bot-h")) || 280;
      root.style.setProperty("--top-img-h", Math.max(eqMin, Math.floor(img.getBoundingClientRect().height + target - topH)) + "px");
      root.style.setProperty("--bot-h", Math.max(BOTTOM_ROWS_MIN, Math.floor(rowsH + target - botH)) + "px");
    }
    // The top bar sits as a box beside the top panel, exactly as tall.
    root.style.setProperty("--top-box-h", topBox.getBoundingClientRect().height + "px");
    fitBottomPairWidths();
    // The rows' text was fitted to the thumbnails' height before it changed.
    fitPanelRowLines();
    return;
  }
  clearEqualPanels();
  for (let pass = 0; pass < 3; pass++) {
    const slack = window.innerHeight - (main.getBoundingClientRect().bottom + window.scrollY) - 1;
    if (Math.abs(slack) < 1) break;
    root.style.setProperty("--top-img-h", Math.max(min, Math.floor(img.getBoundingClientRect().height + slack)) + "px");
  }
}
if (document.fonts) document.fonts.ready.then(() => fitTopPanelToWindow());

let fitRowLinesRaf = null;
window.addEventListener("resize", () => {
  if (fitRowLinesRaf) return;
  fitRowLinesRaf = requestAnimationFrame(() => { fitRowLinesRaf = null; fitPanelRowLines(); fitTopPanelToWindow(); fitPairText(); });
});

// Re-wired after every renderRows() - the bottom panels' HTML (and so every
// .list-rows-paged element) gets fully replaced each time, and the native
// `scroll` event doesn't bubble, so a listener bound once up front wouldn't
// survive the next render.
function wirePanelPagerTracks() {
  document.querySelectorAll(".list-rows-paged").forEach(track => {
    let raf = null;
    track.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; updatePagerUiForTrack(track); });
    });
    updatePagerUiForTrack(track);
  });
}

// Every panel whose scroll position needs to survive a full re-render -
// the three bottom panels' row tracks: paged (scrollLeft doubles as "which
// page") or, in the older layout, scrolling (vertical on desktop,
// horizontal on mobile - both axes are saved).
const SCROLLABLE_PANEL_SELECTORS = {
  watched: ".list-panel--watched .list-rows-paged, .list-panel--watched .list-rows-scroll",
  plan: ".list-panel--plan .list-rows-paged, .list-panel--plan .list-rows-scroll",
  airing: ".list-panel--airing .list-rows-paged, .list-panel--airing .list-rows-scroll",
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

// Poster mode: every two cards share one details column between their
// posters - its top half belongs to the left poster, its bottom half to the
// right one (see .poster-pair). An odd last card gets a pair of its own.
function posterPairsHtml(cardHtmls) {
  const pairs = [];
  for (let i = 0; i < cardHtmls.length; i += 2) {
    const single = i + 1 >= cardHtmls.length;
    pairs.push(`<div class="poster-pair${single ? " single" : ""}">${cardHtmls[i]}${single ? "" : cardHtmls[i + 1]}</div>`);
  }
  return pairs.join("\n");
}

function renderRows(rows, totalRemainingEps, totalRemainingMinutes, recentlyWatched, planToWatch, airingPreview) {
  const prevTrack = document.getElementById("myListCarouselTrack");
  const prevCarouselScrollLeft = prevTrack ? prevTrack.scrollLeft : 0;
  const prevPanelScrollPositions = capturePanelScrollPositions();
  // A re-render of the same rows keeps their own order underneath.
  if (!(rows === lastRows && lastBaseRows)) lastBaseRows = rows;
  rows = watchingFirst(lastBaseRows);
  lastRows = rows;
  panelsRenderedAt = Date.now();
  lastTotalEps = totalRemainingEps;
  lastTotalMinutes = totalRemainingMinutes;
  if (recentlyWatched !== undefined) lastRecentlyWatched = recentlyWatched;
  if (planToWatch !== undefined) lastPlanToWatch = planToWatch;
  if (airingPreview !== undefined) {
    lastAiringPreview = airingPreview;
    syncEpisodeAlerts(airingPreview);
  }
  updateGreetingStatus();
  rememberLoaderPosters();
  if (!panelsFromSnapshot) savePanelsSnapshotSoon();
  currentView = "list";
  safeSetItem(LS_VIEW_MODE, "list");
  updateViewModeButton();

  const bottomPanelsHtml = [
    // Airing Next first (the wide one), then Just Watched, Plan to Watch.
    renderAiringNextPreviewHtml(lastAiringPreview),
    renderRecentlyWatchedHtml(lastRecentlyWatched),
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
    restorePanelScrollPositions(prevPanelScrollPositions);
    wirePanelPagerTracks();
    fitPanelRowLines();
    fitTopPanelToWindow();
    fitPairText();
    updatePhoneTabCounts();
    tickAirCountdowns();
    scheduleAirRefresh();
    return;
  }

  const mode = getImageMode();
  const isWide = mode === "banner";
  const [totalHours, totalMins] = formatTime(totalRemainingMinutes);
  // Carousel arrows sit centered on the poster/banner image itself, not the
  // whole card (which also has the info panel below it) - compute that
  // image's height from the known card width + aspect ratio for the
  // current mode, matching .card.carousel-card / .poster-pair's CSS exactly.
  // The one-page layout pairs posters up (posterPairsHtml) and frames
  // banners in the two pair colors; the older scrolling layout keeps plain cards.
  const onePage = !isScrollLayout();
  const pairPosters = !isWide && onePage;
  const carouselCardWidth = isWide ? 368 : pairPosters ? 232 : 259;
  const carouselImageHeight = isWide ? (carouselCardWidth * 9 / 16) : (carouselCardWidth * 3 / 2);
  const carouselArrowTop = onePage
    ? `calc(var(--top-img-h, ${carouselImageHeight}px) / 2)`
    : `${Math.round(carouselImageHeight / 2)}px`;

  const cardHtmls = rows.map((row, arrIdx) => {
    const timeText = row.remaining > 1
      ? `${row.nextHours}h ${row.nextMins}m / ${row.hours}h ${row.mins}m left`
      : `${row.hours}h ${row.mins}m left`;
    // Always reserved as its own line (blank when there's no title), so a
    // card without one doesn't collapse and throw off the progress bar's
    // position relative to sibling cards in the same row - see .card-fill-spacer.
    const episodeTitle = `<div class="episode-title">${row.episodeTitle ? esc(row.episodeTitle) : "&nbsp;"}</div>`;
    const progressPct = row.available > 0 ? Math.min(100, Math.round((row.watched / row.available) * 100)) : 0;
    // A ring for the season you're in (a bar for the whole show barely
    // moves on a long one), the season and the show's share beside it -
    // on a banner, one segment per season instead, the current one filling.
    // The old bar when the season's length isn't known.
    const ringC = 2 * Math.PI * 15;
    const seasonPct = row.seasonEps ? Math.round((row.nextEpisode - 1) / row.seasonEps * 100) : 0;
    const progressHtml = isWide && row.available > 0 && row.seasonEps && row.seasons && row.seasons.includes(row.nextSeason)
      ? `<div class="watch-segs">${row.seasons.map(s =>
            s < row.nextSeason ? `<i class="on"></i>`
            : s === row.nextSeason ? `<i class="now"><b style="width:${seasonPct}%"></b></i>` : `<i></i>`).join("")}</div>
        <div class="watch-segs-label"><span>Season ${row.nextSeason} · <b>${row.nextEpisode - 1}/${row.seasonEps}</b></span><span>${row.watched}/${row.available} · ${progressPct}% of show</span></div>`
      : row.available > 0 && row.seasonEps
      ? `<div class="watch-ring">
          <svg viewBox="0 0 38 38" aria-hidden="true">
            <circle class="watch-ring-track" cx="19" cy="19" r="15"/>
            <circle class="watch-ring-fill" cx="19" cy="19" r="15" stroke-dasharray="${(ringC * (row.nextEpisode - 1) / row.seasonEps).toFixed(1)} ${ringC.toFixed(1)}"/>
            <text x="19" y="22">${row.nextEpisode - 1}/${row.seasonEps}</text>
          </svg>
          <div class="watch-ring-side"><b>Season ${row.nextSeason}<em class="watch-ring-count"> · ${row.nextEpisode - 1}/${row.seasonEps}</em></b><span>${row.watched}/${row.available} · ${progressPct}% of show</span></div>
        </div>`
      : row.available > 0
      ? `<div class="watch-progress">
          <div class="watch-progress-track">
            <div class="watch-progress-fill" style="width:${progressPct}%"></div>
            <div class="watch-progress-text">${row.watched}/${row.available}</div>
          </div>
        </div>`
      : "";
    const remainingText = row.remaining === 1 ? "1 episode left" : `${row.remaining} episodes left`;
    const cardBadge = activeCardBadge(row);
    const cardBadgeHtml = cardBadge
      ? `<div class="card-ribbon tone-${cardBadge.tone}"><span>${cardBadge.text}</span></div>`
      : "";
    const overlayHtml = cardBadgeHtml + imdbButtonHtml(row.imdbId, row.imdbRating, row.ratings) + `<div class="remaining-badge" title="">${STAT_STACK_ICON_BLACK_SVG}${remainingText}</div>`;
    const { wrapHtml } = cardImageBits(row, mode, arrIdx, overlayHtml);

    return `
      <div class="card carousel-card${isWide ? " banner-mode" : ""}${isWide && onePage ? " framed " + rowToneClass(arrIdx) : ""}" data-row="${arrIdx}">
        ${wrapHtml}
        <div class="card-body"${pairPosters ? posterGlowStyle(displaySrcFor("main", row)) : ""}>
          ${pairPosters ? posterGlowHtml(displaySrcFor("main", row)) : ""}
          <div class="card-title-row">
            <h3 title="View cast" onclick="event.stopPropagation(); openCastModal('main', ${arrIdx})">${esc(row.title)}</h3>
            <button class="card-menu-btn" title="Manage" onclick="event.stopPropagation(); openCardMenu(${arrIdx}, this)">&#8942;</button>
          </div>
          <div class="next-up-row">
            <span class="next-up">Next: ${row.nextLabel}</span>
            ${row.badge && !cardBadge ? `<div class="premiere-badge${row.badge === "SEASON FINALE" ? " finale" : ""}">${row.badge}</div>` : ""}
          </div>
          ${episodeTitle}
          <div class="card-fill-spacer">
            ${progressHtml}
          </div>
          <div class="time-left" title="See every episode" onclick="event.stopPropagation(); openEpisodesModal(${arrIdx})"><span class="time-icon">${CLOCK_ICON_SVG}</span>${timeText}</div>
        </div>
      </div>`;
  });
  const cards = pairPosters ? posterPairsHtml(cardHtmls) : cardHtmls.join("\n");

  app.innerHTML = `
    <div class="series-panel">
      <div class="series-panel-header">
        <div class="list-panel-header series-panel-title">${titleIcons(READY_ICON_SVG, "ready")}<span>Ready to Watch</span></div>
        <div class="series-panel-header-left">
          <button type="button" class="series-panel-stat-group series-panel-stat-clickable" onclick="openPanelShowsModal('main')">
            ${withCineIcon(STAT_TV_ICON_SVG, CINE_STAT_ICONS.tv)}
            <div class="series-panel-stat"><span class="num">${rows.length}</span><span class="label">Shows</span></div>
          </button>
          <div class="stats-divider"></div>
          <div class="series-panel-stat-group">
            ${withCineIcon(STAT_STACK_ICON_SVG, CINE_STAT_ICONS.stack)}
            <div class="series-panel-stat"><span class="num">${totalRemainingEps}</span><span class="label">Episodes Left</span></div>
          </div>
          <div class="stats-divider"></div>
          <div class="series-panel-stat-group">
            ${withCineIcon(STAT_CLOCK_ICON_SVG, CINE_STAT_ICONS.clock)}
            <div class="series-panel-stat"><span class="num">${totalHours}h ${totalMins}m</span><span class="label">Watch Time Left</span></div>
          </div>
        </div>
        <span class="series-panel-updated" hidden></span>
      </div>
      <div class="carousel-wrap">
        <button class="carousel-arrow left" title="Scroll left" style="top:${carouselArrowTop}"
          onclick="document.getElementById('myListCarouselTrack').scrollBy({left:-420,behavior:'smooth'})">${CAROUSEL_ARROW_LEFT_ICON_SVG}</button>
        <div class="carousel-track" id="myListCarouselTrack">${cards}<div class="carousel-watermark"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="15" rx="3.5" fill="none" stroke="var(--accent)" stroke-width="1.8"/><polygon points="10,7.8 10,13.2 14.6,10.5" fill="var(--accent)"/><line x1="9" y1="21" x2="15" y2="21" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/></svg></div></div>
        <button class="carousel-arrow" title="Scroll right" style="top:${carouselArrowTop}"
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
  wirePanelPagerTracks();
  fitPanelRowLines();
  fitTopPanelToWindow();
  fitPairText();
  updatePhoneTabCounts();
  updateCarouselArrows();
  wireHoverStabilization();
  tickAirCountdowns();
  scheduleAirRefresh();
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
  fitTopPanelToWindow(); // clears the list view's top-panel size

  if (!rows.length) {
    app.innerHTML = `<div class="center-box"><h2>Nothing airing soon</h2>
      <p style="color:var(--muted)">No upcoming episodes found across your lists.</p></div>`;
    subtitle.textContent = "Nothing airing soon";
    return;
  }

  const mode = getImageMode();
  const isWide = mode === "banner";

  const cards = rows.map((row, arrIdx) => {
    const { wrapHtml } = cardImageBits(row, mode, arrIdx, imdbButtonHtml(row.imdbId, row.imdbRating, row.ratings) + airCountHtml(row));
    return `
      <div class="card">
        ${wrapHtml}
        <div class="card-body">
          <h3 title="View cast" onclick="event.stopPropagation(); openCastModal('main', ${arrIdx})">${esc(row.title)}</h3>
          <div class="next-up">Next: ${row.nextLabel}</div>
          ${row.nextEpisodeTitle ? `<div class="episode-title">${esc(row.nextEpisodeTitle)}</div>` : ""}
          <div class="air-date">&#128197; ${airDateText(row)}</div>
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
  tickAirCountdowns();
}

function showError(err) {
  app.innerHTML = `
    <div class="center-box">
      <h2>Something went wrong</h2>
      <div class="error-box">${esc((err && err.message) || err)}</div>
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
