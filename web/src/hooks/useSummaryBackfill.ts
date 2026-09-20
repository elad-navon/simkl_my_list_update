/**
 * Keeping the cached progress summaries current.
 *
 * My List shows watching shows that have something left, and it reads a cached
 * per-show summary to decide - because computing it live means loading a hundred
 * shows before the list can be drawn. Two things follow from that, and both are
 * failures this file exists to prevent.
 *
 * A summary can be MISSING. A summary is written when a show's data loads, a card
 * only loads when it is scrolled to, and a show that is not on the list is never on
 * screen to be scrolled to. Without a pass like this, a library whose summaries were
 * never seeded shows every watching show forever.
 *
 * And a summary goes STALE, which is the subtler one. A show joins My List the
 * moment an episode airs, so a snapshot is wrong from then on. The summary seeded
 * from SIMKL's export was a snapshot taken at 00:53; Lioness aired at 03:00 and a
 * summary that is only ever written once would have hidden it indefinitely.
 *
 * Re-deriving is nearly free, which is what makes a short window affordable: the
 * episode list is cached for six hours, and running `computeProgress` over it again
 * with a current clock is pure arithmetic. An episode that aired an hour ago becomes
 * "aired" with no request at all.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiClients } from "../api/clients";
import { computeProgress } from "../domain/progress";
import { useLibrary } from "../library/store";
import type { Library, LibraryShow } from "../library/schema";
import { queryKeys, STALE_TIME } from "../query/client";
import { fetchShowData, type ShowData } from "./useShowData";

/**
 * How old a summary may be before it is re-derived.
 *
 * Shorter than the six hours the episode lists are cached for, deliberately: inside
 * that window a re-derivation costs nothing but arithmetic, so the only thing a
 * longer gap would buy is a show appearing later than it should.
 */
const SUMMARY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type BackfillState = {
  /** How many shows still need checking. Zero means the list has settled. */
  pending: number;
  done: number;
  running: boolean;
};

function needsCheck(library: Library, now: number): LibraryShow[] {
  return Object.values(library.shows).filter((show) => {
    if (show.status !== "watching") return false;
    if (!show.summary) return true;
    const checked = Date.parse(show.summary.checkedAt);
    return Number.isNaN(checked) || now - checked > SUMMARY_MAX_AGE_MS;
  });
}

export function useSummaryBackfill(
  library: Library,
  clients: ApiClients,
  mode: string,
  enabled: boolean,
): BackfillState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<BackfillState>({ pending: 0, done: 0, running: false });

  // One pass at a time. A second would double the requests and race the first to
  // write the same summaries.
  const running = useRef(false);

  // The queue is taken once per pass, and the effect keys on its SIZE rather than
  // on the library - every summary written changes the library, and depending on
  // that would restart the pass on its own first result.
  const queueSize = needsCheck(library, Date.now()).length;

  useEffect(() => {
    if (!enabled || running.current || queueSize === 0) {
      if (queueSize === 0) setState((s) => ({ ...s, pending: 0, running: false }));
      return;
    }

    const queue = needsCheck(useLibrary.getState().library, Date.now());
    if (queue.length === 0) return;

    running.current = true;
    let cancelled = false;
    setState({ pending: queue.length, done: 0, running: true });

    void (async () => {
      let done = 0;
      for (const show of queue) {
        if (cancelled) break;
        try {
          // Through the query client under the card's own key, so a card that
          // appears later finds this already done rather than repeating it - and so
          // a list still fresh in cache costs no requests at all.
          const data = await queryClient.fetchQuery<ShowData>({
            queryKey: queryKeys.showData(show.key, mode),
            staleTime: STALE_TIME.tvmazeEpisodes,
            queryFn: ({ signal }) => fetchShowData(clients, show, signal),
          });

          // Derived HERE rather than relying on the fetch to have done it. When the
          // episode list came from cache the query function never ran, and that is
          // exactly the case this pass exists for: the list is unchanged, the clock
          // has moved, and an episode has aired since it was last looked at.
          const current = useLibrary.getState().library.shows[show.key];
          if (current) {
            const progress = computeProgress(data.episodes, current.watched, {
              seriesEnded: data.loaded.seriesEnded,
            });
            await useLibrary.getState().rememberSummary(show.key, {
              remaining: progress.remaining,
              nextAirDate: progress.nextToWatch?.airDate ?? null,
              checkedAt: new Date().toISOString(),
            });
          }
        } catch {
          // A show whose sources are unreachable keeps the summary it had and is
          // tried again next session. Better than recording a wrong one.
        }
        done += 1;
        if (!cancelled) setState({ pending: queue.length - done, done, running: true });
      }
      if (!cancelled) setState({ pending: 0, done, running: false });
      running.current = false;
    })();

    return () => {
      cancelled = true;
      running.current = false;
    };
  }, [enabled, mode, queryClient, clients, queueSize]);

  return state;
}
