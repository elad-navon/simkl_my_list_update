/**
 * The independent backend: the local library is the source of truth.
 *
 * A thin adapter over the Zustand store, which already does the real work. It
 * exists so that the UI talks to one interface whichever mode is active, and so
 * that the SIMKL backend has something to use as its mirror rather than
 * re-implementing persistence.
 */

import type { AddShowInput, LibraryBackend, LoadReport } from "./backend";
import type { LibraryState } from "./store";

export function createLocalBackend(store: () => LibraryState): LibraryBackend {
  return {
    mode: "local",

    async load() {
      await store().hydrate();
      const library = store().library;
      const report: LoadReport = {
        mode: "local",
        shows: Object.keys(library.shows).length,
        // Nothing is fetched and nothing can be removed by a load: the local
        // library IS the answer, so a load is a read.
        refetched: 0,
        removed: 0,
        unkeyed: [],
      };
      return { library, report };
    },

    addShow: (input: AddShowInput) => store().addShow(input),
    setStatus: (key, status) => store().setStatus(key, status),
    removeShow: (key) => store().removeShow(key),
    markWatched: (key, season, episode, watchedAt) =>
      watchedAt === undefined
        ? store().markWatched(key, season, episode)
        : store().markWatched(key, season, episode, watchedAt),
    unmarkWatched: (key, season, episode) => store().unmarkWatched(key, season, episode),
  };
}
