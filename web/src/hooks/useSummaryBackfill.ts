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
 *
 * ## Why the effect does not depend on the queue
 *
 * An earlier version keyed its effect on the SIZE of its own queue. The pass shrinks
 * that queue by design, so every summary it wrote invalidated the effect that was
 * running it: the cleanup cancelled the pass, the effect re-ran, and started another.
 * In a browser, where results arrive from the query cache in microtasks, that cascade
 * ran fast enough to hit React's "Maximum update depth exceeded". The rule that fixes
 * it is general: an effect must never depend on something it changes. So the effect
 * here depends only on things the pass does not touch - and a periodic tick, not a
 * dependency, is what picks up work that appears later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

/** How often an idle pass looks for newly stale summaries. */
const RECHECK_MS = 60 * 1000;

export type BackfillState = {
  /** How many shows still need checking. Zero means the list has settled. */
  pending: number;
  done: number;
  running: boolean;
};

const IDLE: BackfillState = { pending: 0, done: 0, running: false };

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
  const hydrated = useLibrary((s) => s.hydrated);
  const [state, setState] = useState<BackfillState>(IDLE);

  // How many shows there ARE, which changes when one is added, removed or imported
  // and NOT when a summary is written - that distinction is the whole point.
  const showCount = Object.keys(library.shows).length;

  /** Identifies the current pass. Bumping it cancels whichever is running. */
  const pass = useRef(0);
  const active = useRef(false);

  const start = useCallback(() => {
    if (active.current) return;

    const queue = needsCheck(useLibrary.getState().library, Date.now());
    if (queue.length === 0) {
      // The SAME object when already idle, so an idle tick is not a state change and
      // therefore not a render.
      setState((s) => (s.pending === 0 && !s.running ? s : { ...s, pending: 0, running: false }));
      return;
    }

    active.current = true;
    const id = ++pass.current;
    setState({ pending: queue.length, done: 0, running: true });

    void (async () => {
      let done = 0;
      for (const show of queue) {
        if (pass.current !== id) return;
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
              remaining: progress.remainingAfterFurthest,
              nextAirDate: progress.nextToWatch?.airDate ?? null,
              checkedAt: new Date().toISOString(),
            });
          }
        } catch {
          // A show whose sources are unreachable keeps the summary it had and is
          // tried again next session. Better than recording a wrong one.
        }

        done += 1;
        if (pass.current !== id) return;
        setState({ pending: queue.length - done, done, running: true });
      }

      // Only the pass that is still current gets to declare itself finished; a
      // cancelled one must not clear the flag a newer pass is relying on.
      if (pass.current === id) {
        active.current = false;
        setState({ pending: 0, done, running: false });
      }
    })();
  }, [queryClient, clients, mode]);

  useEffect(() => {
    if (!enabled || !hydrated) return;

    start();
    // Work that appears LATER - a summary going stale, a file imported over an
    // already-mounted list - is found by ticking, not by depending on the library.
    const timer = setInterval(start, RECHECK_MS);

    return () => {
      clearInterval(timer);
      pass.current += 1; // cancels a pass still in flight
      active.current = false;
    };
  }, [enabled, hydrated, showCount, start]);

  return state;
}
