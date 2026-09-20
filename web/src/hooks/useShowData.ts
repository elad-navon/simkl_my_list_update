/**
 * Everything one show's card needs, assembled from whichever sources are on.
 *
 * The fetch, the merge and the derivation happen here so that components take
 * finished values. That is the split the old app never had: `buildRows` fetched,
 * counted, priced and formatted in one 170-line pass (app.js:679-852), which is
 * why none of it could be tested.
 *
 * The episode list comes from `loadEpisodes` - TVmaze and TMDB, plus SIMKL's own
 * list when SIMKL is the active source, since its air dates are the ones the old
 * app's "Today"/"Tomorrow" labels agreed with. Progress is then derived from that
 * one list, never read off any source's aggregate fields, which is what keeps the
 * two modes honest against each other.
 */

import { useQuery } from "@tanstack/react-query";
import { loadEpisodes, type LoadedEpisodes } from "../api/episodeSources";
import { normalizeSimklApiEpisodes, type SimklClient } from "../api/simkl";
import { mergeEpisodes } from "../domain/episodes";
import { computeProgress, type Progress } from "../domain/progress";
import { averageEpisodeRuntime, estimateRemainingTime, type RemainingTime } from "../domain/runtime";
import { buildSeasonView, type SeasonView } from "../domain/seasonView";
import type { Episode } from "../domain/types";
import type { LibraryShow } from "../library/schema";
import { useLibrary } from "../library/store";
import { queryKeys, STALE_TIME } from "../query/client";
import type { ApiClients } from "../api/clients";

export type ShowData = {
  episodes: Episode[];
  progress: Progress;
  /** Priced remaining episodes, for the "3h 23m left" line and its modal. */
  remainingTime: RemainingTime;
  /** Seasons and episodes with their own state, for the episode browser. */
  seasonView: SeasonView;
  /** Which sources answered, so a thin-looking show can explain itself. */
  sources: LoadedEpisodes["sources"] & { simkl: boolean };
  loaded: LoadedEpisodes;
};

/**
 * SIMKL's episode list, fetched only when SIMKL is the active source.
 *
 * In local mode it is not consulted at all - that is what independence means -
 * and TVmaze carries the air times instead, at 99.9% coverage on this library.
 */
async function loadSimklEpisodes(
  simkl: SimklClient | null,
  simklId: number | undefined,
  signal?: AbortSignal,
): Promise<Episode[]> {
  if (!simkl || simklId == null) return [];
  try {
    return normalizeSimklApiEpisodes(await simkl.getEpisodes(simklId, signal));
  } catch {
    // One missing episode list degrades a show's dates; it does not fail it.
    return [];
  }
}

export function buildShowData(
  loaded: LoadedEpisodes,
  simklEpisodes: readonly Episode[],
  show: Pick<LibraryShow, "watched">,
  now: number = Date.now(),
): ShowData {
  // SIMKL goes in as the primary when it answered, because its dates carry a
  // real broadcast time with an offset - the one thing it was ever kept for.
  // `mergeEpisodes` prefers the more precise date regardless of rank, so this
  // only decides ties.
  const episodes = simklEpisodes.length
    ? mergeEpisodes({ primary: simklEpisodes, fallback: loaded.episodes })
    : loaded.episodes;

  const progress = computeProgress(episodes, show.watched, {
    now,
    seriesEnded: loaded.seriesEnded,
  });

  const avgRuntime = averageEpisodeRuntime(loaded.tmdbShow, null);

  return {
    episodes,
    progress,
    remainingTime: estimateRemainingTime(progress.remainingEpisodes, avgRuntime),
    seasonView: buildSeasonView(episodes, show.watched, now),
    sources: { ...loaded.sources, simkl: simklEpisodes.length > 0 },
    loaded,
  };
}

/**
 * @param enabled False holds the query back entirely, which is how a carousel of
 *   a hundred cards avoids firing a hundred paced TVmaze requests before anything
 *   on screen can resolve. See `useInView`.
 */
/**
 * Runs a cache write, and never lets it fail the load it rode in on.
 *
 * What gets written here - resolved ids, the progress summary - is an optimisation:
 * losing it costs one repeated lookup later. It must not cost the card it was being
 * recorded for. A store that is missing a method, a rejected IndexedDB write, a
 * quota error: none of them are a reason for the user to see "Could not load" over
 * data that was fetched perfectly well.
 *
 * (This is not hypothetical. A stale dev server once served a store without
 * `rememberSummary`, and every card on the page reported that instead of showing.)
 */
export function bestEffort(write: () => unknown): void {
  try {
    const result = write();
    if (result instanceof Promise) result.catch(() => undefined);
  } catch {
    // Deliberately silent: see above.
  }
}

/**
 * Fetches and assembles one show, and records what it found.
 *
 * Extracted from the hook so the background summary pass can use the very same
 * function under the very same query key - two code paths fetching the same show
 * into two cache entries would double every request.
 */
export async function fetchShowData(
  clients: ApiClients,
  show: LibraryShow,
  signal?: AbortSignal,
): Promise<ShowData> {
  const [loaded, simklEpisodes] = await Promise.all([
    loadEpisodes(
      { tvmaze: clients.tvmaze, tmdb: clients.tmdb },
      {
        ids: show.ids,
        watched: show.watched,
        ...(show.manualEpisodes
          ? { manualEpisodes: show.manualEpisodes.map((ep) => ({ ...ep, runtime: null })) }
          : {}),
      },
      signal,
    ),
    loadSimklEpisodes(clients.simkl, show.ids.simkl, signal),
  ]);

  // Caching the ids a lookup resolved is what stops the next load repeating a
  // hundred rate-limited TVmaze lookups. `rememberIds` only fills blanks, so this
  // cannot overwrite anything the library already knew.
  bestEffort(() =>
    useLibrary.getState().rememberIds(show.key, {
      ...(loaded.resolved.tvmaze !== null ? { tvmaze: loaded.resolved.tvmaze } : {}),
      ...(loaded.resolved.imdb !== null ? { imdb: loaded.resolved.imdb } : {}),
    }),
  );

  const data = buildShowData(loaded, simklEpisodes, show);

  // What lets the NEXT list be built without loading a hundred shows to find out
  // which ten of them have anything left to watch.
  bestEffort(() =>
    useLibrary.getState().rememberSummary(show.key, {
      remaining: data.progress.remainingAfterFurthest,
      nextAirDate: data.progress.nextToWatch?.airDate ?? null,
      checkedAt: new Date().toISOString(),
    }),
  );

  return data;
}

export function useShowData(
  show: LibraryShow | null,
  clients: ApiClients,
  mode: string,
  enabled = true,
): ReturnType<typeof useQuery<ShowData | null>> {
  return useQuery<ShowData | null>({
    queryKey: queryKeys.showData(show?.key ?? "none", mode),
    enabled: show !== null && enabled,
    // The shortest of the underlying TTLs, since this is derived from all of
    // them and must not outlive the freshest thing it depends on.
    staleTime: STALE_TIME.tvmazeEpisodes,
    queryFn: ({ signal }) => (show ? fetchShowData(clients, show, signal) : null),
  });
}
