/**
 * Where the list and the watch history live.
 *
 * The two goals this rewrite began with - leaving SIMKL, and moving to React -
 * turned out to be separable, and only the second is certain. So ownership of
 * the list is a choice with two implementations behind one interface, and
 * nothing above this layer knows which is in use:
 *
 * - `local`: IndexedDB, backed up to a Gist. Fully independent.
 * - `simkl`: SIMKL is the source of truth, with the local library kept as a
 *   live mirror beside it. Switching to independence is then a setting, not a
 *   migration, and if SIMKL disappeared overnight the history is already here.
 *
 * Both share one progress path: the counts are always derived from the episode
 * list, never read off SIMKL's aggregate fields, so the two-sources-of-truth
 * contradiction that made `padCount` necessary cannot return through SIMKL mode.
 */

import type { ShowStatus } from "../domain/types";
import type { WatchedPatch } from "../domain/watchEdits";
import type { AddShowInput, Library, ShowKey } from "./schema";

export type { AddShowInput };

export type BackendMode = "local" | "simkl";

/**
 * What a load actually had to do. Surfaced rather than hidden because in SIMKL
 * mode a load can be anywhere between five requests and several hundred, and
 * when it is slow the user deserves to know why.
 */
export type LoadReport = {
  mode: BackendMode;
  shows: number;
  /** Shows whose history had to be rebuilt from a fetched episode list. */
  refetched: number;
  /** Shows dropped because SIMKL no longer lists them. */
  removed: number;
  /** Shows SIMKL sent with no usable id, reported rather than silently lost. */
  unkeyed: string[];
};

/**
 * Every mutation resolves once the change is durable.
 *
 * In `local` mode that means written to IndexedDB. In `simkl` mode it means
 * SIMKL accepted the write AND the mirror was updated - in that order, so a
 * rejected write never leaves the mirror claiming something SIMKL does not
 * know. That is the opposite of an optimistic update and it is deliberate:
 * the UI layer can be optimistic on top of this, but the backend's promise
 * has to mean what it says.
 */
export type LibraryBackend = {
  readonly mode: BackendMode;

  load: (signal?: AbortSignal) => Promise<{ library: Library; report: LoadReport }>;

  addShow: (input: AddShowInput) => Promise<ShowKey | null>;
  setStatus: (key: ShowKey, status: ShowStatus) => Promise<void>;
  removeShow: (key: ShowKey) => Promise<void>;
  markWatched: (key: ShowKey, season: number, episode: number, watchedAt?: string) => Promise<void>;
  unmarkWatched: (key: ShowKey, season: number, episode: number) => Promise<void>;
  /**
   * Applies a whole history edit - see `domain/watchEdits`.
   *
   * The primitive the other two are built from, and the one the UI should reach
   * for: "I stopped watching here" and "I have seen everything to here" are
   * single actions to the user, so they are single actions here too, rather
   * than two hundred calls the user can watch trickle through.
   */
  applyWatchedPatch: (key: ShowKey, patch: WatchedPatch) => Promise<void>;
};

/**
 * Raised when a mutation cannot be expressed against the active source.
 *
 * SIMKL identifies a show by its own id, so a show that reached the library
 * without one - from a TMDB-only search result - cannot be written to SIMKL at
 * all. Failing loudly beats writing it to the mirror and letting the two drift
 * apart silently.
 */
export class BackendUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendUnsupportedError";
  }
}
