// The order an episode gets its air time in, kept in one place: the site
// (app/library.js) and the computer's bridge (tools/emby-bridge/run.js, which
// fills the phone widget's Airing Next) both build their chain here, so the
// two can't drift apart again (the bridge's had no yes step, and the widget
// showed Israeli shows at TVMaze's hour while the site showed yes's).
//   1. yes's TV guide, for Israeli shows (yes-times.js) - its hour wins;
//   2. SIMKL's times, only for episodes still date-only (air-times.js);
//   3. TheTVDB as a second opinion on the dates (createTvdbCheck below).
// Each step is optional and gets what the step before it returned; a step
// that fails leaves the episodes as they were. Runs in the browser
// (window.AirTimeChain) and in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AirTimeChain = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // createAirTimeChain({ yes, simkl, tvdb }) -> airTimes(ids, episodes),
  // each step an airTimes(ids, episodes) of its own, or null to skip it.
  function createAirTimeChain({ yes = null, simkl = null, tvdb = null } = {}) {
    const steps = [yes, simkl, tvdb].filter(Boolean);
    return async (ids, episodes) => {
      let out = episodes;
      for (const step of steps) {
        const before = out;
        out = await Promise.resolve().then(() => step(ids, before)).catch(() => before);
        if (!Array.isArray(out)) out = before;
      }
      return out;
    };
  }

  // What yes's step needs to know about a show, from TMDB's details: Israeli
  // by origin country or original language; its English and original
  // (Hebrew) names are what the guide's titles are matched against.
  function israeliShowInfo(details) {
    if (!details) return null;
    return {
      israeli: (details.origin_country || []).includes("IL") || details.original_language === "he",
      names: [details.name, details.original_name],
    };
  }

  // TheTVDB as a second opinion on air dates: a show with an episode out in
  // the past two weeks or due in the next two has TheTVDB's dates looked up.
  // An episode they put days later waits for that day (holdForLaterDates), so
  // a wrong early date on TVMaze doesn't put it on Ready to Watch too soon;
  // one they put days earlier - with TMDB agreeing - comes forward to that day
  // (advanceToEarlierDates), so a wrong late date doesn't hold it back. TMDB
  // settles it both ways: later only when it doesn't side with the main
  // source, earlier only when it sides with TheTVDB. A streaming show is never
  // held back: TVMaze's day is the day it comes out (EpisodeSource
  // streamingHome). Without the show's TheTVDB id, or while `enabled()` says
  // no (no key, or the key was refused), nothing changes.
  // - recentEpisodes(tvdbId): TheTVDB's episodes from a month back on, as
  //   [{ season, episode, date }], or null if TheTVDB couldn't answer
  // - source: the EpisodeSource (getSourceLists, streamingHome)
  const NEAR_MS = 14 * 24 * 60 * 60 * 1000;
  function createTvdbCheck({ EpisodeSource, source, recentEpisodes, enabled = () => true, now = () => Date.now() }) {
    return async (ids, episodes) => {
      if (!ids || !ids.tvdb || !enabled()) return episodes;
      const at = now();
      const near = episodes.some(ep => ep.date && ep.season &&
        Math.abs(Date.parse(ep.date.length > 10 ? ep.date : ep.date + "T00:00:00") - at) < NEAR_MS);
      if (!near) return episodes;
      const check = await Promise.resolve().then(() => recentEpisodes(ids.tvdb)).catch(() => null);
      if (!check) return episodes;
      const tmdb = ids.tmdb != null ? ((await source.getSourceLists(ids).catch(() => null)) || {}).tmdb : null;
      const streaming = await source.streamingHome(ids).catch(() => null);
      const held = streaming ? episodes : EpisodeSource.holdForLaterDates(episodes, check, at, { confirm: tmdb }).episodes;
      return tmdb ? EpisodeSource.advanceToEarlierDates(held, check, tmdb, at).episodes : held;
    };
  }

  return { createAirTimeChain, createTvdbCheck, israeliShowInfo, NEAR_MS };
});
