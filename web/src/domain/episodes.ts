/**
 * Merging the episode sources into one list.
 *
 * `computeProgress` insists on a single episode list as the sole source of
 * truth, because two lists that can disagree is the problem this rewrite exists
 * to remove. But the episodes now arrive from up to three places - TVmaze, TMDB,
 * and whatever the user typed in by hand - so the reconciliation has to happen
 * somewhere, deliberately and in one place. It happens here, before anything
 * counts anything.
 *
 * Pure, and it knows nothing about either API's wire format; the api layer
 * normalizes first. That is what keeps these rules testable.
 */

import { hasTimeComponent } from "./airdates";
import { encodeSE, type Episode } from "./types";

export type EpisodeSources = {
  /** TVmaze: carries a real broadcast timestamp and a per-episode runtime. */
  primary?: readonly Episode[] | undefined;
  /** TMDB: bare dates, but it covers shows TVmaze has never heard of. */
  fallback?: readonly Episode[] | undefined;
  /**
   * Episodes the user entered because neither source listed them yet. This is
   * the replacement for the one thing SIMKL genuinely did better - it knew
   * about a brand-new episode first, often enough for the old README to name it
   * as a reason to keep SIMKL.
   *
   * They only ever FILL GAPS: the moment a real source lists the episode, the
   * source wins. A manual entry is a stopgap for an absence, so it should stop
   * mattering the instant the absence ends, rather than pinning a hand-typed
   * date in place for good.
   */
  manual?: readonly Episode[] | undefined;
};

/**
 * How precise an air date is. This ranks above source priority, because
 * precision is the entire reason SIMKL was preferred over TMDB for dates in the
 * first place: only a timestamp with an offset can support a "Today" or
 * "Tomorrow" label that does not drift across timezones (see `./airdates`).
 */
function datePrecision(airDate: string | null): number {
  if (!airDate) return 0;
  return hasTimeComponent(airDate) ? 2 : 1;
}

/**
 * Combines the sources, keyed on season and episode number.
 *
 * Merging is per field rather than per list, which matters in both directions:
 * TVmaze often has next week's episode before TMDB does, while TMDB carries
 * whole shows - Israeli ones especially - that TVmaze has never listed. Taking
 * one list wholesale would throw away whichever half the other source had.
 *
 * Returned sorted by season and episode, which is the order every consumer
 * wants and the order `computeProgress`'s broadcast-position rule depends on.
 */
export function mergeEpisodes(sources: EpisodeSources): Episode[] {
  const merged = new Map<number, Episode>();

  // Ranked, highest priority first. Only used to break ties - a better air date
  // from a lower-ranked source still wins on that one field.
  const ranked = [sources.primary ?? [], sources.fallback ?? []];

  for (const list of ranked) {
    for (const ep of list) {
      const key = encodeSE(ep.season, ep.episode);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...ep });
        continue;
      }
      merged.set(key, {
        season: existing.season,
        episode: existing.episode,
        airDate:
          datePrecision(ep.airDate) > datePrecision(existing.airDate)
            ? ep.airDate
            : existing.airDate,
        title: existing.title ?? ep.title,
        runtime: existing.runtime ?? ep.runtime,
      });
    }
  }

  for (const ep of sources.manual ?? []) {
    const key = encodeSE(ep.season, ep.episode);
    if (!merged.has(key)) merged.set(key, { ...ep });
  }

  return [...merged.values()].sort(
    (a, b) => encodeSE(a.season, a.episode) - encodeSE(b.season, b.episode),
  );
}

/**
 * Which source a merged list actually came from, for the coverage report and
 * for telling the user why a show looks thin.
 */
export type EpisodeCoverage = {
  primaryCount: number;
  fallbackCount: number;
  manualCount: number;
  mergedCount: number;
  /** Episodes only the fallback knew about - TVmaze's blind spots. */
  fallbackOnly: number;
  /** Episodes only the primary knew about - usually next week's. */
  primaryOnly: number;
  /** Merged episodes carrying a real broadcast time rather than a bare date. */
  withBroadcastTime: number;
};

export function describeCoverage(sources: EpisodeSources): EpisodeCoverage {
  const primary = sources.primary ?? [];
  const fallback = sources.fallback ?? [];
  const manual = sources.manual ?? [];

  const primaryKeys = new Set(primary.map((e) => encodeSE(e.season, e.episode)));
  const fallbackKeys = new Set(fallback.map((e) => encodeSE(e.season, e.episode)));
  const merged = mergeEpisodes(sources);

  return {
    primaryCount: primary.length,
    fallbackCount: fallback.length,
    manualCount: manual.length,
    mergedCount: merged.length,
    fallbackOnly: [...fallbackKeys].filter((k) => !primaryKeys.has(k)).length,
    primaryOnly: [...primaryKeys].filter((k) => !fallbackKeys.has(k)).length,
    withBroadcastTime: merged.filter((e) => hasTimeComponent(e.airDate)).length,
  };
}
