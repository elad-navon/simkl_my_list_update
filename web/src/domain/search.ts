/**
 * Search results, merged and matched against the library.
 *
 * Two pure jobs, both of which the old app did in the middle of its network code.
 *
 * Merging: TMDB and SIMKL both answer, and the same show comes back from both.
 * Ported from `mergeSearchResults` (app.js:1602-1610).
 *
 * Matching: "is this already on my list" used to be FIVE network requests -
 * `findShowLibraryStatus` fetched all five SIMKL lists per query and searched
 * them (app.js:1633-1649). With the library local it is a lookup, which is the
 * single clearest example of what owning your own data buys.
 */

import { idsMatch, type Library, type LibraryShow, type ShowIds } from "../library/schema";
import type { ShowStatus } from "./types";

export type SearchResult = {
  title: string;
  /** A year string, because that is what both sources give and all it is for. */
  year: string;
  posterUrl: string | null;
  ids: ShowIds;
  /** Which service answered, for the "no results" message to be specific. */
  source: "tmdb" | "simkl";
};

export type MatchedSearchResult = SearchResult & {
  /** The status this show already has, or null if it is not on the list. */
  libraryStatus: ShowStatus | null;
  /** The library row, when there is one - so the UI can act on it directly. */
  libraryKey: string | null;
};

/**
 * Combines both sources, dropping a duplicate rather than showing a show twice.
 *
 * SIMKL's results come first and win a tie, because they carry the richer id set -
 * a SIMKL result has simkl, tmdb and imdb ids where a TMDB one has only tmdb, and
 * more ids means more ways to find the show's episodes later.
 *
 * Both lists arrive in their own relevance order, so they are concatenated rather
 * than re-ranked: inventing a combined ranking would mean guessing at two
 * services' relevance scores from the outside.
 */
export function mergeSearchResults(
  simklResults: readonly SearchResult[],
  tmdbResults: readonly SearchResult[],
): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];

  for (const result of [...simklResults, ...tmdbResults]) {
    // Deduplicated on TMDB id, which is the one both sources share.
    const key = result.ids.tmdb != null ? `tmdb:${result.ids.tmdb}` : null;
    if (key !== null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(result);
  }
  return out;
}

/**
 * Annotates each result with the status it already has in the library.
 *
 * Matching is by ids rather than by title, so "The Office" the American one and
 * "The Office" the British one are not confused - and a show added from a
 * TMDB-only result still matches its SIMKL-imported row through its TMDB id.
 */
export function matchAgainstLibrary(
  results: readonly SearchResult[],
  library: Library,
): MatchedSearchResult[] {
  const rows = Object.values(library.shows);

  return results.map((result) => {
    const match: LibraryShow | undefined = rows.find((row) => idsMatch(row.ids, result.ids));
    return {
      ...result,
      libraryStatus: match?.status ?? null,
      libraryKey: match?.key ?? null,
    };
  });
}

/** The status options the add menu offers, in the order the old app used. */
export const STATUS_OPTIONS: ReadonlyArray<{ value: ShowStatus; label: string }> = [
  { value: "plantowatch", label: "Plan to Watch" },
  { value: "watching", label: "Watching" },
  { value: "hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "dropped", label: "Dropped" },
] as const;

export function statusLabel(status: ShowStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}
