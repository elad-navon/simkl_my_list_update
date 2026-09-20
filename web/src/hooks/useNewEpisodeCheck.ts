/**
 * Watching for new episodes, and telling you about them.
 *
 * The snapshot lives in localStorage so a tab closed for a week still notices
 * what aired while it was gone - the same reason the old version persisted it
 * (app.js:3324-3338). It is a handful of numbers, so it belongs there rather than
 * with the library, and losing it costs one silent seeding round, not data.
 *
 * Notifications are asked for rather than assumed. A permission prompt on load is
 * the sort of thing that gets denied on reflex, so the ask happens on a click in
 * settings and, until then, new episodes appear as a banner in the page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkForNewEpisodes,
  describeNewEpisode,
  type EpisodeSnapshot,
  type NewEpisode,
} from "../domain/newEpisodes";
import type { Episode } from "../domain/types";

const SNAPSHOT_KEY = "tv_latest_episode_snapshot";

function readSnapshot(): EpisodeSnapshot {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null) return {};
    // Anything non-numeric is dropped rather than compared, since a bad entry
    // would otherwise either announce forever or never.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return {};
  }
}

function writeSnapshot(snapshot: EpisodeSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // Full or unavailable. The cost is one silent seeding round next time.
  }
}

export type NewEpisodeState = {
  /** Shows that have aired something since the last check. */
  fresh: NewEpisode[];
  /** Whether the browser will show a system notification. */
  canNotify: boolean;
  requestPermission: () => Promise<void>;
  /** Runs a check over the shows given, and records the result. */
  check: (shows: ReadonlyArray<{ key: string; title: string; latestAired: Episode | null }>) => void;
  dismiss: () => void;
};

export function useNewEpisodeCheck(): NewEpisodeState {
  const [fresh, setFresh] = useState<NewEpisode[]>([]);
  const [canNotify, setCanNotify] = useState(
    () => typeof Notification !== "undefined" && Notification.permission === "granted",
  );

  const check = useCallback(
    (shows: ReadonlyArray<{ key: string; title: string; latestAired: Episode | null }>) => {
      if (shows.length === 0) return;

      const result = checkForNewEpisodes(shows, readSnapshot());
      writeSnapshot(result.snapshot);
      if (result.fresh.length === 0) return;

      setFresh((current) => {
        // Merged rather than replaced: a second check while the banner is still up
        // should add to it, not wipe what has not been read yet.
        const seen = new Set(current.map((entry) => entry.key));
        const added = result.fresh.filter((entry) => !seen.has(entry.key));
        // The SAME array when nothing was added. Returning a fresh one with equal
        // contents is still a state change, which re-renders, which re-runs the
        // effect that called this - an infinite loop rather than a wasted render.
        return added.length === 0 ? current : [...current, ...added];
      });

      if (canNotify) {
        for (const entry of result.fresh) {
          try {
            new Notification(entry.title, { body: describeNewEpisode(entry), tag: entry.key });
          } catch {
            // Some browsers refuse a constructed Notification outside a service
            // worker. The banner has already been set either way.
          }
        }
      }
    },
    [canNotify],
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setCanNotify(result === "granted");
  }, []);

  // Kept in step with a permission changed in browser settings rather than here.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setCanNotify(Notification.permission === "granted");
  }, []);

  const dismiss = useCallback(() => setFresh([]), []);

  // Memoized as a whole, because an effect that watches this will run on every
  // render otherwise - and the effect that drives the check is exactly that.
  return useMemo(
    () => ({ fresh, canNotify, requestPermission, check, dismiss }),
    [fresh, canNotify, requestPermission, check, dismiss],
  );
}
