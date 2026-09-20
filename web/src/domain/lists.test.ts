import { describe, expect, it } from "vitest";
import {
  myListSortKey,
  recentlyWatched,
  sortByKeyDescending,
  sortByRating,
  type WatchSource,
} from "./lists";
import type { Episode } from "./types";

function show(over: Partial<WatchSource> = {}): WatchSource {
  return { key: "tmdb:1", title: "Show", status: "watching", watched: {}, ...over };
}

function ep(season: number, episode: number, airDate: string | null): Episode {
  return { season, episode, airDate, title: null, runtime: null };
}

describe("recentlyWatched", () => {
  it("returns the most recent episode of each show, newest first", () => {
    const rows = recentlyWatched([
      show({ key: "a", title: "A", watched: { 1: { 1: "2026-01-01T00:00:00Z" } } }),
      show({ key: "b", title: "B", watched: { 1: { 1: "2026-03-01T00:00:00Z" } } }),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["B", "A"]);
  });

  it("keeps only one entry per show, so a binge cannot fill the panel", () => {
    const rows = recentlyWatched([
      show({
        watched: {
          1: { 1: "2026-01-01T00:00:00Z", 2: "2026-01-02T00:00:00Z", 3: "2026-01-03T00:00:00Z" },
        },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ season: 1, episode: 3 });
  });

  it("picks the newest episode even when it is not the highest numbered", () => {
    const rows = recentlyWatched([
      show({ watched: { 1: { 5: "2026-01-01T00:00:00Z", 2: "2026-06-01T00:00:00Z" } } }),
    ]);
    expect(rows[0]?.episode).toBe(2);
  });

  it("includes a dropped show and flags it for the badge", () => {
    const rows = recentlyWatched([
      show({ key: "a", status: "dropped", watched: { 1: { 1: "2026-01-01T00:00:00Z" } } }),
    ]);
    expect(rows[0]?.dropped).toBe(true);
  });

  it("leaves completed and on-hold shows out, as the old panel did", () => {
    const rows = recentlyWatched([
      show({ key: "a", status: "completed", watched: { 1: { 1: "2026-01-01T00:00:00Z" } } }),
      show({ key: "b", status: "hold", watched: { 1: { 1: "2026-01-01T00:00:00Z" } } }),
    ]);
    expect(rows).toEqual([]);
  });

  it("skips specials", () => {
    expect(recentlyWatched([show({ watched: { 0: { 1: "2026-01-01T00:00:00Z" } } })])).toEqual([]);
  });

  it("ignores an unparseable timestamp rather than sorting it as NaN", () => {
    const rows = recentlyWatched([
      show({ watched: { 1: { 1: "not a date", 2: "2026-01-01T00:00:00Z" } } }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.episode).toBe(2);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_unused, i) =>
      show({ key: `k${i}`, watched: { 1: { 1: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` } } }),
    );
    expect(recentlyWatched(many)).toHaveLength(15);
    expect(recentlyWatched(many, 3)).toHaveLength(3);
  });

  it("handles a library with nothing watched", () => {
    expect(recentlyWatched([show()])).toEqual([]);
    expect(recentlyWatched([])).toEqual([]);
  });
});

describe("myListSortKey", () => {
  const AIR = Date.parse("2026-09-22T20:00:00+03:00");
  const WATCH = Date.parse("2026-09-01T00:00:00Z");

  it("takes the next episode's air date when it is the more recent signal", () => {
    expect(
      myListSortKey({ nextToWatch: ep(1, 1, "2026-09-22T20:00:00+03:00"), lastWatchedAt: WATCH }),
    ).toBe(AIR);
  });

  it("takes the last watch when the next episode aired long ago", () => {
    // An ended show you are rewatching: its next unwatched episode first aired
    // years back, and the air date alone would bury it.
    expect(myListSortKey({ nextToWatch: ep(1, 1, "2001-06-03"), lastWatchedAt: WATCH })).toBe(WATCH);
  });

  it("works with only one of the two signals", () => {
    expect(myListSortKey({ nextToWatch: ep(1, 1, "2026-09-22T20:00:00+03:00"), lastWatchedAt: null })).toBe(AIR);
    expect(myListSortKey({ nextToWatch: null, lastWatchedAt: WATCH })).toBe(WATCH);
  });

  it("is null when there is nothing to sort on", () => {
    expect(myListSortKey({ nextToWatch: null, lastWatchedAt: null })).toBeNull();
    expect(myListSortKey({ nextToWatch: ep(1, 1, null), lastWatchedAt: null })).toBeNull();
  });

  it("compares offsets as timestamps, not as strings", () => {
    // "2026-01-01T23:00:00+03:00" sorts after "2026-01-02T01:00:00+09:00"
    // lexically, and before it in reality.
    const east = myListSortKey({ nextToWatch: ep(1, 1, "2026-01-02T01:00:00+09:00"), lastWatchedAt: null });
    const west = myListSortKey({ nextToWatch: ep(1, 1, "2026-01-01T23:00:00+03:00"), lastWatchedAt: null });
    expect(east).toBeLessThan(west as number);
  });
});

describe("sortByKeyDescending", () => {
  it("orders most recent first", () => {
    expect(sortByKeyDescending([1, 3, 2], (n) => n)).toEqual([3, 2, 1]);
  });

  it("sinks items with no key to the end", () => {
    const items = [{ k: null }, { k: 5 }, { k: null }, { k: 9 }];
    expect(sortByKeyDescending(items, (i) => i.k).map((i) => i.k)).toEqual([9, 5, null, null]);
  });

  it("does not mutate its input", () => {
    const items = [1, 3, 2];
    sortByKeyDescending(items, (n) => n);
    expect(items).toEqual([1, 3, 2]);
  });
});

describe("sortByRating", () => {
  it("puts the best-reviewed unstarted show first and unrated ones last", () => {
    const items = [{ r: 7.1 }, { r: null }, { r: 9.3 }];
    expect(sortByRating(items, (i) => i.r).map((i) => i.r)).toEqual([9.3, 7.1, null]);
  });
});
