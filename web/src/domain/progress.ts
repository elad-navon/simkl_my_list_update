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
  /** Announced but not yet aired. */
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
  /** Latest DATED episode that has aired - drives the new-episode notification. */
  latestAired: Episode | null;
};

export type ProgressOptions = {
  /**
   * Injectable clock. Episodes are "aired" once their real air moment has
   * passed - not "start of today", so an episode that aired earlier today
   * counts as available immediately, the same cutoff `nextAiringEpisodeSimkl`
   * used (app.js:1336-1341).
   */
  now?: number;
  /**
   * True when the series has finished airing - TMDB `status` of "Ended" or
   * "Canceled". Consulted ONLY for an undated episode that the broadcast-order
   * rule below cannot place: a series that has stopped airing has no future
   * episodes, so an undated episode in it must be a past one whose date the
   * source never recorded.
   *
   * Every case this changes is cosmetic in practice - it moves an episode
   * between `aired` and `notAired` on shows that are finished and fully
   * watched, so `remaining` is zero either way. It is worth wiring up anyway
   * because it costs nothing: phase 3 fetches the TMDB show detail regardless.
   */
  seriesEnded?: boolean;
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
 *
 * ## Episodes with no air date
 *
 * A source listing an episode with no date means one of two opposite things,
 * and getting it wrong is user-visible: call a past episode unaired and the
 * app hides something you could watch tonight; call a future one aired and it
 * offers you an episode that does not exist yet.
 *
 * SIMKL's own data cannot settle it - its per-episode `aired` flag reads
 * `true` on all 999 undated episodes in this library, upcoming ones included,
 * while its aggregate `not_aired_episodes_count` counts those same upcoming
 * episodes as unaired. Two fields, one contradiction, which is precisely the
 * two-sources-of-truth problem this module exists to end.
 *
 * So the decision is made from the episode list itself, using the one thing
 * that is always true of broadcast: it runs in order. An undated episode that
 * sits BEFORE an episode which has demonstrably aired must itself have aired;
 * the source simply never recorded its date. That is the entire rule, and on
 * this library it reproduces SIMKL's unaired count for 704 of 709 shows with
 * no date arithmetic, no thresholds and nothing to tune. It resolves every
 * case that affects a number you see - old Israeli shows whose episodes TheTVDB
 * lists without dates, where 216 watchable episodes would otherwise vanish
 * from the remaining count.
 *
 * An undated episode with nothing aired after it stays unaired, which is the
 * safe direction: an episode wrongly listed as remaining is one you notice and
 * dismiss, an episode wrongly hidden is one you never find out you missed.
 * `seriesEnded` is what settles those, and the four shows in this library that
 * need it are all finished and fully watched.
 */
export function computeProgress(
  episodes: readonly Episode[],
  watched: WatchedMap,
  options: ProgressOptions = {},
): Progress {
  const { now = Date.now(), seriesEnded = false } = options;
  const regular = episodes.filter((ep) => ep.season !== 0).slice().sort(bySeasonEpisode);

  // Pass 1: place the broadcast. `lastAiredIndex` is how far into the numbering
  // the show has demonstrably got, which is what lets an undated episode be
  // judged by its position rather than by a guess about its date.
  const timestamps = regular.map((ep) => safeAirDateToTimestamp(ep.airDate));
  let lastAiredIndex = -1;
  for (let i = 0; i < regular.length; i += 1) {
    const ts = timestamps[i];
    if (ts != null && ts <= now) lastAiredIndex = i;
  }

  // Pass 2: classify.
  const aired: Episode[] = [];
  const remainingEpisodes: Episode[] = [];
  let nextAiring: Episode | null = null;
  let nextAiringTs: number | null = null;
  let latestAired: Episode | null = null;
  let notAired = 0;

  for (let i = 0; i < regular.length; i += 1) {
    const ep = regular[i];
    if (!ep) continue;
    const ts = timestamps[i] ?? null;

    if (ts != null && ts > now) {
      notAired += 1;
      if (nextAiringTs == null || ts < nextAiringTs) {
        nextAiring = ep;
        nextAiringTs = ts;
      }
      continue;
    }

    // Undated: aired only if the broadcast has provably moved past it, or the
    // series has stopped airing altogether. An undated episode can never be
    // `nextAiring` - there is nothing to sort it by.
    if (ts == null && !(i < lastAiredIndex || seriesEnded)) {
      notAired += 1;
      continue;
    }

    aired.push(ep);
    // A notification needs a date to be meaningful, so an undated episode
    // never becomes the "latest aired" one even when it counts as aired.
    if (ts != null) latestAired = ep;
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
    latestAired,
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
