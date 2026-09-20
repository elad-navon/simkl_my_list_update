/**
 * The API response cache.
 *
 * This is what replaces roughly 180 lines of hand-rolled caching: an in-memory
 * promise map per endpoint to deduplicate concurrent requests, plus a
 * localStorage mirror with a TTL per endpoint, plus `prunePersistedCache` to
 * sweep expired entries because reads ignored them without ever deleting them -
 * which is how the origin's whole quota filled up and started breaking unrelated
 * writes (app.js:349-527).
 *
 * The TTLs themselves are kept. They were tuned against how fast each kind of
 * data actually changes, and that has not changed just because the mechanism
 * has. What is new is that expiry is now the cache's job rather than something
 * every call site remembers to ask about.
 *
 * Storage moves to IndexedDB, so the API cache no longer shares a budget with
 * anything that matters. The library is not in here at all - it has its own
 * store, because a cache is allowed to be evicted and watch history is not.
 */

import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { del, get, set } from "idb-keyval";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long a response is served without asking again. Unchanged from
 * app.js:340-347, with the two new sources slotted in by the same reasoning.
 */
export const STALE_TIME = {
  /** Artwork, genres, network, rating. Changes slowly. */
  tmdbShow: DAY,
  /** Per-episode runtimes and titles; a season gains episodes mid-run. */
  tmdbSeason: 6 * HOUR,
  /** An episode's IMDb id never changes. */
  tmdbEpisodeIds: 7 * DAY,
  tmdbCredits: DAY,
  /** A person's IMDb id never changes either. */
  tmdbPersonIds: 7 * DAY,
  /** SIMKL's episode list, which is also its air-date calendar. */
  simklEpisodes: 6 * HOUR,
  simklShow: DAY,
  /**
   * TVmaze's show lookup resolves an id, which is stable - and every avoided
   * lookup is one fewer request against a rate limit with no key behind it.
   */
  tvmazeLookup: 7 * DAY,
  /** TVmaze's episode list, the primary air-date source. */
  tvmazeEpisodes: 6 * HOUR,
  /** An IMDb rating moves slowly and is cosmetic; a day is generous. */
  omdbRating: DAY,
  /** Search results are per-keystroke and worth almost nothing after the fact. */
  search: 5 * MINUTE,
} as const;

/**
 * How long an unused response is kept before eviction, and how old a restored
 * one may be. Seven days covers the longest TTL above, which is exactly the
 * horizon the old sweep used (app.js:426).
 */
const GC_TIME = 7 * DAY;

const PERSIST_KEY = "query-cache";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: GC_TIME,
        // Metadata does not change while you look at it, and the old app never
        // refetched on focus either. What it DID do was check for a new service
        // worker on visibilitychange, which is a different thing and stays.
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        // A failed metadata fetch degrades a card; it does not break the page.
        // Two quick retries, then leave it alone rather than hammering.
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
    },
  });
}

/**
 * Persists the cache to IndexedDB, so a reload skips the network for anything
 * still fresh instead of re-fetching every show from scratch.
 *
 * Failures are swallowed on purpose: a cache that cannot be written is a slower
 * app, not a broken one, and IndexedDB is unavailable outright in some private
 * browsing modes.
 */
export function createCachePersister() {
  return createAsyncStoragePersister({
    storage: {
      getItem: async (key) => {
        try {
          return (await get<string>(key)) ?? null;
        } catch {
          return null;
        }
      },
      setItem: async (key, value) => {
        try {
          await set(key, value);
        } catch {
          // Out of space or storage disabled. This session still has its
          // in-memory cache; only the reload shortcut is lost.
        }
      },
      removeItem: async (key) => {
        try {
          await del(key);
        } catch {
          // Nothing to do about it, and nothing depends on it.
        }
      },
    },
    key: PERSIST_KEY,
    // Every resolved query dirties the cache, and a write serializes the WHOLE
    // cache. With a hundred shows loading one after another, a two-second
    // throttle meant near-continuous JSON.stringify over megabytes on the main
    // thread - the page crawled while the requests themselves were fine. Ten
    // seconds costs nothing: the point of persisting is the next load, not this
    // one.
    throttleTime: 10_000,
  });
}

export const PERSIST_MAX_AGE = GC_TIME;

/**
 * Query keys, in one place.
 *
 * Every key starts with its service, so the whole of one source can be
 * invalidated at once - which is what switching data source has to do, and what
 * changing an API key has to do.
 */
export const queryKeys = {
  tmdb: {
    all: ["tmdb"] as const,
    show: (id: number) => ["tmdb", "show", id] as const,
    season: (id: number, season: number) => ["tmdb", "season", id, season] as const,
    episodeIds: (id: number, season: number, episode: number) =>
      ["tmdb", "episodeIds", id, season, episode] as const,
    credits: (id: number) => ["tmdb", "credits", id] as const,
    personIds: (id: number) => ["tmdb", "personIds", id] as const,
    search: (query: string) => ["tmdb", "search", query] as const,
  },
  tvmaze: {
    all: ["tvmaze"] as const,
    lookup: (ids: { imdb?: string | undefined; tvdb?: number | undefined }) =>
      ["tvmaze", "lookup", ids.imdb ?? null, ids.tvdb ?? null] as const,
    episodes: (id: number) => ["tvmaze", "episodes", id] as const,
    search: (query: string) => ["tvmaze", "search", query] as const,
  },
  omdb: {
    all: ["omdb"] as const,
    rating: (imdbId: string) => ["omdb", "rating", imdbId] as const,
  },
  simkl: {
    all: ["simkl"] as const,
    episodes: (id: number) => ["simkl", "episodes", id] as const,
    show: (id: number) => ["simkl", "show", id] as const,
    search: (query: string) => ["simkl", "search", query] as const,
  },
  /** One show's assembled episode list and progress, across whichever sources. */
  showData: (key: string, mode: string) => ["showData", mode, key] as const,
} as const;
