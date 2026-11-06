"use strict";

// Airing Next: the next episode of each show, air windows and countdowns.
//
// One of the page script's files (app/), loaded in order by index.html as
// plain scripts sharing one global scope - so code that runs while a file
// loads may use only what earlier files define.

// ---------------------------------------------------------------------
// Airing Next - next upcoming (not-yet-aired) episode for shows you're
// actively watching, sorted soonest-first.
// ---------------------------------------------------------------------
async function nextAiringEpisode(tmdbId, showDetail, cache) {
  // Fallback path only (used when the episode list has nothing upcoming).
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

async function nextAiringEpisodeFromList(showId, episodeCache, fallbackMinutes) {
  // Preferred path: the show's episode list, with an exact date+time per
  // episode where the source has one. Uses the same aired rule as My List's
  // remaining count (episodeHasAired: an exact time once its broadcast has
  // ended, a date-only episode from 10:00 that day), so an episode is never in
  // both places at once: while on the air it's here (marked onAir, shown
  // first), and moves to My List as it ends.
  // airEnd: when an exact-time episode ends (null for a date-only one).
  const episodes = await episodeCache.get(showId);
  if (!episodes) return null;

  const now = Date.now();

  let best = null;
  for (const ep of episodes) {
    if (ep.season == null || ep.season === 0) continue; // skip specials
    if (ep.episode == null || !ep.date) continue;
    const win = episodeAirWindow(ep, fallbackMinutes);
    if (win && win.start <= now && now < win.end) {
      if (!best || !best.onAir || win.start < best.ts) {
        best = { ts: win.start, airDate: ep.date, season: ep.season, episode: ep.episode, onAir: true, airEnd: win.end, from: ep.from || null };
      }
      continue;
    }
    if (best && best.onAir) continue;
    if (episodeHasAired(ep, now, fallbackMinutes)) continue; // strictly in the future
    const ts = episodeTimestamp(ep.date);
    if (isNaN(ts)) continue;
    if (!best || ts < best.ts) {
      best = { ts, airDate: ep.date, season: ep.season, episode: ep.episode, airEnd: win ? win.end : null, from: ep.from || null };
    }
  }
  return best;
}

// ---- On the air now / countdown -------------------------------------------
// When an episode with an exact air time is on the air: { start, end } in ms,
// or null for a date-only (or undated) one - its time isn't known. Its
// length: its own runtime, else the show's average (fallbackMinutes), else
// 30 minutes.
// When an episode became available to watch: the end of its broadcast for an
// exact air time (its runtime, else fallbackMinutes, else 30 minutes), the
// that day's 10:00 local time for a date-only one; null without a date.
// The same moments LibraryCore.isAired uses.
function episodeAvailableAt(ep, fallbackMinutes) {
  if (!ep || typeof ep.date !== "string" || !ep.date) return null;
  if (ep.date.length > 10) {
    const start = new Date(ep.date).getTime();
    if (isNaN(start)) return null;
    const minutes = ep.runtime > 0 ? ep.runtime : fallbackMinutes > 0 ? fallbackMinutes : 30;
    return start + minutes * 60000;
  }
  const at = new Date(ep.date + "T00:00:00");
  if (isNaN(at.getTime())) return null;
  at.setHours(LibraryCore.DATE_ONLY_HOUR, 0, 0, 0);
  return at.getTime();
}

function episodeAirWindow(ep, fallbackMinutes) {
  if (!ep || typeof ep.date !== "string" || ep.date.length <= 10) return null;
  const start = new Date(ep.date).getTime();
  if (isNaN(start)) return null;
  const minutes = ep.runtime > 0 ? ep.runtime : fallbackMinutes > 0 ? fallbackMinutes : 30;
  return { start, end: start + minutes * 60000 };
}

// What an Airing Next corner chip shows - for an episode with an exact air
// time (`start`, on the air until `end`), or one known only by its date
// (`day`, "YYYY-MM-DD"):
// - on the air: { live: true };
// - an exact time: minutes under an hour ("12 MIN"), hours up to 48 -
//   rounded up, so the number drops only as each whole hour is reached
//   (1h 14m left shows "2 HOURS", exactly 1 hour "1 HOUR") - then calendar
//   days ("5 DAYS");
// - a date only: calendar days alone ("TODAY", "2 DAYS", flagged dateOnly) -
//   hours or minutes would be a guess.
// null when there's nothing to show (over, or no date at all).
function airCountdown(start, end, now, day) {
  const startOfDay = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysUntil = ms => Math.round((startOfDay(ms) - startOfDay(now)) / 86400000);
  const plural = (n, one, many) => (n === 1 ? one : many);
  if (start == null || isNaN(start)) {
    if (!day) return null;
    const days = daysUntil(new Date(day + "T00:00:00").getTime());
    if (days < 0) return null;
    return days === 0 ? { n: "TODAY", unit: "", dateOnly: true } : { n: days, unit: plural(days, "DAY", "DAYS"), dateOnly: true };
  }
  if (now >= start) return end != null && now < end ? { live: true } : null;
  const minutes = Math.ceil((start - now) / 60000);
  if (minutes < 60) return { n: minutes, unit: "MIN" };
  if (minutes <= 48 * 60) {
    const hours = Math.ceil(minutes / 60);
    return { n: hours, unit: plural(hours, "HOUR", "HOURS") };
  }
  const days = daysUntil(start);
  return { n: days, unit: plural(days, "DAY", "DAYS") };
}

// Airing Next order: by (local) day; within a day, episodes with an exact air
// time first, by that time, then the date-only ones - their time isn't
// known. Exact times are compared as moments, not strings (they carry a
// timezone offset).
function compareAirDates(a, b) {
  const key = d => {
    if (typeof d === "string" && d.length > 10) {
      const t = new Date(d);
      const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      return { day, dateOnly: 0, ts: t.getTime() };
    }
    return { day: String(d || "9999-12-31").slice(0, 10), dateOnly: 1, ts: 0 };
  };
  const x = key(a), y = key(b);
  if (x.day !== y.day) return x.day < y.day ? -1 : 1;
  return (x.dateOnly - y.dateOnly) || (x.ts - y.ts);
}

function hasTimeComponent(dateStr) {
  // "YYYY-MM-DD" is exactly 10 chars (TMDB, date-only); a full ISO
  // datetime with time+offset (TVMaze) is longer.
  return typeof dateStr === "string" && dateStr.length > 10;
}

function airDateToTimestamp(dateStr) {
  const d = hasTimeComponent(dateStr) ? new Date(dateStr) : new Date(dateStr + "T00:00:00");
  return d.getTime();
}

// Just the date, year always included ("Nov 8, 2026") - no "Today"/
// "Tomorrow"/weekday name and no time of day, so this stays one short line
// in the Airing Next row regardless of what else is on it.
function formatAirDate(dateStr) {
  const withTime = hasTimeComponent(dateStr);
  const target = withTime ? new Date(dateStr) : new Date(dateStr + "T00:00:00");
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// The older scrolling layout's longer label: "Today"/"Tomorrow"/weekday
// plus the time of day when the episode list has one.
function formatAirDateLong(dateStr) {
  const withTime = hasTimeComponent(dateStr);
  const today = new Date();
  const target = withTime ? new Date(dateStr) : new Date(dateStr + "T00:00:00");
  const sameYear = target.getFullYear() === today.getFullYear();

  if (withTime) {
    // A real date+time (with timezone offset), so "Today"/"Tomorrow" are
    // trustworthy here - they're computed from the actual moment, not
    // guessed from a bare date.
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

  // Only a bare date, no reliable time-of-day - deliberately NOT using
  // "Today"/"Tomorrow" here, since that would be a guess.
  return target.toLocaleDateString(undefined, sameYear
    ? { weekday: "long", month: "short", day: "numeric" }
    : { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function airDateText(row) {
  return (isScrollLayout() && row.airDateLongLabel) || row.airDateLabel;
}

async function buildAiringRow(item, cache, episodeCache, requirePremiere) {
  const show = item.show || {};
  const tmdbId = (show.ids || {}).tmdb;
  const showId = (show.ids || {}).library;
  const imdbId = (show.ids || {}).imdb;

  // Prefer the episode list (exact date+time where known, and an episode on
  // the air right now); fall back to TMDB's season data (date only) if it
  // has nothing upcoming.
  let next = showId ? await nextAiringEpisodeFromList(showId, episodeCache, show.runtime) : null;
  // Nothing on the air and zero not-yet-aired episodes in the list: nothing
  // upcoming, whatever TMDB's dates say.
  if (!next && item.not_aired_episodes_count === 0) return null;

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

  const images = computeImages(showDetail, tmdbId, "panel");
  const nextLabel = (next.season != null && next.episode != null)
    ? `S${String(next.season).padStart(2, "0")}E${String(next.episode).padStart(2, "0")}`
    : "";

  // Episode title: prefer the episode list's title if it has one, else TMDB's.
  let nextEpisodeTitle = null;
  if (showId) {
    const showEpisodes = await episodeCache.get(showId);
    const match = showEpisodes && showEpisodes.find(e => e.season === next.season && e.episode === next.episode);
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
  const ratings = await loadRatings(showDetail && showDetail.vote_average, imdbId, recentShow);
  const imdbRating = ratings.imdb;

  // Premiere/finale badge: episode 1 of a season is a premiere (season 1
  // specifically is a series premiere); otherwise, if this is the highest
  // episode number listed for that season, treat it as the season finale.
  // The finale check is a best-effort signal only - it reflects what has
  // been published for the season so far, not confirmed final-episode
  // metadata.
  let badge = null;
  if (next.episode === 1) {
    badge = next.season === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
  } else if (showId) {
    const showEpisodes = await episodeCache.get(showId);
    const sameSeason = (showEpisodes || []).filter(e => e.season === next.season && e.episode != null);
    if (sameSeason.length) {
      const maxEpisode = Math.max(...sameSeason.map(e => e.episode));
      if (next.episode === maxEpisode) badge = "SEASON FINALE";
    }
  }

  const showNetwork = latestNetwork(showDetail);
  let network = showNetwork ? showNetwork.name : null;
  const tmdbLogoPath = showNetwork ? showNetwork.logo_path : null;

  return {
    title: show.title || "Unknown",
    imdbId,
    tmdbId,
    imdbRating,
    ratings,
    ...images,
    nextLabel,
    nextEpisodeTitle,
    nextSeason: next.season,
    badge,
    airDate: next.airDate,
    airDateLabel: formatAirDate(next.airDate),
    airDateLongLabel: formatAirDateLong(next.airDate),
    // The corner chip (airCountHtml): an exact air time, else the date.
    airStart: hasTimeComponent(next.airDate) ? airDateToTimestamp(next.airDate) : null,
    airEnd: next.airEnd != null ? next.airEnd : null,
    airDay: next.airDate && !hasTimeComponent(next.airDate) ? next.airDate.slice(0, 10) : null,
    // Where its date/time came from (LibraryAdapter's dateSource): a small
    // tag under the chip names it.
    airFrom: next.from || null,
    network,
    networkLogoPath: resolveNetworkLogoUrl(network, tmdbLogoPath),
  };
}

async function getAiringNextRows(cache, episodeCache) {
  cache = cache || new TmdbCache();
  episodeCache = episodeCache || newEpisodeCache();

  const [watchingItems, planToWatchItems] = await Promise.all([
    getWatchingShowsOnce(),
    getPlanToWatchShows(),
  ]);

  // Both passes run their per-show work concurrently. The second pass still
  // has to wait for the first to finish (it needs the full seenTmdbIds set
  // to skip shows already added from Watching), but within each pass every
  // show is fetched in parallel instead of one-at-a-time.
  const watchingEligible = watchingItems.filter(item => item.status === "watching");
  const watchingRows = await Promise.all(watchingEligible.map(item =>
    buildAiringRow(item, cache, episodeCache, /* requirePremiere */ false)
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
    const tmdbId = (item.show || {}).ids && item.show.ids.tmdb;
    return !(tmdbId && seenTmdbIds.has(tmdbId)); // already added from Watching
  });
  const planRows = await Promise.all(planEligible.map(item =>
    buildAiringRow(item, cache, episodeCache, /* requirePremiere */ true)
  ));
  for (const row of planRows) {
    if (row) rows.push(row);
  }

  rows.sort((a, b) => compareAirDates(a.airDate, b.airDate));
  rows.forEach((r, i) => { r.index = i + 1; });
  return rows;
}
