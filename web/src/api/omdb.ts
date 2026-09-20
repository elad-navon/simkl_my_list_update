/**
 * OMDb, for the IMDb rating.
 *
 * SIMKL's `/tv/{id}` carried a real IMDb rating (app.js:658) and TMDB has no
 * equivalent - its `vote_average` is TMDB's own user score, a different number
 * from a different population, so showing it under an IMDb label would be a
 * quiet lie. OMDb returns the actual `imdbRating`, keyed by IMDb id, on a free
 * 1,000-requests-a-day tier.
 *
 * Optional by design: no key means no rating badge, and nothing else changes.
 * That is why `getRating` resolves to null on a missing key rather than
 * throwing - a user who never sets one should not see errors for it.
 */

import { getJson } from "./http";

export const OMDB_BASE = "https://www.omdbapi.com/";
const SERVICE = "OMDb";

/**
 * OMDb answers HTTP 200 with `{Response:"False", Error:"..."}` for a title it
 * does not have, so the body has to be inspected - a bare `res.ok` check would
 * read a miss as a hit.
 */
type OmdbResponse = {
  Response?: string;
  Error?: string;
  imdbRating?: string;
  imdbVotes?: string;
};

export type OmdbRating = {
  /** 0-10, one decimal, as IMDb shows it. */
  rating: number;
  /** Vote count, when OMDb reports one. */
  votes: number | null;
};

export type OmdbClient = {
  getRating: (imdbId: string | null | undefined, signal?: AbortSignal) => Promise<OmdbRating | null>;
};

/** "1,234,567" -> 1234567. OMDb sends votes with thousands separators. */
export function parseVotes(votes: string | null | undefined): number | null {
  if (!votes) return null;
  const n = Number(votes.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "8.6" -> 8.6, and OMDb's literal "N/A" -> null. */
export function parseRating(rating: string | null | undefined): number | null {
  if (!rating || rating === "N/A") return null;
  const n = Number(rating);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function createOmdbClient(options: {
  apiKey: string | null | undefined;
  fetchImpl?: typeof fetch | undefined;
}): OmdbClient {
  return {
    async getRating(imdbId, signal) {
      if (!options.apiKey || !imdbId) return null;

      const data = await getJson<OmdbResponse>(OMDB_BASE, {
        service: SERVICE,
        params: { i: imdbId, apikey: options.apiKey },
        ...(signal ? { signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });

      if (!data || data.Response === "False") return null;
      const rating = parseRating(data.imdbRating);
      if (rating == null) return null;
      return { rating, votes: parseVotes(data.imdbVotes) };
    },
  };
}
