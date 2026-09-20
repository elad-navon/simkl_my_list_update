import { describe, expect, it } from "vitest";
import { mergeLibraries } from "./merge";
import { emptyLibrary, type Library, type LibraryShow } from "./schema";

const NOW = "2026-09-20T12:00:00.000Z";

function show(over: Partial<LibraryShow> = {}): LibraryShow {
  return {
    key: "tmdb:1",
    ids: { tmdb: 1 },
    title: "Test Show",
    status: "watching",
    watched: {},
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function library(shows: LibraryShow[], syncedAt: string | null = null): Library {
  return {
    ...emptyLibrary(),
    syncedAt,
    shows: Object.fromEntries(shows.map((s) => [s.key, s])),
  };
}

describe("mergeLibraries", () => {
  it("unions watch history rather than taking one side", () => {
    // The phone watched one episode offline, the desktop watched another.
    const local = library([show({ watched: { 1: { 1: "2026-02-01T00:00:00Z" } } })]);
    const remote = library([show({ watched: { 1: { 2: "2026-02-02T00:00:00Z" } } })]);

    const { library: merged, stats } = mergeLibraries(local, remote, NOW);
    expect(merged.shows["tmdb:1"]?.watched[1]).toEqual({
      1: "2026-02-01T00:00:00Z",
      2: "2026-02-02T00:00:00Z",
    });
    expect(stats.episodesGained).toBe(1);
  });

  it("keeps the earliest timestamp when both sides watched the same episode", () => {
    // A watch is a fact that happened; the later record is a syncing artifact.
    const local = library([show({ watched: { 1: { 1: "2026-06-01T00:00:00Z" } } })]);
    const remote = library([show({ watched: { 1: { 1: "2026-01-01T00:00:00Z" } } })]);

    expect(mergeLibraries(local, remote, NOW).library.shows["tmdb:1"]?.watched[1]?.[1]).toBe(
      "2026-01-01T00:00:00Z",
    );
  });

  it("never un-watches an episode only one side knows about", () => {
    const local = library([show({ watched: { 1: { 1: "a", 2: "b", 3: "c" } } })]);
    const remote = library([show()]);

    expect(Object.keys(mergeLibraries(local, remote, NOW).library.shows["tmdb:1"]?.watched[1] ?? {})).toHaveLength(3);
  });

  it("takes the most recently changed status", () => {
    const local = library([show({ status: "watching", updatedAt: "2026-01-01T00:00:00Z" })]);
    const remote = library([show({ status: "completed", updatedAt: "2026-05-01T00:00:00Z" })]);

    expect(mergeLibraries(local, remote, NOW).library.shows["tmdb:1"]?.status).toBe("completed");
  });

  it("prefers the local side when both were changed at the same moment", () => {
    const local = library([show({ status: "hold", updatedAt: "2026-05-01T00:00:00Z" })]);
    const remote = library([show({ status: "dropped", updatedAt: "2026-05-01T00:00:00Z" })]);

    expect(mergeLibraries(local, remote, NOW).library.shows["tmdb:1"]?.status).toBe("hold");
  });

  it("keeps the earlier addedAt, which is when the show entered the list", () => {
    const local = library([show({ addedAt: "2026-03-01T00:00:00Z" })]);
    const remote = library([show({ addedAt: "2024-10-12T00:00:00Z" })]);

    expect(mergeLibraries(local, remote, NOW).library.shows["tmdb:1"]?.addedAt).toBe(
      "2024-10-12T00:00:00Z",
    );
  });

  it("fills blank ids from the other side without overwriting any", () => {
    const local = library([show({ ids: { tmdb: 1, tvmaze: 82 } })]);
    const remote = library([show({ ids: { tmdb: 1, imdb: "tt1", tvmaze: 99 } })]);

    expect(mergeLibraries(local, remote, NOW).library.shows["tmdb:1"]?.ids).toEqual({
      tmdb: 1,
      tvmaze: 82,
      imdb: "tt1",
    });
  });

  it("keeps a chosen poster and a manual episode from whichever side has them", () => {
    // Both are things the user did, and neither should be lost because the other
    // side's row happened to be touched more recently.
    const manual = [{ season: 9, episode: 1, airDate: "2026-09-01", title: "Typed" }];
    const local = library([show({ updatedAt: "2026-06-01T00:00:00Z" })]);
    const remote = library([
      show({ updatedAt: "2026-01-01T00:00:00Z", images: { posterPath: "/p.jpg" }, manualEpisodes: manual }),
    ]);

    const merged = mergeLibraries(local, remote, NOW).library.shows["tmdb:1"];
    expect(merged?.images).toEqual({ posterPath: "/p.jpg" });
    expect(merged?.manualEpisodes).toEqual(manual);
  });

  it("brings across a show added on the other device", () => {
    const local = library([show()], "2026-05-01T00:00:00Z");
    const remote = library([
      show(),
      show({ key: "tmdb:2", ids: { tmdb: 2 }, title: "New", updatedAt: "2026-06-01T00:00:00Z" }),
    ]);

    const { library: merged, stats } = mergeLibraries(local, remote, NOW);
    expect(merged.shows["tmdb:2"]?.title).toBe("New");
    expect(stats.added).toBe(1);
  });

  it("does not resurrect a show deleted locally since the last sync", () => {
    // The union answer is tempting and wrong: it makes deletion impossible, so a
    // removed show comes back on every sync forever.
    const local = library([], "2026-05-01T00:00:00Z");
    const remote = library([show({ updatedAt: "2026-01-01T00:00:00Z" })]);

    const { library: merged, stats } = mergeLibraries(local, remote, NOW);
    expect(merged.shows["tmdb:1"]).toBeUndefined();
    expect(stats.keptDeleted).toBe(1);
  });

  it("takes everything on a first pull, when there is no deletion to infer", () => {
    const { library: merged, stats } = mergeLibraries(emptyLibrary(), library([show()]), NOW);
    expect(merged.shows["tmdb:1"]).toBeDefined();
    expect(stats.added).toBe(1);
  });

  it("keeps a show only the local library has, for the next push to carry up", () => {
    const { library: merged, stats } = mergeLibraries(
      library([show()], "2026-05-01T00:00:00Z"),
      emptyLibrary(),
      NOW,
    );
    expect(merged.shows["tmdb:1"]).toBeDefined();
    expect(stats.localOnly).toBe(1);
  });

  it("stamps syncedAt so the next merge can tell deletions from additions", () => {
    expect(mergeLibraries(emptyLibrary(), emptyLibrary(), NOW).library.syncedAt).toBe(NOW);
  });

  it("carries the higher schema version forward", () => {
    const local = { ...emptyLibrary(), version: 1 };
    const remote = { ...emptyLibrary(), version: 2 };
    expect(mergeLibraries(local, remote, NOW).library.version).toBe(2);
  });

  it("handles two empty libraries", () => {
    const { library: merged, stats } = mergeLibraries(emptyLibrary(), emptyLibrary(), NOW);
    expect(merged.shows).toEqual({});
    expect(stats).toEqual({ merged: 0, added: 0, keptDeleted: 0, localOnly: 0, episodesGained: 0 });
  });

  it("is stable when merged against itself", () => {
    // A pull that changes nothing must not look like a change, or every load
    // would schedule a pointless push.
    const one = library([show({ watched: { 1: { 1: "2026-01-01T00:00:00Z" } } })], "2026-05-01T00:00:00Z");
    const { library: merged, stats } = mergeLibraries(one, one, NOW);
    expect(merged.shows).toEqual(one.shows);
    expect(stats.episodesGained).toBe(0);
  });

  it("keeps the cached summary, taking the more recently derived one", () => {
    // Dropping it would put every watching show back on My List after a pull.
    const local = library([
      show({ updatedAt: "2026-06-01T00:00:00Z", summary: { remaining: 5, nextAirDate: null, checkedAt: "2026-06-01T00:00:00Z" } }),
    ]);
    const remote = library([
      show({ updatedAt: "2026-01-01T00:00:00Z", summary: { remaining: 0, nextAirDate: null, checkedAt: "2026-08-01T00:00:00Z" } }),
    ]);

    // The remote ROW is older, but its summary was derived later - unrelated events.
    expect(mergeLibraries(local, remote, NOW).library.shows["tmdb:1"]?.summary?.remaining).toBe(0);
  });

  it("keeps a summary only one side has", () => {
    const withSummary = show({ summary: { remaining: 2, nextAirDate: null, checkedAt: "2026-06-01T00:00:00Z" } });
    expect(mergeLibraries(library([show()]), library([withSummary]), NOW).library.shows["tmdb:1"]?.summary?.remaining).toBe(2);
    expect(mergeLibraries(library([withSummary]), library([show()]), NOW).library.shows["tmdb:1"]?.summary?.remaining).toBe(2);
  });
});
