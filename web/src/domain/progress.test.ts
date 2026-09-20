import { describe, expect, it } from "vitest";
import { computeProgress, countWatched, mostRecentWatchedAt, seasonMaxEpisodes } from "./progress";
import type { Episode, WatchedMap } from "./types";

const NOW = Date.parse("2026-09-20T12:00:00Z");

function ep(season: number, episode: number, airDate: string | null, runtime = 45): Episode {
  return { season, episode, airDate, title: `S${season}E${episode}`, runtime };
}

/** Three aired episodes, one airing in two days, plus an undated one. */
function sampleEpisodes(): Episode[] {
  return [
    ep(1, 1, "2026-09-01T20:00:00+03:00"),
    ep(1, 2, "2026-09-08T20:00:00+03:00"),
    ep(1, 3, "2026-09-15T20:00:00+03:00"),
    ep(1, 4, "2026-09-22T20:00:00+03:00"),
    ep(1, 5, null),
  ];
}

describe("computeProgress", () => {
  it("counts aired, not-aired and remaining from the episode list alone", () => {
    const watched: WatchedMap = { 1: { 1: "2026-09-02T09:00:00Z" } };
    const p = computeProgress(sampleEpisodes(), watched, NOW);

    expect(p.total).toBe(5);
    expect(p.aired).toBe(3);
    expect(p.notAired).toBe(2); // the future one AND the undated one
    expect(p.watched).toBe(1);
    expect(p.remaining).toBe(2);
  });

  it("keeps remaining and remainingEpisodes consistent by construction", () => {
    const p = computeProgress(sampleEpisodes(), {}, NOW);
    expect(p.remaining).toBe(p.remainingEpisodes.length);
  });

  it("orders remaining episodes oldest first and exposes the first as nextToWatch", () => {
    const watched: WatchedMap = { 1: { 1: "2026-09-02T09:00:00Z" } };
    const p = computeProgress(sampleEpisodes(), watched, NOW);

    expect(p.remainingEpisodes.map((e) => e.episode)).toEqual([2, 3]);
    expect(p.nextToWatch?.episode).toBe(2);
  });

  it("treats an episode that aired earlier today as already available", () => {
    const earlierToday = "2026-09-20T09:00:00Z"; // NOW is 12:00Z the same day
    const p = computeProgress([ep(1, 1, earlierToday)], {}, NOW);

    expect(p.aired).toBe(1);
    expect(p.remaining).toBe(1);
    expect(p.nextAiring).toBeNull();
  });

  it("picks the soonest future episode as nextAiring, ignoring undated ones", () => {
    const p = computeProgress(sampleEpisodes(), {}, NOW);
    expect(p.nextAiring?.episode).toBe(4);
  });

  it("excludes specials from every count", () => {
    const withSpecial = [...sampleEpisodes(), ep(0, 1, "2026-09-02T20:00:00+03:00")];
    const p = computeProgress(withSpecial, { 0: { 1: "2026-09-03T00:00:00Z" } }, NOW);

    expect(p.total).toBe(5);
    expect(p.watched).toBe(0);
    expect(p.remainingEpisodes.every((e) => e.season !== 0)).toBe(true);
  });

  it("reports a fully caught-up show as zero remaining with no next episode", () => {
    const watched: WatchedMap = {
      1: { 1: "2026-09-02T09:00:00Z", 2: "2026-09-09T09:00:00Z", 3: "2026-09-16T09:00:00Z" },
    };
    const p = computeProgress(sampleEpisodes(), watched, NOW);

    expect(p.remaining).toBe(0);
    expect(p.nextToWatch).toBeNull();
    expect(p.nextAiring?.episode).toBe(4); // still waiting on the next one
  });

  it("never goes negative when the user watched more than the source lists", () => {
    const watched: WatchedMap = { 1: { 1: "x", 2: "x", 3: "x", 4: "x", 9: "x" } };
    const p = computeProgress(sampleEpisodes(), watched, NOW);

    expect(p.remaining).toBe(0);
    expect(p.watched).toBe(5); // honest about what the user recorded
  });

  it("handles a show with no episode data at all", () => {
    const p = computeProgress([], {}, NOW);
    expect(p).toMatchObject({ total: 0, aired: 0, remaining: 0, nextToWatch: null, nextAiring: null });
  });

  it("tracks the latest aired episode for the new-episode notification", () => {
    const p = computeProgress(sampleEpisodes(), {}, NOW);
    expect(p.latestAired?.episode).toBe(3);
  });
});

describe("mostRecentWatchedAt", () => {
  it("returns the newest timestamp across seasons", () => {
    const watched: WatchedMap = {
      1: { 1: "2026-01-01T00:00:00Z" },
      2: { 5: "2026-06-01T00:00:00Z" },
    };
    expect(mostRecentWatchedAt(watched)).toBe(Date.parse("2026-06-01T00:00:00Z"));
  });

  it("returns null when nothing is watched", () => {
    expect(mostRecentWatchedAt({})).toBeNull();
  });

  it("ignores unparseable timestamps", () => {
    expect(mostRecentWatchedAt({ 1: { 1: "not a date" } })).toBeNull();
  });
});

describe("countWatched", () => {
  it("skips specials", () => {
    expect(countWatched({ 0: { 1: "x", 2: "x" }, 1: { 1: "x" } })).toBe(1);
  });
});

describe("seasonMaxEpisodes", () => {
  it("reports the highest episode number per season", () => {
    const max = seasonMaxEpisodes([ep(1, 1, null), ep(1, 8, null), ep(2, 3, null), ep(0, 99, null)]);
    expect(max.get(1)).toBe(8);
    expect(max.get(2)).toBe(3);
    expect(max.has(0)).toBe(false);
  });
});
