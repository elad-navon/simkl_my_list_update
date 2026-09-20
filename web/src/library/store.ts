/**
 * The library store: a Zustand store backed by IndexedDB.
 *
 * IndexedDB rather than localStorage, deliberately. The old app kept
 * everything in localStorage and hit QuotaExceededError often enough that it
 * needed `safeSetItem` to swallow failures and `prunePersistedCache` to sweep
 * expired entries (app.js:63-68, 379-399). Your watch history is the one
 * thing that must never be silently dropped by a full quota, so it lives in
 * a store with room and without a shared budget.
 *
 * Writes are persisted on every mutation. The backup push is debounced
 * separately in `sync.ts` - this layer only guarantees the data survives a
 * reload.
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { ShowStatus } from "../domain/types";
import {
  emptyLibrary,
  showKey,
  type Library,
  type LibraryShow,
  type ShowIds,
  type ShowKey,
} from "./schema";

const IDB_KEY = "library";

export type LibraryState = {
  library: Library;
  /** False until the first read from IndexedDB resolves. */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  replaceAll: (library: Library) => Promise<void>;

  addShow: (input: { ids: ShowIds; title: string; year?: number; status: ShowStatus }) => Promise<ShowKey | null>;
  setStatus: (key: ShowKey, status: ShowStatus) => Promise<void>;
  removeShow: (key: ShowKey) => Promise<void>;
  markWatched: (key: ShowKey, season: number, episode: number, watchedAt?: string) => Promise<void>;
  unmarkWatched: (key: ShowKey, season: number, episode: number) => Promise<void>;
};

async function persist(library: Library): Promise<void> {
  await idbSet(IDB_KEY, library);
}

/** Applies `mutate` to one show, stamps `updatedAt`, saves, and returns the new library. */
function withShow(
  library: Library,
  key: ShowKey,
  mutate: (show: LibraryShow) => LibraryShow,
): Library {
  const existing = library.shows[key];
  if (!existing) return library;
  const updated = { ...mutate(existing), updatedAt: new Date().toISOString() };
  return { ...library, shows: { ...library.shows, [key]: updated } };
}

export const useLibrary = create<LibraryState>((set, get) => ({
  library: emptyLibrary(),
  hydrated: false,

  hydrate: async () => {
    const stored = await idbGet<Library>(IDB_KEY);
    set({ library: stored ?? emptyLibrary(), hydrated: true });
  },

  replaceAll: async (library) => {
    set({ library });
    await persist(library);
  },

  addShow: async ({ ids, title, year, status }) => {
    const key = showKey(ids);
    if (!key) return null;

    const now = new Date().toISOString();
    const { library } = get();
    const existing = library.shows[key];

    // Re-adding a show you already have is a status change, not a reset -
    // its watch history has to survive.
    const show: LibraryShow = existing
      ? { ...existing, status, updatedAt: now }
      : { key, ids, title, year, status, watched: {}, addedAt: now, updatedAt: now };

    const next = { ...library, shows: { ...library.shows, [key]: show } };
    set({ library: next });
    await persist(next);
    return key;
  },

  setStatus: async (key, status) => {
    const next = withShow(get().library, key, (show) => ({ ...show, status }));
    set({ library: next });
    await persist(next);
  },

  removeShow: async (key) => {
    const { library } = get();
    if (!library.shows[key]) return;
    const shows = { ...library.shows };
    delete shows[key];
    const next = { ...library, shows };
    set({ library: next });
    await persist(next);
  },

  markWatched: async (key, season, episode, watchedAt = new Date().toISOString()) => {
    const next = withShow(get().library, key, (show) => ({
      ...show,
      watched: {
        ...show.watched,
        [season]: { ...(show.watched[season] ?? {}), [episode]: watchedAt },
      },
    }));
    set({ library: next });
    await persist(next);
  },

  unmarkWatched: async (key, season, episode) => {
    const next = withShow(get().library, key, (show) => {
      const seasonMap = { ...(show.watched[season] ?? {}) };
      delete seasonMap[episode];
      return { ...show, watched: { ...show.watched, [season]: seasonMap } };
    });
    set({ library: next });
    await persist(next);
  },
}));
