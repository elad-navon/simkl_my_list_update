"use strict";

// Start-up: main(), the clock, the top buttons, the phone layout,
// drag-scrolling, and the service worker.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  if (!getConfig().tmdbKey) {
    // A new device: the keys may already be saved with the account.
    const restored = await restoreKeysFromAccount().catch(() => "none");
    if (restored === "signin") return;
    if (restored !== "restored") {
      showSettings(main);
      return;
    }
  }

  if (!(await showPanelsSnapshot())) showLoaderSoon();
  subtitle.textContent = "Fetching your My List\u2026";

  watchingListLoad = null;
  try {
    sharedCache = new TmdbCache();
    if (!(await openLibrary())) { endPanelsSnapshot(); return; } // the sign-in screen is showing
    saveKeysToAccount(); // in the background; this device's keys for the next one
    sharedEpisodeCache = newEpisodeCache();
    if (!panelsFromSnapshot) showLoaderSoon();
    subtitle.textContent = "Fetching your My List\u2026";
    const [[rows, totalEps, totalMinutes, recentlyWatched], planToWatchRows, airingNextRows] = await Promise.all([
      getMyListRows(sharedCache, sharedEpisodeCache),
      getPlanToWatchRows(sharedCache),
      getAiringNextRows(sharedCache, sharedEpisodeCache),
    ]);
    airingRows = airingNextRows; // also primes the separate Airing Next tab's cache, so opening it doesn't re-fetch
    if (panelsFromSnapshot) {
      endPanelsSnapshot();
      renderRows(rows, totalEps, totalMinutes, recentlyWatched, planToWatchRows, airingNextRows);
    } else {
      await finishLoader();
      renderRows(rows, totalEps, totalMinutes, recentlyWatched, planToWatchRows, airingNextRows);
      fadeInPage();
    }
    const missing = library.adapter.failures();
    if (missing.length) showToast(`Couldn't load the episode list of ${missing.length} show${missing.length === 1 ? "" : "s"} (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}) - try Refresh later.`, true);
    autoStartAiredPremieres(planToWatchRows);
  } catch (err) {
    endPanelsSnapshot();
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

// A poster/thumbnail's loading pulse stops once its image is in (or has
// failed) - see .loaded in style.css. load/error don't bubble, so caught
// on the way down.
const markThumbLoaded = e => {
  const t = e.target;
  if (t.tagName === "IMG" && (t.classList.contains("poster") || t.classList.contains("list-thumb"))) t.classList.add("loaded");
};
document.addEventListener("load", markThumbLoaded, true);
document.addEventListener("error", markThumbLoaded, true);
setInterval(tickAirCountdowns, 30000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  tickAirCountdowns();
  scheduleAirRefresh(); // a background tab's timer may have been held back
});

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
// Panels to Posters / Banners: redrawn at once from what's loaded, each
// panel back at its first page (a page holds a different number of shows).
document.getElementById("panelImagesBtn").onclick = () => {
  safeSetItem(LS_PANEL_IMAGES, panelPosters() ? "banner" : "poster");
  applyPanelImages();
  if (currentView !== "list" || !lastRows) return;
  document.querySelectorAll(".list-rows-paged").forEach(track => { track.scrollLeft = 0; });
  renderRows(lastRows, lastTotalEps, lastTotalMinutes);
};
updateImageModeButton();
updateViewModeButton();
updatePageTitle();
applyStoredTheme();
applyPanelLayout();

// A phone turned the other way gets the other phone layout (phoneLayout):
// redrawn at once from what's loaded. body.phone-portrait / .phone-landscape
// let the stylesheet follow the same decision.
function applyPhoneLayout() {
  const phone = phoneLayout();
  document.body.classList.toggle("phone-portrait", phone === "portrait");
  document.body.classList.toggle("phone-landscape", phone === "landscape");
  if (phone === "landscape") {
    ensurePhoneTabs();
    showPhoneTab();
  }
}

// Sideways, the panels are tabs in the header: one panel at a time, across
// the whole screen. The last one picked is remembered on this device. The
// full names, in the titles' condensed face; where the four still don't fit
// across, each name goes on two lines (the <br>, shown only then - fitPhoneTabs).
const PHONE_TABS = [["ready", "Ready to <br>Watch"], ["airing", "Airing <br>Next"], ["watched", "Recently <br>Watched"], ["plan", "Plan to <br>Watch"]];
const LS_PHONE_TAB = "phone_tab";
function phoneTab() {
  const tab = localStorage.getItem(LS_PHONE_TAB);
  return PHONE_TABS.some(([key]) => key === tab) ? tab : "ready";
}
function ensurePhoneTabs() {
  if (document.getElementById("phoneTabs")) return;
  const nav = document.createElement("nav");
  nav.id = "phoneTabs";
  nav.className = "phone-tabs";
  nav.setAttribute("aria-label", "Panels");
  nav.innerHTML = PHONE_TABS.map(([key, label]) => `<button type="button" data-tab="${key}"><span class="phone-tab-label">${label}</span></button>`).join("");
  nav.onclick = e => {
    const btn = e.target.closest("button[data-tab]");
    if (!btn) return;
    safeSetItem(LS_PHONE_TAB, btn.dataset.tab);
    showPhoneTab();
    window.scrollTo(0, 0);
  };
  document.querySelector(".topbar-left").after(nav);
}
// Each tab carries its panel's count (what the panel's own header shows on a
// larger screen), as a small tag inside the button.
function updatePhoneTabCounts() {
  const nav = document.getElementById("phoneTabs");
  if (!nav) return;
  const counts = {
    ready: (lastRows || []).length, airing: (lastAiringPreview || []).length,
    watched: (lastRecentlyWatched || []).length, plan: (lastPlanToWatch || []).length,
  };
  nav.querySelectorAll("button[data-tab]").forEach(btn => {
    let tag = btn.querySelector(".phone-tab-count");
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "phone-tab-count";
      btn.append(tag);
    }
    tag.textContent = String(counts[btn.dataset.tab]);
  });
  fitPhoneTabs();
}
// One line each if all four fit across, else two (measured again once the
// condensed face has loaded - a fallback face is wider).
function fitPhoneTabs() {
  const nav = document.getElementById("phoneTabs");
  if (!nav || !document.body.classList.contains("phone-landscape")) return;
  nav.classList.remove("two-line");
  nav.classList.toggle("two-line", nav.scrollWidth > nav.clientWidth + 1);
}
if (document.fonts) document.fonts.ready.then(fitPhoneTabs);
window.addEventListener("resize", fitPhoneTabs);
function showPhoneTab() {
  updatePhoneTabCounts();
  const tab = phoneTab();
  document.body.dataset.phoneTab = tab;
  document.querySelectorAll("#phoneTabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === tab ? "true" : "false"));
  // A panel that was hidden measured nothing: fit its pairs now it shows.
  requestAnimationFrame(() => { fitTopPanelToWindow(); fitPairText(); });
}
applyPhoneLayout();
if (window.matchMedia) {
  for (const query of [PHONE_PORTRAIT_QUERY, PHONE_LANDSCAPE_QUERY]) {
    window.matchMedia(query).addEventListener("change", () => {
      const before = document.body.classList.contains("phone-portrait") ? "portrait"
        : document.body.classList.contains("phone-landscape") ? "landscape" : null;
      applyPhoneLayout();
      if (phoneLayout() === before) return;
      applyPanelLayout();
      if (currentView === "airing" && airingRows) renderAiringRows(airingRows);
      else if (currentView === "list" && lastRows) renderRows(lastRows, lastTotalEps, lastTotalMinutes);
    });
  }
}

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
// vertical and targeting the older scrolling layout's row lists instead of
// the horizontal top carousel - .list-rows-scroll gets replaced wholesale on
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

// Mouse drag across a bottom panel's paged row track (touch/trackpad swipes
// already scroll it natively). Free scrolling, same as the top carousel:
// the track follows the pointer 1:1 and stays wherever the drag ends.
(function enablePanelPagerDragScroll() {
  let dragTrack = null;
  let startX = 0;
  let startScrollLeft = 0;
  let dragged = false;

  app.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const track = e.target.closest(".list-rows-paged");
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
    if (dragged && e.target.closest(".list-rows-paged")) {
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
