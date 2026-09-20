/**
 * The SIMKL backend: SIMKL owns the list, the local library mirrors it.
 *
 * It composes the local backend rather than persisting anything itself, so
 * there is exactly one piece of code that writes to IndexedDB and the mirror is
 * a real library rather than a parallel format. Flipping to independence then
 * needs no conversion at all - the mirror already IS the local library.
 *
 * Order of operations on a write: SIMKL first, mirror second. A rejected write
 * therefore never leaves the mirror claiming something SIMKL does not know,
 * which is the failure that would quietly corrupt a backup. The UI can be
 * optimistic on top of this; the backend's promise means the change is real.
 */

import type { SimklClient, SimklWriteIds } from "../api/simkl";
import type { ShowStatus } from "../domain/types";
import { isEmptyPatch, type WatchedPatch } from "../domain/watchEdits";
import {
  BackendUnsupportedError,
  type AddShowInput,
  type LibraryBackend,
  type LoadReport,
} from "./backend";
import { applyReconcile, episodeFetchList, planReconcile } from "./reconcile";
import type { Library, ShowIds, ShowKey } from "./schema";
import type { LibraryState } from "./store";

export type SimklBackendDeps = {
  simkl: SimklClient;
  /** Persistence for the mirror. The local backend, in practice. */
  mirror: LibraryBackend;
  /** Direct store access, for writing the reconciled library in one go. */
  store: () => LibraryState;
  /**
   * How many episode lists a single load may fetch while reconciling.
   *
   * A first load against an empty mirror wants one per show with history, which
   * on this library is several hundred requests - too slow to sit behind a
   * blank screen. Past the cap the remaining shows keep SIMKL's watched COUNT
   * and get their episode-level history on a later load, so the numbers on
   * screen stay right while the detail fills in. Seeding the mirror properly is
   * what `npm run migrate` is for; this is the safety net, not the plan.
   */
  maxEpisodeFetches?: number | undefined;
};

const DEFAULT_MAX_EPISODE_FETCHES = 60;

export function createSimklBackend(deps: SimklBackendDeps): LibraryBackend {
  const { simkl, mirror, store } = deps;
  const maxEpisodeFetches = deps.maxEpisodeFetches ?? DEFAULT_MAX_EPISODE_FETCHES;

  /**
   * SIMKL identifies a show by its own ids. A show that arrived from a TMDB-only
   * search has none, and there is nothing to write - better to say so than to
   * update the mirror and let it drift away from SIMKL unnoticed.
   */
  const writeIds = (key: ShowKey, ids: ShowIds | undefined): SimklWriteIds => {
    const out: SimklWriteIds = {};
    if (ids?.simkl != null) out.simkl = ids.simkl;
    if (ids?.tmdb != null) out.tmdb = ids.tmdb;
    if (ids?.imdb) out.imdb = ids.imdb;
    if (Object.keys(out).length === 0) {
      throw new BackendUnsupportedError(
        `${key} has no SIMKL, TMDB or IMDb id, so SIMKL cannot be told about it. ` +
          `Switch to the local library to manage this show.`,
      );
    }
    return out;
  };

  const idsOf = (key: ShowKey): ShowIds | undefined => store().library.shows[key]?.ids;

  /** SIMKL's own id, which the per-episode history endpoints require. */
  const requireSimklId = (key: ShowKey): number => {
    const simklId = idsOf(key)?.simkl;
    if (simklId == null) {
      throw new BackendUnsupportedError(
        `${key} has no SIMKL id, so its episode history cannot be written to SIMKL.`,
      );
    }
    return simklId;
  };

  /**
   * One request per direction, then the mirror.
   *
   * Un-marking has no precedent in the old app, which could only ever add to the
   * history - so `/sync/history/remove` with episodes is the documented shape of
   * that endpoint rather than a behaviour observed in production. It throws
   * before the mirror is touched, so a wrong guess surfaces as a visible failure
   * instead of a silent divergence, and the capability is wanted mainly for the
   * independent mode anyway, where SIMKL is not involved at all.
   */
  const applyWatchedPatch = async (key: ShowKey, patch: WatchedPatch): Promise<void> => {
    if (isEmptyPatch(patch)) return;
    const simklId = requireSimklId(key);

    if (patch.remove.length) await simkl.removeEpisodesFromHistory(simklId, patch.remove);
    if (patch.add.length) await simkl.addEpisodesToHistory(simklId, patch.add);

    await mirror.applyWatchedPatch(key, patch);
  };

  return {
    mode: "simkl",

    async load(signal) {
      // The mirror first, so the reconcile has something to compare against and
      // so a SIMKL outage still leaves a usable library on screen.
      await mirror.load(signal);
      const before: Library = store().library;

      const lists = await simkl.getAllLists(signal);
      const plan = planReconcile(before, lists);

      const wanted = episodeFetchList(plan);
      const toFetch = wanted.slice(0, maxEpisodeFetches);
      const episodes: Record<number, Awaited<ReturnType<SimklClient["getEpisodes"]>>> = {};
      for (const simklId of toFetch) {
        try {
          episodes[simklId] = await simkl.getEpisodes(simklId, signal);
        } catch {
          // One unavailable episode list must not fail the whole load. That
          // show keeps SIMKL's count and no episode-level history this time.
          episodes[simklId] = null;
        }
      }

      const { library, counts, removed } = applyReconcile(before, plan, episodes);
      await store().replaceAll(library);

      const report: LoadReport = {
        mode: "simkl",
        shows: Object.keys(library.shows).length,
        refetched: counts["needs-episodes"],
        removed,
        unkeyed: plan.unkeyed,
      };
      return { library, report };
    },

    async addShow(input: AddShowInput) {
      const ids: SimklWriteIds = {};
      if (input.ids.simkl != null) ids.simkl = input.ids.simkl;
      if (input.ids.tmdb != null) ids.tmdb = input.ids.tmdb;
      if (input.ids.imdb) ids.imdb = input.ids.imdb;
      if (Object.keys(ids).length === 0) {
        throw new BackendUnsupportedError(
          "This show has no SIMKL, TMDB or IMDb id, so SIMKL cannot be told about it.",
        );
      }

      await simkl.addToList(ids, input.status);
      return mirror.addShow(input);
    },

    async setStatus(key: ShowKey, status: ShowStatus) {
      await simkl.addToList(writeIds(key, idsOf(key)), status);
      await mirror.setStatus(key, status);
    },

    async removeShow(key: ShowKey) {
      await simkl.removeFromList(writeIds(key, idsOf(key)));
      await mirror.removeShow(key);
    },

    markWatched(key: ShowKey, season: number, episode: number, watchedAt?: string) {
      return applyWatchedPatch(key, {
        add: [{ season, episode, watchedAt: watchedAt ?? new Date().toISOString() }],
        remove: [],
      });
    },

    unmarkWatched(key: ShowKey, season: number, episode: number) {
      return applyWatchedPatch(key, { add: [], remove: [{ season, episode }] });
    },

    applyWatchedPatch,
  };
}
