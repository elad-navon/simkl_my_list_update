/**
 * Filling in the cached progress summaries that nothing else will.
 *
 * My List shows watching shows that have something left, which needs a summary per
 * show - and a summary is written when a show's data loads. But a card only loads
 * when it is scrolled to, and a show that is not on the list is never on screen to
 * be scrolled to. That is circular: without this, a library whose summaries were
 * never seeded would show every watching show forever.
 *
 * SIMKL seeds them, so this matters most for the independent mode and for a library
 * restored from a file. It runs one show at a time, in the background, sharing the
 * TVmaze limiter with the visible cards - so the cards you are looking at are never
 * waiting on it.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiClients } from "../api/clients";
import type { Library, LibraryShow } from "../library/schema";
import { queryKeys, STALE_TIME } from "../query/client";
import { fetchShowData } from "./useShowData";

export type BackfillState = {
  /** How many shows still need one. Zero means the list is settled. */
  pending: number;
  /** How many have been filled in during this session. */
  done: number;
  running: boolean;
};

/** Shows that would be on My List but cannot be judged yet. */
function needsSummary(library: Library): LibraryShow[] {
  return Object.values(library.shows).filter(
    (show) => show.status === "watching" && show.summary === undefined,
  );
}

export function useSummaryBackfill(
  library: Library,
  clients: ApiClients,
  mode: string,
  enabled: boolean,
): BackfillState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<BackfillState>({ pending: 0, done: 0, running: false });

  // One pass at a time. A second one would double the requests and race the first
  // to write the same summaries.
  const running = useRef(false);

  useEffect(() => {
    if (!enabled || running.current) return;

    const queue = needsSummary(library);
    if (queue.length === 0) {
      setState((s) => ({ ...s, pending: 0, running: false }));
      return;
    }

    running.current = true;
    let cancelled = false;
    setState((s) => ({ ...s, pending: queue.length, running: true }));

    void (async () => {
      let done = 0;
      for (const show of queue) {
        if (cancelled) break;
        try {
          // Through the query client with the card's own key, so a card that
          // appears later finds this already cached rather than fetching again.
          await queryClient.fetchQuery({
            queryKey: queryKeys.showData(show.key, mode),
            staleTime: STALE_TIME.tvmazeEpisodes,
            queryFn: ({ signal }) => fetchShowData(clients, show, signal),
          });
        } catch {
          // A show whose sources are unreachable keeps no summary and will be
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
    // Deliberately keyed on the COUNT rather than on the library: every summary
    // written changes the library, and depending on it would restart the pass on
    // its own first result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, queryClient, clients, needsSummary(library).length === 0]);

  return state;
}
