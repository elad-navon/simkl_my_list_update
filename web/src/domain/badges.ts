/**
 * Premiere / finale badges. Ported from app.js:779-784 and 1226-1233, which
 * applied the same rule in three places from a per-season max episode number.
 */

import type { Episode } from "./types";

export type EpisodeBadge = "SERIES PREMIERE" | "SEASON PREMIERE" | "SEASON FINALE";

/**
 * @param seasonMax Highest known episode number per season, from
 *                  `seasonMaxEpisodes`. A season the source hasn't finished
 *                  publishing yields no finale badge rather than a wrong one.
 */
export function episodeBadge(
  episode: Pick<Episode, "season" | "episode">,
  seasonMax: ReadonlyMap<number, number>,
): EpisodeBadge | null {
  const { season, episode: number } = episode;
  if (season == null || number == null) return null;
  if (number === 1) return season === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
  const max = seasonMax.get(season);
  return max != null && number === max ? "SEASON FINALE" : null;
}
