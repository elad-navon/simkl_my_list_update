import { describe, expect, it } from "vitest";
import { emptyLibrary, idsMatch, LIBRARY_VERSION, mergeWatched, showKey } from "./schema";

describe("showKey", () => {
  it("prefers tmdb", () => {
    expect(showKey({ tmdb: 1, imdb: "tt1", tvdb: 2, simkl: 3 })).toBe("tmdb:1");
  });

  it("falls through the id spaces in order", () => {
    expect(showKey({ imdb: "tt1", tvdb: 2, simkl: 3 })).toBe("imdb:tt1");
    expect(showKey({ tvmaze: 9, tvdb: 2, simkl: 3 })).toBe("tvmaze:9");
    expect(showKey({ tvdb: 2, simkl: 3 })).toBe("tvdb:2");
    expect(showKey({ simkl: 3 })).toBe("simkl:3");
  });

  it("returns null when a show has no id at all", () => {
    expect(showKey({})).toBeNull();
  });

  it("namespaces the key so ids from different sources cannot collide", () => {
    expect(showKey({ tmdb: 5 })).not.toBe(showKey({ tvdb: 5 }));
  });

  it("treats id 0 as a real id, not as absent", () => {
    expect(showKey({ tmdb: 0 })).toBe("tmdb:0");
  });
});

describe("idsMatch", () => {
  it("matches on a shared tmdb id", () => {
    expect(idsMatch({ tmdb: 1 }, { tmdb: 1, imdb: "tt9" })).toBe(true);
  });

  it("does not match when the shared id space disagrees", () => {
    expect(idsMatch({ tmdb: 1 }, { tmdb: 2 })).toBe(false);
  });

  it("falls back to another shared id space", () => {
    expect(idsMatch({ imdb: "tt1" }, { imdb: "tt1" })).toBe(true);
  });

  it("does not match when there is no id space in common", () => {
    expect(idsMatch({ tmdb: 1 }, { imdb: "tt1" })).toBe(false);
  });

  it("handles null input", () => {
    expect(idsMatch(null, { tmdb: 1 })).toBe(false);
    expect(idsMatch({ tmdb: 1 }, undefined)).toBe(false);
  });
});

describe("mergeWatched", () => {
  it("unions episodes from both sides", () => {
    const merged = mergeWatched({ 1: { 1: "2026-01-01" } }, { 1: { 2: "2026-01-02" } });
    expect(merged).toEqual({ 1: { 1: "2026-01-01", 2: "2026-01-02" } });
  });

  it("merges across different seasons", () => {
    const merged = mergeWatched({ 1: { 1: "a" } }, { 2: { 1: "b" } });
    expect(Object.keys(merged)).toEqual(["1", "2"]);
  });

  it("keeps the earliest timestamp when both sides saw the same episode", () => {
    const merged = mergeWatched(
      { 1: { 1: "2026-06-01T00:00:00Z" } },
      { 1: { 1: "2026-01-01T00:00:00Z" } },
    );
    expect(merged[1]?.[1]).toBe("2026-01-01T00:00:00Z");
  });

  it("never un-watches an episode that only one side knows about", () => {
    const merged = mergeWatched({ 1: { 1: "a", 2: "b", 3: "c" } }, {});
    expect(Object.keys(merged[1] ?? {})).toHaveLength(3);
  });

  it("is order-independent", () => {
    const a = { 1: { 1: "2026-01-01", 2: "2026-02-01" } };
    const b = { 1: { 1: "2026-03-01", 3: "2026-04-01" } };
    expect(mergeWatched(a, b)).toEqual(mergeWatched(b, a));
  });

  it("handles two empty maps", () => {
    expect(mergeWatched({}, {})).toEqual({});
  });
});

describe("emptyLibrary", () => {
  it("is stamped with the current schema version and no sync yet", () => {
    expect(emptyLibrary()).toEqual({ version: LIBRARY_VERSION, syncedAt: null, shows: {} });
  });

  it("returns a fresh object each call", () => {
    const a = emptyLibrary();
    a.shows["x"] = {} as never;
    expect(Object.keys(emptyLibrary().shows)).toHaveLength(0);
  });
});
