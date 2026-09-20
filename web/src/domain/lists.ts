/**
 * How the three panels order themselves. Ported from app.js:1126-1290 and
 * 951-1010.
 *
 * Pure, so the ordering rules can be tested against a handful of shows instead
 * of inferred from a live page. The old versions were embedded in the middle of
 * the fetch-and-render passes that produced the rows, which is why none of them
 * had a test.
 */

import { safeAirDateToTimestamp } from "./airdates";
import type { Progress } from "./progress";

/** The most recent episode of one show, for the Recently Watched panel. */
export type RecentWatch = {
  key: string;
  title: string;
  season: number;
  episode: number;
  watchedAt: string;
  watchedTs: number;
  /**
   * True for a show you have since dropped. It still competes for a slot -
   * you did just watch it - but the row is badged, unchanged from the old
   * behaviour (app.js:985-1000).
   */
  dropped: boolean;
};

export type WatchSource = {
  key: string;
  title: string;
  status: string;
  watched: Readonly<Record<number, Readonly<Record<number, string>>>>;
};

/** The old panel showed fifteen rows. */
export const RECENTLY_WATCHED_LIMIT = 15;

/**
 * The fifteen most recently watched episodes, at most one per show.
 *
 * One per show, because binge-watching four episodes of the same thing would
 * otherwise fill the panel and push everything else out.
 *
 * Only `watching` and `dropped` shows are scanned, which is the old behaviour.
 * It is worth noting that this is now a CHOICE rather than a limitation: the old
 * app could not have included `completed` or `hold` shows here even if it had
 * wanted to, because SIMKL returns no per-episode timestamps for them. The local
 * library has them, so widening this is a one-word change if it ever reads wrong.
 */
export function recentlyWatched(
  shows: readonly WatchSource[],
  limit: number = RECENTLY_WATCHED_LIMIT,
): RecentWatch[] {
  const best = new Map<string, RecentWatch>();

  for (const show of shows) {
    if (show.status !== "watching" && show.status !== "dropped") continue;

    for (const [seasonKey, episodes] of Object.entries(show.watched)) {
      const season = Number(seasonKey);
      if (season === 0) continue;

      for (const [episodeKey, watchedAt] of Object.entries(episodes)) {
        const watchedTs = Date.parse(watchedAt);
        if (Number.isNaN(watchedTs)) continue;

        const current = best.get(show.key);
        if (current && current.watchedTs >= watchedTs) continue;

        best.set(show.key, {
          key: show.key,
          title: show.title,
          season,
          episode: Number(episodeKey),
          watchedAt,
          watchedTs,
          dropped: show.status === "dropped",
        });
      }
    }
  }

  return [...best.values()].sort((a, b) => b.watchedTs - a.watchedTs).slice(0, limit);
}

/**
 * The My List sort key: whichever is more recent, the next episode's air date or
 * the last time you actually watched something of that show.
 *
 * The air date alone buries an ended show you are actively rewatching, because
 * its next unwatched episode first aired years ago; `lastWatchedAt` is what
 * pulls it back up while you are catching up. Compared as timestamps, not
 * strings - these dates carry timezone offsets, and lexical comparison gets that
 * wrong across different ones.
 */
export function myListSortKey(progress: Pick<Progress, "nextToWatch" | "lastWatchedAt">): number | null {
  const airTs = safeAirDateToTimestamp(progress.nextToWatch?.airDate);
  const watchTs = progress.lastWatchedAt;
  if (airTs == null && watchTs == null) return null;
  if (airTs == null) return watchTs;
  if (watchTs == null) return airTs;
  return Math.max(airTs, watchTs);
}

/**
 * Sorts by a key, most recent first, with shows that have no signal at the end.
 *
 * Shared by the panels because "unknown sinks to the bottom" is the rule
 * everywhere - a show with nothing to sort on should never displace one that has
 * something.
 */
export function sortByKeyDescending<T>(items: readonly T[], keyOf: (item: T) => number | null): T[] {
  return [...items].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return kb - ka;
  });
}

/**
 * Plan to Watch, highest IMDb rating first, unrated shows last.
 *
 * The panel is a shortlist of what to start next, so the best-reviewed thing you
 * have not begun belongs at the top (app.js:1125-1132).
 */
export function sortByRating<T>(items: readonly T[], ratingOf: (item: T) => number | null): T[] {
  return sortByKeyDescending(items, ratingOf);
}
