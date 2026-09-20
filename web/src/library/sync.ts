/**
 * Keeping the library and the Gist in step.
 *
 * Pull on startup, push after changes settle. The pull is what makes this sync
 * between devices rather than only a backup, and the push is debounced because
 * marking a season watched is twenty state changes in ten seconds and none of
 * them individually is worth a round trip.
 *
 * Two rules that matter more than the mechanics:
 *
 * - A pull never replaces; it merges (see `merge.ts`). Replacing would mean the
 *   phone's offline evening is lost the moment the desktop syncs.
 * - A backup that cannot be parsed is not treated as an empty backup. Writing
 *   over it with the local library would destroy the only copy of whatever was
 *   in there, so the sync stops and says so instead.
 */

import type { GistClient } from "../api/gist";
import { mergeLibraries, type MergeStats } from "./merge";
import { parseLibraryFile } from "./importFile";
import type { Library } from "./schema";

export type PullOutcome =
  | { kind: "merged"; library: Library; stats: MergeStats }
  /** No gist yet. The caller creates one from the local library. */
  | { kind: "absent" }
  /**
   * The gist exists but its contents are not a library. Deliberately NOT
   * "absent": pushing over it would destroy the only copy of whatever is there.
   */
  | { kind: "unreadable"; reason: string };

export async function pullFromGist(
  gist: GistClient,
  gistId: string,
  local: Library,
  now: string = new Date().toISOString(),
): Promise<PullOutcome> {
  const snapshot = await gist.read(gistId);
  if (!snapshot) return { kind: "absent" };

  const parsed = parseLibraryFile(snapshot.content);
  if (!parsed.ok) return { kind: "unreadable", reason: parsed.error };

  const { library, stats } = mergeLibraries(local, parsed.library, now);
  return { kind: "merged", library, stats };
}

export type PushResult = { gistId: string; updatedAt: string | null; created: boolean };

/**
 * Writes the library up, creating the gist on the first push.
 *
 * `syncedAt` is written into the pushed copy as well as kept locally, so a device
 * restoring from this file inherits a sync point and can tell a deletion from an
 * addition on its very first merge.
 */
export async function pushToGist(
  gist: GistClient,
  gistId: string | null,
  library: Library,
  now: string = new Date().toISOString(),
): Promise<PushResult> {
  const payload = JSON.stringify({ ...library, syncedAt: now }, null, 2);

  if (!gistId) {
    const created = await gist.create(payload);
    return { gistId: created.gistId, updatedAt: now, created: true };
  }

  const updated = await gist.update(gistId, payload);
  return { gistId, updatedAt: updated.updatedAt ?? now, created: false };
}

/**
 * Wraps a push so a burst of changes becomes one request.
 *
 * `flush` exists for the case that actually loses data: the tab closing while a
 * debounce is still pending. Whoever owns this is expected to call it on
 * `visibilitychange`, which is also where the old app checked for a new service
 * worker (app.js:3613-3626).
 */
export function createDebouncedPush(
  push: (library: Library) => Promise<void>,
  delayMs = 4000,
): {
  schedule: (library: Library) => void;
  flush: () => Promise<void>;
  cancel: () => void;
  pending: () => boolean;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: Library | null = null;

  const run = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const library = queued;
    queued = null;
    if (library) await push(library);
  };

  return {
    schedule: (library) => {
      // Only the latest state is ever sent: an intermediate one is not a version
      // anybody wants restored, and the gist's history would fill up with them.
      queued = library;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    flush: run,
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      queued = null;
    },
    pending: () => queued !== null,
  };
}
