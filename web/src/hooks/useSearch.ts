/**
 * Searching, debounced, against whichever services are available.
 *
 * TMDB always, SIMKL as well when it is authorized. Both, rather than one, for
 * the reason the old app found: SIMKL's search handles Hebrew badly, which is
 * exactly why TMDB's was added alongside it rather than instead of it
 * (app.js:1578-1583). Running both is still the right answer even in local mode,
 * because a SIMKL result carries more ids and more ids means more ways to find a
 * show's episodes later.
 *
 * Results are matched against the library here too, which is where five network
 * requests per query used to go (`findShowLibraryStatus`, app.js:1633).
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiClients } from "../api/clients";
import { simklSearchResultToSummary } from "../api/simkl";
import { tmdbSearchResultToSummary } from "../api/tmdb";
import {
  matchAgainstLibrary,
  mergeSearchResults,
  type MatchedSearchResult,
  type SearchResult,
} from "../domain/search";
import type { Library } from "../library/schema";
import { queryKeys, STALE_TIME } from "../query/client";

const DEBOUNCE_MS = 300;
const MIN_LENGTH = 2;

/** Holds back a query until typing pauses. */
function useDebounced(value: string, delayMs = DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export type SearchState = {
  results: MatchedSearchResult[];
  /** True while a query is in flight, including the debounce. */
  searching: boolean;
  /** Set when every available source failed. */
  error: string | null;
  /** True once a search has run and come back with nothing. */
  empty: boolean;
};

export function useSearch(query: string, clients: ApiClients, library: Library): SearchState {
  const debounced = useDebounced(query).trim();
  const enabled = debounced.length >= MIN_LENGTH;

  const search = useQuery({
    queryKey: queryKeys.tmdb.search(debounced),
    enabled,
    staleTime: STALE_TIME.search,
    queryFn: async ({ signal }) => {
      // Settled rather than all: one source being down is a thinner result list,
      // not a failed search.
      const [simkl, tmdb] = await Promise.allSettled([
        clients.simkl?.searchShows(debounced, signal) ?? Promise.resolve([]),
        clients.tmdb?.searchShows(debounced, signal) ?? Promise.resolve([]),
      ]);

      const simklResults: SearchResult[] =
        simkl.status === "fulfilled"
          ? simkl.value.map((r) => ({ ...simklSearchResultToSummary(r), source: "simkl" as const }))
          : [];

      const tmdbResults: SearchResult[] =
        tmdb.status === "fulfilled"
          ? tmdb.value.map((r) => ({ ...tmdbSearchResultToSummary(r), source: "tmdb" as const }))
          : [];

      if (simkl.status === "rejected" && tmdb.status === "rejected") {
        throw tmdb.reason instanceof Error ? tmdb.reason : new Error(String(tmdb.reason));
      }

      return mergeSearchResults(simklResults, tmdbResults);
    },
  });

  // Matched here rather than in the query, so adding a show updates the badges
  // immediately instead of waiting for the search to be refetched.
  const results = useMemo(
    () => matchAgainstLibrary(search.data ?? [], library),
    [search.data, library],
  );

  return {
    results,
    searching: enabled && (search.isFetching || debounced !== query.trim()),
    error: search.error ? search.error.message : null,
    empty: enabled && search.isSuccess && results.length === 0,
  };
}
