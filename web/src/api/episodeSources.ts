/**
 * Assembling one show's episode list out of every source available.
 *
 * This is where the data layer meets the domain layer: it fetches, it merges,
 * and it hands `computeProgress` the single episode list that module insists
 * on. Nothing above this needs to know that there are two metadata services,
 * which of them answered, or which of them was missing.
 *
 * The order matters and is not arbitrary:
 *
 *  - TVmaze first, because its `airstamp` is the only field in the whole
 *    replacement stack that carries a real broadcast time with a timezone
 *    offset - the single property SIMKL was kept around for.
 *  - TMDB second, because it has whole shows TVmaze has never listed. On this
 *    library that is 13 of 107 shows you are actively watching, every one of
 *    them Israeli, plus 4 more where TVmaze has the show but lists fewer
 *    episodes than you have already watched. That is not an edge case, and
 *    `npm run tvmaze-coverage` is what measured it.
 *  - Your own manual episodes last, filling anything both services still miss.
 *
 * The TMDB show DETAIL is always fetched - it is one request, and the artwork,
 * network, genres and content rating all come from it.
 *
 * TMDB's per-season episode lists are not. They are one request PER SEASON, which
 * on this library is about ten per show, and fetching them for everything was
 * measured at roughly 1,130 requests for a hundred shows through a browser
 * connection pool six wide. That is what made a first load appear to hang. The old
 * app fetched only the seasons containing episodes it still needed
 * (app.js:735-747), which is the same instinct.
 *
 * So they are fetched only when TVmaze cannot account for the history: either it
 * has no episodes for the show at all, or its list does not contain every episode
 * the library says was watched. That targets exactly the shows measured as needing
 * it - 46 with no TVmaze record and 22 whose list is short - and skips it for the
 * 641 where TVmaze's list is already complete and carries better dates besides.
 */

import { mergeEpisodes, describeCoverage, type EpisodeCoverage } from "../domain/episodes";
import { encodeSE, type Episode, type WatchedMap } from "../domain/types";
import {
  normalizeTmdbSeasons,
  regularSeasonNumbers,
  tmdbSeriesEnded,
  trimTmdbShow,
  type TmdbClient,
  type TmdbShow,
} from "./tmdb";
import {
  normalizeTvmazeEpisodes,
  tvmazeSeriesEnded,
  type TvmazeClient,
  type TvmazeShow,
} from "./tvmaze";

export type ShowIdentity = {
  tmdb?: number | undefined;
  imdb?: string | undefined;
  tvdb?: number | undefined;
  /** Saved from a previous resolve, so the lookup can be skipped next time. */
  tvmaze?: number | undefined;
};

export type LoadedEpisodes = {
  episodes: Episode[];
  /**
   * True when either service says the show has stopped airing. Passed to
   * `computeProgress` as `seriesEnded`, which is what lets an undated episode
   * on a finished show be counted as aired rather than as pending forever.
   * Either source saying so is enough: neither marks a running show as ended,
   * so a disagreement means one of them simply has not caught up.
   */
  seriesEnded: boolean;
  /** What each source contributed, for diagnostics and the coverage report. */
  coverage: EpisodeCoverage;
  /** Resolved ids worth writing back to the library to skip a lookup later. */
  resolved: { tvmaze: number | null; imdb: string | null };
  /**
   * The TMDB show detail, trimmed to what the UI reads - see `trimTmdbShow`.
   * This whole object ends up in the persisted query cache, so the raw response
   * is not what goes in it.
   */
  tmdbShow: TmdbShow | null;
  /** Which services answered at all, so the UI can say why a show looks thin. */
  sources: { tvmaze: boolean; tmdb: boolean; tmdbSeasons: boolean };
};

export type EpisodeSourceDeps = {
  tvmaze: TvmazeClient;
  /** Null when the user has not set a TMDB key; TVmaze then carries it alone. */
  tmdb: TmdbClient | null;
};

/**
 * A failed source is a missing source, never a failed load.
 *
 * A show with no artwork and approximate dates still shows you what is left to
 * watch; a show that threw shows you nothing. The old app took the same view
 * for exactly this reason (app.js:436-446).
 */
async function attempt<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

export async function loadEpisodes(
  deps: EpisodeSourceDeps,
  show: {
    ids: ShowIdentity;
    manualEpisodes?: readonly Episode[] | undefined;
    /**
     * The show's watch history, used only to decide whether TVmaze's episode list
     * is good enough to skip TMDB's seasons. Absent means "assume it is not", so a
     * caller with no history still gets the complete list.
     */
    watched?: WatchedMap | undefined;
  },
  signal?: AbortSignal,
): Promise<LoadedEpisodes> {
  const tmdbId = show.ids.tmdb;
  const tmdb = deps.tmdb;
  const canUseTmdb = tmdb !== null && tmdbId !== undefined;

  const [tvmazeResult, tmdbShow] = await Promise.all([
    loadFromTvmaze(deps.tvmaze, show.ids, signal),
    canUseTmdb ? attempt(() => tmdb.getShow(tmdbId, signal)) : Promise.resolve(null),
  ]);

  const needsTmdbSeasons =
    canUseTmdb && tmdbShow !== null && !coversHistory(tvmazeResult.episodes, show.watched);

  const tmdbEpisodes =
    needsTmdbSeasons && tmdbShow ? await loadTmdbSeasons(tmdb, tmdbId, tmdbShow, signal) : [];

  const sources: EpisodeSourcesInput = {
    primary: tvmazeResult.episodes,
    fallback: tmdbEpisodes,
    ...(show.manualEpisodes ? { manual: show.manualEpisodes } : {}),
  };

  return {
    episodes: mergeEpisodes(sources),
    seriesEnded: tvmazeSeriesEnded(tvmazeResult.show) || tmdbSeriesEnded(tmdbShow),
    coverage: describeCoverage(sources),
    resolved: {
      tvmaze: tvmazeResult.show?.id ?? null,
      imdb: tmdbShow?.external_ids?.imdb_id ?? show.ids.imdb ?? null,
    },
    tmdbShow: trimTmdbShow(tmdbShow),
    sources: {
      tvmaze: tvmazeResult.show != null,
      tmdb: tmdbShow != null,
      // Whether TMDB's episode lists were needed, which is the expensive part and
      // therefore the thing worth being able to see.
      tmdbSeasons: needsTmdbSeasons,
    },
  };
}

type EpisodeSourcesInput = Parameters<typeof mergeEpisodes>[0];

/**
 * Whether a list contains every episode the history says was watched.
 *
 * The question behind "do we need TMDB's seasons as well". A list that cannot
 * account for something already watched is missing episodes, whatever else it has,
 * and that is exactly when the fallback earns its requests.
 */
function coversHistory(episodes: readonly Episode[], watched: WatchedMap | undefined): boolean {
  if (episodes.length === 0) return false;
  if (!watched) return false;

  const listed = new Set(episodes.map((ep) => encodeSE(ep.season, ep.episode)));
  for (const [seasonKey, seasonEpisodes] of Object.entries(watched)) {
    const season = Number(seasonKey);
    if (season === 0) continue;
    for (const episodeKey of Object.keys(seasonEpisodes)) {
      if (!listed.has(encodeSE(season, Number(episodeKey)))) return false;
    }
  }
  return true;
}

async function loadFromTvmaze(
  client: TvmazeClient,
  ids: ShowIdentity,
  signal?: AbortSignal,
): Promise<{ show: TvmazeShow | null; episodes: Episode[] }> {
  // A tvmaze id saved from an earlier resolve skips the lookup entirely, which
  // halves the request count for a library that has been loaded before - and
  // TVmaze's rate limit is the thing that makes request count matter here.
  let show: TvmazeShow | null = null;
  if (ids.tvmaze != null) {
    show = { id: ids.tvmaze };
  } else {
    show = await attempt(() =>
      client.lookupShow(
        {
          ...(ids.imdb ? { imdb: ids.imdb } : {}),
          ...(ids.tvdb != null ? { tvdb: ids.tvdb } : {}),
        },
        signal,
      ),
    );
  }
  if (!show) return { show: null, episodes: [] };

  const episodes = await attempt(() => client.getEpisodes(show.id, signal));
  return { show, episodes: normalizeTvmazeEpisodes(episodes) };
}

async function loadTmdbSeasons(
  client: TmdbClient,
  tmdbId: number,
  show: TmdbShow,
  signal?: AbortSignal,
): Promise<Episode[]> {
  const seasons = await Promise.all(
    regularSeasonNumbers(show).map((n) => attempt(() => client.getSeason(tmdbId, n, signal))),
  );
  return normalizeTmdbSeasons(seasons);
}
