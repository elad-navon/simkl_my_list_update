import { describe, expect, it } from "vitest";
import { parseLibraryFile } from "./importFile";
import { LIBRARY_VERSION } from "./schema";

const good = {
  version: LIBRARY_VERSION,
  syncedAt: "2026-09-01T00:00:00Z",
  shows: {
    "tmdb:1": {
      key: "tmdb:1",
      ids: { tmdb: 1, imdb: "tt1", simkl: 11 },
      title: "Test Show",
      year: 2020,
      status: "watching",
      watched: { 1: { 1: "2026-01-01T00:00:00Z", 2: "2026-01-08T00:00:00Z" } },
      addedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-08T00:00:00Z",
    },
  },
};

const parse = (value: unknown) => parseLibraryFile(JSON.stringify(value));

describe("parseLibraryFile", () => {
  it("round-trips an exported library", () => {
    const result = parse(good);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.shows).toBe(1);
    expect(result.watchedEpisodes).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.library.shows["tmdb:1"]).toMatchObject({
      title: "Test Show",
      status: "watching",
      watched: { 1: { 1: "2026-01-01T00:00:00Z", 2: "2026-01-08T00:00:00Z" } },
    });
  });

  it("keeps hand-picked artwork and manual episodes", () => {
    const result = parse({
      ...good,
      shows: {
        "tmdb:1": {
          ...good.shows["tmdb:1"],
          images: { posterPath: "/chosen.jpg" },
          manualEpisodes: [{ season: 9, episode: 1, airDate: "2026-09-01", title: "Typed" }],
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.shows["tmdb:1"]?.images).toEqual({ posterPath: "/chosen.jpg" });
    expect(result.library.shows["tmdb:1"]?.manualEpisodes).toHaveLength(1);
  });

  it("rejects a file that is not JSON", () => {
    expect(parseLibraryFile("not json at all")).toEqual({
      ok: false,
      error: "That file is not valid JSON.",
    });
  });

  it("rejects something that is not a library", () => {
    expect(parse({ hello: "world" }).ok).toBe(false);
    expect(parse([1, 2, 3]).ok).toBe(false);
  });

  it("refuses a file from a newer version rather than losing what it cannot read", () => {
    const result = parse({ ...good, version: LIBRARY_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/newer version/);
  });

  it("accepts a file with no version at all", () => {
    const { version: _version, ...withoutVersion } = good;
    expect(parse(withoutVersion).ok).toBe(true);
  });

  it("derives a missing key from the ids rather than dropping the show", () => {
    const result = parse({
      shows: { anything: { ids: { tmdb: 5 }, title: "No key", status: "watching" } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.library.shows)).toEqual(["tmdb:5"]);
  });

  it("skips a show with no usable identity and reports how many", () => {
    const result = parse({
      shows: {
        "tmdb:1": good.shows["tmdb:1"],
        broken: { title: "No ids or key", status: "watching" },
        alsoBroken: { ids: { tmdb: 2 }, status: "watching" },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shows).toBe(1);
    expect(result.warnings[0]).toMatch(/2 shows could not be read/);
  });

  it("rejects a status it does not recognise", () => {
    const result = parse({
      shows: { "tmdb:1": { ...good.shows["tmdb:1"], status: "rewatching" } },
    });
    expect(result.ok).toBe(false);
  });

  it("drops unreadable watch entries but keeps the rest, and says so", () => {
    // One bad entry should not cost the other nine hundred.
    const result = parse({
      shows: {
        "tmdb:1": {
          ...good.shows["tmdb:1"],
          watched: { 1: { 1: "2026-01-01", 2: 12345, notANumber: "x" }, bad: {} },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.watchedEpisodes).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/watch entries were unreadable/);
  });

  it("refuses a file with nothing usable, leaving the library alone", () => {
    const result = parse({ shows: { broken: { title: "No status" } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/nothing was changed/);
  });

  it("ignores an id that is not a number", () => {
    const result = parse({
      shows: { "tmdb:1": { ...good.shows["tmdb:1"], ids: { tmdb: "1", imdb: 42 } } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The key survived because the file carried one; the junk ids did not.
    expect(result.library.shows["tmdb:1"]?.ids).toEqual({});
  });

  it("stamps the schema version it actually produced", () => {
    const result = parse({ ...good, version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.version).toBe(LIBRARY_VERSION);
  });
});
