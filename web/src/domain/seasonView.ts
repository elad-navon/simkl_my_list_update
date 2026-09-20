/**
 * A show broken into seasons and episodes, each carrying its own state.
 *
 * This is the data behind a capability the old app never had: opening a show and
 * seeing every episode, so any one of them can be marked or un-marked. Today the
 * only thing you can do is mark the NEXT episode watched (app.js:2401) - which
 * is fine while SIMKL is the truth and simkl.com is there to fix mistakes on,
 * and useless the moment this app is the only place the history lives.
 *
 * It matters more than a convenience. The migration rebuilt 581 shows' history
 * from a watched COUNT rather than reading it episode by episode, so there are
 * places where the boundary is one episode off, and 24 finished shows read as
 * having episodes left because the metadata source numbers them differently from
 * SIMKL. Without a way to see and correct individual episodes, none of that is
 * fixable from inside the app.
 *
 * Pure, and it takes the clock, so the view a test asserts on is the view the
 * component renders.
 */

import { safeAirDateToTimestamp } from "./airdates";
import { episodeBadge, type EpisodeBadge } from "./badges";
import { encodeSE, type Episode, type WatchedMap } from "./types";

export type EpisodeRow = Episode & {
  watched: boolean;
  /** When it was watched, if the history records a timestamp. */
  watchedAt: string | null;
  /** Whether it has aired as of `now`. Unaired episodes are not markable. */
  aired: boolean;
  badge: EpisodeBadge | null;
};

export type SeasonRow = {
  season: number;
  episodes: EpisodeRow[];
  /** Counts for the season header: "8 of 10 watched". */
  total: number;
  watched: number;
  aired: number;
  /** True when every aired episode in the season is watched. */
  complete: boolean;
};

export type SeasonView = {
  seasons: SeasonRow[];
  /**
   * Specials, kept apart rather than mixed in. Every count in the app excludes
   * them, so putting them in the running order would make the totals read wrong.
   */
  specials: EpisodeRow[];
  total: number;
  watched: number;
};

/**
 * @param episodes The merged episode list - see `./episodes`.
 * @param watched  The user's own history, straight from the library.
 *
 * Episodes the history knows about but no source lists are included anyway, at
 * the end of their season. A reconstructed history can point at an episode the
 * metadata source has since renumbered away, and an episode that cannot be seen
 * cannot be un-marked - which would leave a count nothing could explain.
 */
export function buildSeasonView(
  episodes: readonly Episode[],
  watched: WatchedMap,
  now: number = Date.now(),
): SeasonView {
  const bySeason = new Map<number, Map<number, Episode>>();

  for (const ep of episodes) {
    const season = bySeason.get(ep.season) ?? new Map<number, Episode>();
    season.set(ep.episode, ep);
    bySeason.set(ep.season, season);
  }

  // Anything in the history that the sources no longer list, so it stays
  // reachable and therefore correctable.
  for (const [seasonKey, episodeMap] of Object.entries(watched)) {
    const seasonNumber = Number(seasonKey);
    const season = bySeason.get(seasonNumber) ?? new Map<number, Episode>();
    for (const episodeKey of Object.keys(episodeMap)) {
      const episodeNumber = Number(episodeKey);
      if (season.has(episodeNumber)) continue;
      season.set(episodeNumber, {
        season: seasonNumber,
        episode: episodeNumber,
        airDate: null,
        title: null,
        runtime: null,
      });
    }
    bySeason.set(seasonNumber, season);
  }

  const seasonMaxEpisode = new Map<number, number>();
  for (const [seasonNumber, episodeMap] of bySeason) {
    if (seasonNumber === 0) continue;
    seasonMaxEpisode.set(seasonNumber, Math.max(...episodeMap.keys()));
  }

  const toRow = (ep: Episode): EpisodeRow => {
    const ts = safeAirDateToTimestamp(ep.airDate);
    const watchedAt = watched[ep.season]?.[ep.episode] ?? null;
    return {
      ...ep,
      watched: watchedAt != null,
      watchedAt,
      // No date means nothing has been claimed about it, so it is not shown as
      // aired. `computeProgress` may still count it via broadcast position; this
      // view only decides whether the row invites a click.
      aired: ts != null && ts <= now,
      badge: episodeBadge(ep, seasonMaxEpisode),
    };
  };

  const seasons: SeasonRow[] = [];
  let specials: EpisodeRow[] = [];

  for (const [seasonNumber, episodeMap] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
    const rows = [...episodeMap.values()]
      .sort((a, b) => encodeSE(a.season, a.episode) - encodeSE(b.season, b.episode))
      .map(toRow);

    if (seasonNumber === 0) {
      specials = rows;
      continue;
    }

    const watchedCount = rows.filter((r) => r.watched).length;
    const airedCount = rows.filter((r) => r.aired).length;
    seasons.push({
      season: seasonNumber,
      episodes: rows,
      total: rows.length,
      watched: watchedCount,
      aired: airedCount,
      complete: airedCount > 0 && rows.every((r) => !r.aired || r.watched),
    });
  }

  return {
    seasons,
    specials,
    total: seasons.reduce((n, s) => n + s.total, 0),
    watched: seasons.reduce((n, s) => n + s.watched, 0),
  };
}

/** The season to open on: the first with anything left, else the last. */
export function defaultOpenSeason(view: SeasonView): number | null {
  const unfinished = view.seasons.find((s) => !s.complete);
  return (unfinished ?? view.seasons[view.seasons.length - 1])?.season ?? null;
}
