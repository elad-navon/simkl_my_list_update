/**
 * Normalizes SIMKL's `/tv/episodes/{id}` payload into the domain `Episode`.
 *
 * This exists for one job: to let the parity harness drive the NEW progress
 * derivation with SIMKL's own episode list, so any difference against SIMKL's
 * pre-computed counts is a difference in the LOGIC and not in the episode
 * data. Once parity is clean, TVmaze and TMDB feed the same `Episode[]` and
 * this file goes away with the rest of `migrate/`.
 *
 * Two things about SIMKL's shape that the old app handled by accident and
 * that are made explicit here:
 *
 * - A `type: "special"` entry carries NO season and NO episode number at all
 *   (3,822 of them across this library). They are not season 0 - they are
 *   unnumbered. The old app dropped them via its `ep.season == null` guard
 *   (app.js:760), so they are dropped here too, by the same rule.
 * - `date` is absent on announced-but-unscheduled episodes. The old app
 *   filtered those out of the episodes it could identify (app.js:766) while
 *   still counting them inside SIMKL's aggregate total - the exact split that
 *   made `padCount` necessary. Here a dateless episode is kept, counted in
 *   `total`, and reported as not-aired, which is what it is.
 */

import type { Episode } from "../../domain/types";

export type SimklApiEpisode = {
  season?: number | null;
  episode?: number | null;
  type?: string | null;
  title?: string | null;
  /** Full ISO datetime WITH a UTC offset - SIMKL's real advantage over TMDB. */
  date?: string | null;
  aired?: boolean | null;
};

/** Drops SIMKL's unnumbered specials; keeps everything else, date or not. */
export function normalizeSimklEpisodes(
  payload: readonly SimklApiEpisode[] | null | undefined,
): Episode[] {
  if (!Array.isArray(payload)) return [];

  const out: Episode[] = [];
  for (const ep of payload) {
    if (ep.season == null || ep.episode == null) continue;
    out.push({
      season: ep.season,
      episode: ep.episode,
      airDate: ep.date ?? null,
      title: ep.title?.trim() || null,
      // SIMKL does not report a per-episode runtime on this endpoint; the
      // show-level `runtime` is the only figure it has, so runtime stays null
      // and `averageEpisodeRuntime` supplies the fallback, exactly as before.
      runtime: null,
    });
  }
  return out;
}
