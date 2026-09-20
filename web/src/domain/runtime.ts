/**
 * Watch-time estimation. Ported from app.js:679-695 and 721-811.
 *
 * The old version priced SIMKL's aggregate remaining count, padding any
 * episodes it could not identify with the series average (`padCount`,
 * app.js:795-806). It takes the identified episodes directly now - the list
 * from `computeProgress` IS the remaining count - so nothing needs padding.
 * The per-episode fallback survives: it applies only to an episode whose own
 * runtime the source is missing, never as a flat multiplier for the whole
 * show, because a series-wide average is badly wrong for shows whose episode
 * length changed across seasons.
 */

import type { Episode } from "./types";

export type TmdbShowRuntimeInfo = {
  episode_run_time?: number[] | undefined;
  last_episode_to_air?: { runtime?: number | null } | null | undefined;
};

/** Mean of TMDB's declared runtimes, else the last aired episode's runtime. */
export function showAverageRuntime(showDetail: TmdbShowRuntimeInfo | null | undefined): number {
  if (!showDetail) return 0;
  const declared = showDetail.episode_run_time ?? [];
  if (declared.length) return declared.reduce((a, b) => a + b, 0) / declared.length;
  return showDetail.last_episode_to_air?.runtime ?? 0;
}

export function averageEpisodeRuntime(
  showDetail: TmdbShowRuntimeInfo | null | undefined,
  fallbackRuntime: number | null | undefined,
): number {
  return showAverageRuntime(showDetail) || fallbackRuntime || 0;
}

export type RemainingTime = {
  totalMinutes: number;
  /** Runtime of the very next episode, for the "0h 45m / 3h 23m left" line. */
  nextEpisodeMinutes: number;
  /** Each remaining episode priced individually, for the episodes-left modal. */
  episodes: Array<Episode & { runtime: number }>;
};

/**
 * @param remaining  Aired-and-unwatched episodes, oldest first, from
 *                   `computeProgress().remainingEpisodes`.
 * @param avgRuntime Per-episode fallback for episodes with no runtime of
 *                   their own, from `averageEpisodeRuntime`.
 */
export function estimateRemainingTime(
  remaining: readonly Episode[],
  avgRuntime: number,
): RemainingTime {
  const episodes = remaining.map((ep) => ({ ...ep, runtime: ep.runtime || avgRuntime }));
  const totalMinutes = episodes.reduce((sum, ep) => sum + ep.runtime, 0);
  return {
    totalMinutes,
    nextEpisodeMinutes: episodes[0]?.runtime ?? avgRuntime,
    episodes,
  };
}
