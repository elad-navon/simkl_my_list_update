/**
 * TVmaze: the replacement for SIMKL's broadcast calendar.
 *
 * This is the source that makes cutting SIMKL loose possible at all. The old
 * app used `/tv/episodes/{simkl_id}` for one property nothing else had: a full
 * ISO timestamp WITH the broadcast timezone's offset, which is what made
 * "Today" and "Tomorrow" agree with simkl.com instead of drifting by a day
 * (app.js:529-535). TMDB gives a bare `YYYY-MM-DD` and nothing more.
 *
 * TVmaze's `airstamp` is exactly that timestamp, it needs no API key, and it
 * sends permissive CORS headers. It also carries a per-episode `runtime`, which
 * SIMKL never did - the old app had to fetch every TMDB season just to price
 * the remaining episodes (app.js:735-747).
 *
 * The catch, and it is the plan's largest named risk: TVmaze's coverage of
 * Israeli shows is thin. Nothing here pretends otherwise - a show TVmaze does
 * not have resolves to null and the caller falls back to TMDB. Run
 * `npm run tvmaze-coverage` against a migrated library to see exactly which
 * shows that is.
 */

import { getJson } from "./http";
import { createRateLimiter, TVMAZE_RATE_LIMIT, type Scheduler } from "./rateLimit";
import type { Episode } from "../domain/types";

export const TVMAZE_BASE = "https://api.tvmaze.com";
const SERVICE = "TVmaze";

export type TvmazeShow = {
  id: number;
  name?: string | null;
  premiered?: string | null;
  status?: string | null;
  externals?: { imdb?: string | null; thetvdb?: number | null; tvrage?: number | null } | null;
};

export type TvmazeEpisode = {
  season?: number | null;
  number?: number | null;
  name?: string | null;
  /** Full ISO datetime with the broadcast timezone's offset. The whole point. */
  airstamp?: string | null;
  airdate?: string | null;
  runtime?: number | null;
  type?: string | null;
};

/** TVmaze's own status strings that mean the show has stopped airing. */
const ENDED_STATUSES = new Set(["Ended", "Canceled", "Cancelled"]);

export type TvmazeClient = {
  /** Finds a show by an id from another source. Null when TVmaze has no match. */
  lookupShow: (ids: { imdb?: string | undefined; tvdb?: number | undefined }, signal?: AbortSignal) => Promise<TvmazeShow | null>;
  getEpisodes: (tvmazeId: number, signal?: AbortSignal) => Promise<TvmazeEpisode[] | null>;
  searchShows: (query: string, signal?: AbortSignal) => Promise<TvmazeShow[]>;
};

export function createTvmazeClient(options: {
  schedule?: Scheduler | undefined;
  fetchImpl?: typeof fetch | undefined;
} = {}): TvmazeClient {
  const schedule = options.schedule ?? createRateLimiter(TVMAZE_RATE_LIMIT);
  const get = <T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    schedule(() =>
      getJson<T>(`${TVMAZE_BASE}${path}`, {
        service: SERVICE,
        params,
        ...(signal ? { signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      }),
    );

  return {
    /**
     * IMDb first, TheTVDB second. IMDb ids are the more stable of the two and
     * the ones SIMKL supplied for essentially every show, so the lookup lands
     * on the first try for most of the library; TheTVDB is the fallback because
     * SIMKL's episode data came from TheTVDB originally, so a show SIMKL knew
     * tends to have a TheTVDB id even when it has no IMDb one.
     */
    async lookupShow(ids, signal) {
      if (ids.imdb) {
        const byImdb = await get<TvmazeShow>("/lookup/shows", { imdb: ids.imdb }, signal);
        if (byImdb) return byImdb;
      }
      if (ids.tvdb != null) {
        return get<TvmazeShow>("/lookup/shows", { thetvdb: ids.tvdb }, signal);
      }
      return null;
    },

    /** `specials=1` so season 0 arrives too; the domain layer filters it. */
    getEpisodes(tvmazeId, signal) {
      return get<TvmazeEpisode[]>(`/shows/${tvmazeId}/episodes`, { specials: 1 }, signal);
    },

    async searchShows(query, signal) {
      const results = await get<Array<{ show?: TvmazeShow }>>("/search/shows", { q: query }, signal);
      return (results ?? []).map((r) => r.show).filter((s): s is TvmazeShow => Boolean(s));
    },
  };
}

// --- normalization ----------------------------------------------------------

/**
 * Turns TVmaze's episode list into the domain shape.
 *
 * `airstamp` is preferred over `airdate` because only the former carries a
 * time-of-day and an offset, which is the distinction `hasTimeComponent` keys
 * the relative "Today"/"Tomorrow" labels off. An episode with no numbering is
 * dropped, same rule as SIMKL's unnumbered specials.
 */
export function normalizeTvmazeEpisodes(
  payload: readonly TvmazeEpisode[] | null | undefined,
): Episode[] {
  if (!Array.isArray(payload)) return [];

  const out: Episode[] = [];
  for (const ep of payload) {
    if (ep.number == null) continue;
    out.push({
      // TVmaze files a special as season null with a number, so it lands in
      // season 0 - where the domain layer already knows to exclude it.
      season: ep.season ?? 0,
      episode: ep.number,
      airDate: ep.airstamp ?? ep.airdate ?? null,
      title: ep.name?.trim() || null,
      runtime: ep.runtime ?? null,
    });
  }
  return out;
}

/** Whether TVmaze considers the show finished, for `computeProgress`. */
export function tvmazeSeriesEnded(show: TvmazeShow | null | undefined): boolean {
  return show?.status != null && ENDED_STATUSES.has(show.status);
}
