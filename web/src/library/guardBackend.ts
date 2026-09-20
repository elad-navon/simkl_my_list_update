/**
 * Wraps a backend so every call passes through one place.
 *
 * Exists for the SIMKL 401. There is no refresh token in the PIN flow, so an
 * expired authorization has to be noticed and recorded - and it can surface from
 * any call, not just the load. Wrapping is what keeps that from being a
 * `catch` repeated in six methods, each of which could be the one that forgets.
 *
 * Deliberately thin: it changes nothing about what a method does or returns, so
 * it cannot be the reason a write behaves differently.
 */

import type { LibraryBackend } from "./backend";

export type Guard = <T>(work: () => Promise<T>) => Promise<T>;

export function guardBackend(backend: LibraryBackend, guard: Guard): LibraryBackend {
  return {
    mode: backend.mode,
    load: (signal) => guard(() => backend.load(signal)),
    addShow: (input) => guard(() => backend.addShow(input)),
    setStatus: (key, status) => guard(() => backend.setStatus(key, status)),
    removeShow: (key) => guard(() => backend.removeShow(key)),
    markWatched: (key, season, episode, watchedAt) =>
      guard(() =>
        watchedAt === undefined
          ? backend.markWatched(key, season, episode)
          : backend.markWatched(key, season, episode, watchedAt),
      ),
    unmarkWatched: (key, season, episode) => guard(() => backend.unmarkWatched(key, season, episode)),
    applyWatchedPatch: (key, patch) => guard(() => backend.applyWatchedPatch(key, patch)),
  };
}
