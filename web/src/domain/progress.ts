/**
 * Derives everything SIMKL used to hand over as pre-computed aggregate fields.
 *
 * The old app read `total_episodes_count`, `not_aired_episodes_count`,
 * `watched_episodes_count` and `next_to_watch` straight off each list item
 * (app.js:813-818), and separately walked SIMKL's per-episode list to work out
 * WHICH episodes were outstanding (app.js:756-773). Two sources for one truth,
 * which is why `estimateRemainingMinutes` needed a `padCount` fudge whenever
 * the aggregate count exceeded the episodes it could actually identify
 * (app.js:795-806).
 *
 * Here the episode list is the single source for both, so the count and the
 * identified episodes cannot disagree and no padding is possible.
 */

import { type Episode, type WatchedMap, encodeSE } from "./types";
import { safeAirDateToTimestamp } from "./airdates";

export type Progress = {
  /** Non-special episodes the metadata source knows about. */
  total: number;
  /** Of those, already aired as of `now`. */
  aired: number;
  /** Announced but not yet aired - includes episodes with no date at all. */
  notAired: number;
  /** Watched episodes, counted across non-special seasons. */
  watched: number;
  /** Aired and unwatched. Equal to `remainingEpisodes.length`, by construction. */
  remaining: number;
  /** Aired and unwatched, oldest first. The first entry is the next one to watch. */
  remainingEpisodes: Episode[];
  /** Convenience alias for `remainingEpisodes[0]`. */
  nextToWatch: Episode | null;
  /** Soonest episode whose air time is strictly in the future. */
  nextAiring: Episode | null;
  /** Most recent `watchedAt` across every watched episode, as a timestamp. */
  lastWatchedAt: number | null;
  /** Latest episode that has aired - drives the new-episode notification. */
  latestAired: Episode | null;
};

function bySeasonEpisode(a: Episode, b: Episode): number {
  return encodeSE(a.season, a.episode) - encodeSE(b.season, b.episode);
}

function isWatched(watched: WatchedMap, season: number, episode: number): boolean {
  return watched[season]?.[episode] != null;
}

/**
 * @param episodes  Every episode the metadata layer knows, any order. Specials
 *                  (season 0) are filtered out here, matching the old app,
 *                  which skipped them at every call site.
 * @param watched   The user's own watch map, straight from the library store.
 * @param now       Injectable clock. Episodes are "aired" once their real air
 *                  moment has passed - not "start of today", so an episode that
 *                  aired earlier today counts as available immediately, the same
 *                  cutoff `nextAiringEpisodeSimkl` used (app.js:1336-1341).
 */
export function computeProgress(
  episodes: readonly Episode[],
  watched: WatchedMap,
  now: number = Date.now(),
): Progress {
  const regular = episodes.filter((ep) => ep.season !== 0).slice().sort(bySeasonEpisode);

  const aired: Episode[] = [];
  const remainingEpisodes: Episode[] = [];
  let nextAiring: Episode | null = null;
  let notAired = 0;

  for (const ep of regular) {
    const ts = safeAirDateToTimestamp(ep.airDate);

    // No date at all means announced-but-unscheduled: not aired, and it can
    // never become "next airing" because there is nothing to sort it by.
    if (ts == null || ts > now) {
      notAired += 1;
      if (ts != null) {
        const bestTs = nextAiring ? safeAirDateToTimestamp(nextAiring.airDate) : null;
        if (bestTs == null || ts < bestTs) nextAiring = ep;
      }
      continue;
    }

    aired.push(ep);
    if (!isWatched(watched, ep.season, ep.episode)) remainingEpisodes.push(ep);
  }

  return {
    total: regular.length,
    aired: aired.length,
    notAired,
    watched: countWatched(watched),
    remaining: remainingEpisodes.length,
    remainingEpisodes,
    nextToWatch: remainingEpisodes[0] ?? null,
    nextAiring,
    lastWatchedAt: mostRecentWatchedAt(watched),
    latestAired: aired.length ? (aired[aired.length - 1] ?? null) : null,
  };
}

/**
 * Counts the user's watched episodes without consulting the episode list, so a
 * show whose metadata failed to load still reports honest progress.
 * Specials are excluded, same as everywhere else.
 */
export function countWatched(watched: WatchedMap): number {
  let n = 0;
  for (const [seasonKey, episodes] of Object.entries(watched)) {
    if (Number(seasonKey) === 0) continue;
    n += Object.keys(episodes).length;
  }
  return n;
}

/**
 * Most recent watch timestamp across a show, or null if nothing is timestamped.
 * Keeps an old, already-ended show near the top of My List while you are
 * actively catching up on it - its air dates are years old otherwise
 * (app.js:709-719).
 */
export function mostRecentWatchedAt(watched: WatchedMap): number | null {
  let latest: number | null = null;
  for (const episodes of Object.values(watched)) {
    for (const watchedAt of Object.values(episodes)) {
      const ts = new Date(watchedAt).getTime();
      if (!Number.isNaN(ts) && (latest == null || ts > latest)) latest = ts;
    }
  }
  return latest;
}

/** Highest episode number per season, for the premiere/finale badges. */
export function seasonMaxEpisodes(episodes: readonly Episode[]): Map<number, number> {
  const max = new Map<number, number>();
  for (const ep of episodes) {
    if (ep.season === 0) continue;
    const prev = max.get(ep.season);
    if (prev == null || ep.episode > prev) max.set(ep.season, ep.episode);
  }
  return max;
}
