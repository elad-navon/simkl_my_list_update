/**
 * TMDB. Ported from app.js:310-527, minus the two cache layers.
 *
 * The endpoints and their parameters are kept exactly as the old app tuned
 * them, because each parameter is there for a reason that took a while to find.
 * What is gone is the plumbing around them: `TmdbCache`'s in-flight promise
 * maps and the localStorage mirror with its per-endpoint TTLs and pruning sweep
 * (app.js:349-527) are what TanStack Query and its IndexedDB persister do, so
 * these are plain functions that fetch once and return.
 *
 * TMDB's role also changes. It was supplementary before - artwork, external
 * ids, runtimes - while SIMKL owned the episode counts. Now it is the fallback
 * broadcast source behind TVmaze, and the only source for artwork, cast,
 * genres, content rating and network. It still degrades to null rather than
 * throwing for a single unknown show.
 */

import { getJson } from "./http";
import type { Episode } from "../domain/types";

export const TMDB_BASE = "https://api.themoviedb.org/3";

/** Image bases, unchanged from app.js:9-12 - the sizes the CSS is built around. */
export const TMDB_IMAGE_BASES = {
  poster: "https://image.tmdb.org/t/p/w342",
  backdrop: "https://image.tmdb.org/t/p/w780",
  logo: "https://image.tmdb.org/t/p/w92",
  profile: "https://image.tmdb.org/t/p/w185",
} as const;

const SERVICE = "TMDB";

/** TMDB status strings that mean the show has stopped airing. */
const ENDED_STATUSES = new Set(["Ended", "Canceled", "Cancelled"]);

export type TmdbEpisodeSummary = {
  episode_number?: number | null;
  season_number?: number | null;
  name?: string | null;
  air_date?: string | null;
  runtime?: number | null;
};

export type TmdbSeason = {
  season_number?: number | null;
  episodes?: TmdbEpisodeSummary[] | null;
};

export type TmdbShow = {
  id?: number;
  name?: string | null;
  original_name?: string | null;
  first_air_date?: string | null;
  status?: string | null;
  episode_run_time?: number[] | undefined;
  last_episode_to_air?: { runtime?: number | null } | null | undefined;
  seasons?: Array<{ season_number?: number | null; episode_count?: number | null }> | null;
  networks?: Array<{ name?: string | null; logo_path?: string | null }> | null;
  genres?: Array<{ name?: string | null }> | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  images?: { posters?: Array<{ file_path?: string | null; iso_639_1?: string | null }>; backdrops?: Array<{ file_path?: string | null; iso_639_1?: string | null }> } | undefined;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null } | null;
  content_ratings?: { results?: Array<{ iso_3166_1?: string; rating?: string }> } | undefined;
};

export type TmdbSearchResult = {
  id: number;
  name?: string | null;
  original_name?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
};

export type TmdbClient = {
  getShow: (tmdbId: number, signal?: AbortSignal) => Promise<TmdbShow | null>;
  getSeason: (tmdbId: number, seasonNumber: number, signal?: AbortSignal) => Promise<TmdbSeason | null>;
  getEpisodeExternalIds: (tmdbId: number, season: number, episode: number, signal?: AbortSignal) => Promise<{ imdb_id?: string | null } | null>;
  getAggregateCredits: (tmdbId: number, signal?: AbortSignal) => Promise<unknown | null>;
  getPersonExternalIds: (personId: number, signal?: AbortSignal) => Promise<{ imdb_id?: string | null } | null>;
  searchShows: (query: string, signal?: AbortSignal) => Promise<TmdbSearchResult[]>;
};

export function createTmdbClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch | undefined;
}): TmdbClient {
  const get = <T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal) =>
    getJson<T>(`${TMDB_BASE}${path}`, {
      service: SERVICE,
      params: { api_key: options.apiKey, ...params },
      ...(signal ? { signal } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });

  return {
    /**
     * `append_to_response` folds three extra responses into the one request
     * every show already needs: all artwork for the cycle-through-alternates
     * feature, the show's IMDb id for the title link, and its age rating.
     * `include_image_language=en,null,he` asks for English and untagged artwork
     * plus Hebrew, which `computeImages` uses only as a last resort for Israeli
     * shows that have nothing else.
     */
    getShow(tmdbId, signal) {
      return get<TmdbShow>(
        `/tv/${tmdbId}`,
        {
          append_to_response: "images,external_ids,content_ratings",
          language: "en-US",
          include_image_language: "en,null,he",
        },
        signal,
      );
    },

    getSeason(tmdbId, seasonNumber, signal) {
      return get<TmdbSeason>(`/tv/${tmdbId}/season/${seasonNumber}`, {}, signal);
    },

    /** Per-episode endpoint; TMDB has no bulk form, so call it lazily. */
    getEpisodeExternalIds(tmdbId, season, episode, signal) {
      return get(`/tv/${tmdbId}/season/${season}/episode/${episode}/external_ids`, {}, signal);
    },

    /**
     * `aggregate_credits`, not `credits`: it sums a person's appearances across
     * every season, so long-running main cast still rank near the top in a
     * show's later seasons.
     */
    getAggregateCredits(tmdbId, signal) {
      return get(`/tv/${tmdbId}/aggregate_credits`, {}, signal);
    },

    getPersonExternalIds(personId, signal) {
      return get(`/person/${personId}/external_ids`, {}, signal);
    },

    /**
     * `language=he-IL` was added because SIMKL's search could not handle Hebrew
     * at all (app.js:1581). SIMKL is gone and TMDB is now the only search
     * source, so this parameter carries the whole Hebrew case on its own. It
     * only changes which localized title comes back, never which shows match.
     */
    async searchShows(query, signal) {
      const data = await get<{ results?: TmdbSearchResult[] }>(
        "/search/tv",
        { query, language: "he-IL" },
        signal,
      );
      return data?.results ?? [];
    },
  };
}

// --- normalization ----------------------------------------------------------

/**
 * Flattens TMDB seasons into the domain episode shape.
 *
 * TMDB names an episode `Episode 7` when it has no real title, which reads as
 * noise in a list of episodes numbered anyway, so that pattern becomes null -
 * same test the old app used (app.js:744).
 */
export function normalizeTmdbSeasons(seasons: readonly (TmdbSeason | null)[]): Episode[] {
  const out: Episode[] = [];
  for (const season of seasons) {
    for (const ep of season?.episodes ?? []) {
      const seasonNumber = ep.season_number ?? season?.season_number;
      if (seasonNumber == null || ep.episode_number == null) continue;
      const name = ep.name?.trim();
      out.push({
        season: seasonNumber,
        episode: ep.episode_number,
        // A bare YYYY-MM-DD. `hasTimeComponent` is what keeps this from being
        // mistaken for a real broadcast time.
        airDate: ep.air_date || null,
        title: name && !/^Episode\s+\d+$/i.test(name) ? name : null,
        runtime: ep.runtime ?? null,
      });
    }
  }
  return out;
}

/** Season numbers worth fetching: everything TMDB lists except specials. */
export function regularSeasonNumbers(show: TmdbShow | null | undefined): number[] {
  return (show?.seasons ?? [])
    .map((s) => s.season_number)
    .filter((n): n is number => n != null && n !== 0);
}

export function tmdbSeriesEnded(show: TmdbShow | null | undefined): boolean {
  return show?.status != null && ENDED_STATUSES.has(show.status);
}

export function tmdbSearchResultToSummary(result: TmdbSearchResult): {
  title: string;
  year: string;
  posterUrl: string | null;
  ids: { tmdb: number };
} {
  return {
    title: result.name || result.original_name || "Unknown",
    year: (result.first_air_date ?? "").slice(0, 4),
    posterUrl: result.poster_path ? TMDB_IMAGE_BASES.poster + result.poster_path : null,
    ids: { tmdb: result.id },
  };
}
