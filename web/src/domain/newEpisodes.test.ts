import { describe, expect, it } from "vitest";
import {
  checkForNewEpisodes,
  describeNewEpisode,
  episodeCode,
  type CheckInput,
} from "./newEpisodes";
import type { Episode } from "./types";

function ep(season: number, episode: number, title: string | null = null): Episode {
  return { season, episode, airDate: "2026-01-01", title, runtime: null };
}

function show(over: Partial<CheckInput> = {}): CheckInput {
  return { key: "tmdb:1", title: "Test Show", latestAired: ep(1, 1), ...over };
}

describe("checkForNewEpisodes", () => {
  it("records a show seen for the first time without announcing it", () => {
    // Otherwise the first run after installing announces the whole library.
    const result = checkForNewEpisodes([show()], {});
    expect(result.fresh).toEqual([]);
    expect(result.seeded).toBe(1);
    expect(result.snapshot["tmdb:1"]).toBe(1001);
  });

  it("reports a show whose latest aired episode moved forward", () => {
    const result = checkForNewEpisodes([show({ latestAired: ep(2, 7, "The One") })], {
      "tmdb:1": 2006,
    });
    expect(result.fresh).toEqual([
      {
        key: "tmdb:1",
        title: "Test Show",
        season: 2,
        episode: 7,
        episodeTitle: "The One",
        advancedBy: 1,
      },
    ]);
  });

  it("says nothing when nothing moved", () => {
    const result = checkForNewEpisodes([show({ latestAired: ep(1, 5) })], { "tmdb:1": 1005 });
    expect(result.fresh).toEqual([]);
    expect(result.seeded).toBe(0);
  });

  it("counts how far a show jumped, for the message to say so", () => {
    const result = checkForNewEpisodes([show({ latestAired: ep(2, 7) })], { "tmdb:1": 2004 });
    expect(result.fresh[0]?.advancedBy).toBe(3);
  });

  it("notices a show that is fully caught up", () => {
    // The case the old app's next_to_watch could not see at all, and the one
    // where a new episode matters most.
    const result = checkForNewEpisodes([show({ latestAired: ep(3, 1) })], { "tmdb:1": 2010 });
    expect(result.fresh).toHaveLength(1);
  });

  it("skips a show with nothing aired yet", () => {
    const result = checkForNewEpisodes([show({ latestAired: null })], {});
    expect(result.fresh).toEqual([]);
    expect(result.snapshot["tmdb:1"]).toBeUndefined();
  });

  it("resets rather than announcing forever when a show moves backwards", () => {
    // A source correcting a wrong date, or renumbering a season.
    const result = checkForNewEpisodes([show({ latestAired: ep(1, 2) })], { "tmdb:1": 1009 });
    expect(result.fresh).toEqual([]);
    expect(result.snapshot["tmdb:1"]).toBe(1002);
  });

  it("keeps shows it was not asked about in the snapshot", () => {
    // A show whose metadata failed to load this time must not lose its place and
    // then announce its whole run on the next successful check.
    const result = checkForNewEpisodes([show()], { "tmdb:1": 1001, "tmdb:99": 5005 });
    expect(result.snapshot["tmdb:99"]).toBe(5005);
  });

  it("handles several shows at once", () => {
    const result = checkForNewEpisodes(
      [
        show({ key: "a", title: "A", latestAired: ep(1, 2) }),
        show({ key: "b", title: "B", latestAired: ep(1, 1) }),
        show({ key: "c", title: "C", latestAired: ep(1, 4) }),
      ],
      { a: 1001, b: 1001 },
    );
    expect(result.fresh.map((f) => f.title)).toEqual(["A"]);
    expect(result.seeded).toBe(1);
    expect(result.snapshot).toEqual({ a: 1002, b: 1001, c: 1004 });
  });

  it("handles an empty library", () => {
    expect(checkForNewEpisodes([], {})).toEqual({ fresh: [], snapshot: {}, seeded: 0 });
  });
});

describe("episodeCode", () => {
  it("zero-pads both numbers", () => {
    expect(episodeCode(2, 7)).toBe("S02E07");
    expect(episodeCode(12, 104)).toBe("S12E104");
  });
});

describe("describeNewEpisode", () => {
  const entry = {
    key: "k",
    title: "T",
    season: 2,
    episode: 7,
    episodeTitle: "The One",
    advancedBy: 1,
  };

  it("names the episode", () => {
    expect(describeNewEpisode(entry)).toBe("S02E07 - The One");
  });

  it("falls back to the code when the episode has no title", () => {
    expect(describeNewEpisode({ ...entry, episodeTitle: null })).toBe("S02E07");
  });

  it("mentions the others only when there are any", () => {
    // "1 new episode" reads worse than naming it.
    expect(describeNewEpisode({ ...entry, advancedBy: 3 })).toBe("S02E07 - The One (and 2 more)");
  });
});
