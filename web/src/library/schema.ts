/**
 * The library: your list and your watch history, owned locally.
 *
 * This is the data SIMKL used to hold. Everything else the app shows -
 * artwork, ratings, air dates, runtimes, cast - is public metadata that
 * TMDB/TVmaze/OMDb can always supply again. What is in here cannot be
 * re-fetched from anywhere, so it is the only thing that gets backed up.
 */

import type { ShowStatus, WatchedMap } from "../domain/types";

/** The schema version, so a future shape change can migrate old backups. */
export const LIBRARY_VERSION = 1;

export type ShowIds = {
  tmdb?: number | undefined;
  imdb?: string | undefined;
  tvdb?: number | undefined;
  tvmaze?: number | undefined;
  /** Kept only so a migrated row can be traced back to its SIMKL origin. */
  simkl?: number | undefined;
};

/**
 * A show's key in the library.
 *
 * TMDB is the preferred key because it is what the metadata layer is driven
 * by, but a row must survive having no TMDB id at all - SIMKL search results
 * sometimes carried none - so the key falls back through the other sources
 * rather than dropping the show. See `showKey`.
 */
export type ShowKey = string;

export type LibraryShow = {
  key: ShowKey;
  ids: ShowIds;
  title: string;
  year?: number | undefined;
  status: ShowStatus;
  /** season -> episode -> ISO timestamp of when it was watched. */
  watched: WatchedMap;
  /**
   * Episodes you entered by hand because neither TVmaze nor TMDB lists them
   * yet. SIMKL (via TheTVDB) occasionally knew about a brand-new episode
   * first; this is the escape hatch that replaces that, and it is merged into
   * the episode list before progress is computed.
   */
  manualEpisodes?: Array<{ season: number; episode: number; airDate: string | null; title: string | null }> | undefined;
  /**
   * A poster or backdrop the user picked by clicking through the alternates.
   *
   * In the library rather than in settings, because it is a choice that cannot
   * be re-derived from anywhere - and because the old app kept it in
   * localStorage alongside the API response cache, where a QuotaExceededError
   * from that cache filling up silently stopped picks from saving at all. The
   * card would play the whole flip animation and then show the same image
   * (app.js:866-889). Storage this shares a budget with nothing.
   */
  images?: { posterPath?: string | undefined; bannerPath?: string | undefined } | undefined;
  /**
   * The last derived progress for this show, CACHED.
   *
   * Not a second source of truth, and nothing computes anything from it: it is
   * overwritten by the real derivation every time a show's data loads, and its only
   * job is to let a list be built without the network. That distinction matters,
   * because storing pre-computed counts and then trusting them is exactly what made
   * SIMKL's numbers contradict its own episode lists.
   *
   * My List needs it. The old app listed a watching show only when SIMKL said it had
   * a next episode (app.js:1157) - a show you are caught up on does not belong
   * there - and answering that for a hundred shows means loading a hundred shows.
   */
  summary?:
    | {
        /**
         * Aired episodes AFTER the furthest one watched - `remainingAfterFurthest`,
         * not `remaining`. This is list membership, not a badge: see the note there
         * for why holes behind your furthest watch must not put a show on My List.
         */
        remaining: number;
        /** The next unwatched episode's air date, for ordering. */
        nextAirDate: string | null;
        checkedAt: string;
      }
    | undefined;
  addedAt: string;
  /** Last local change. Drives last-writer-wins when merging a backup. */
  updatedAt: string;
};

export type Library = {
  version: number;
  /** Last successful sync to the backup, ISO. Null if never synced. */
  syncedAt: string | null;
  shows: Record<ShowKey, LibraryShow>;
};

/** What adding a show needs. Shared so the store and the backends cannot drift. */
export type AddShowInput = {
  ids: ShowIds;
  title: string;
  year?: number | undefined;
  status: ShowStatus;
};

export function emptyLibrary(): Library {
  return { version: LIBRARY_VERSION, syncedAt: null, shows: {} };
}

/**
 * Stable key for a show, in descending order of preference.
 *
 * The prefix matters: a bare number could collide across id spaces, and a
 * show that later gains a TMDB id must not silently become a second row.
 * `remapKey` handles that case explicitly.
 */
export function showKey(ids: ShowIds): ShowKey | null {
  if (ids.tmdb != null) return `tmdb:${ids.tmdb}`;
  if (ids.imdb) return `imdb:${ids.imdb}`;
  if (ids.tvmaze != null) return `tvmaze:${ids.tvmaze}`;
  if (ids.tvdb != null) return `tvdb:${ids.tvdb}`;
  if (ids.simkl != null) return `simkl:${ids.simkl}`;
  return null;
}

/** True when two id sets plausibly describe the same show (app.js:1625-1630). */
export function idsMatch(a: ShowIds | null | undefined, b: ShowIds | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.tmdb != null && b.tmdb != null) return a.tmdb === b.tmdb;
  if (a.imdb && b.imdb) return a.imdb === b.imdb;
  if (a.tvmaze != null && b.tvmaze != null) return a.tvmaze === b.tvmaze;
  if (a.tvdb != null && b.tvdb != null) return a.tvdb === b.tvdb;
  if (a.simkl != null && b.simkl != null) return a.simkl === b.simkl;
  return false;
}

/** Merges two watch maps, keeping the EARLIEST timestamp for each episode.
 *
 * Union rather than overwrite, deliberately: a watch is a fact that happened,
 * and two devices disagreeing about when should never un-watch an episode.
 * The earliest wins because that is when you actually saw it - a later sync
 * re-recording the same episode is an artifact, not a second viewing.
 */
export function mergeWatched(a: WatchedMap, b: WatchedMap): WatchedMap {
  const out: Record<number, Record<number, string>> = {};
  for (const source of [a, b]) {
    for (const [seasonKey, episodes] of Object.entries(source)) {
      const season = Number(seasonKey);
      out[season] ??= {};
      for (const [episodeKey, watchedAt] of Object.entries(episodes)) {
        const episode = Number(episodeKey);
        const existing = out[season][episode];
        if (existing == null || watchedAt < existing) out[season][episode] = watchedAt;
      }
    }
  }
  return out;
}
