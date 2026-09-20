import { describe, expect, it } from "vitest";
import {
  computeProgress,
  countWatched,
  furthestWatchedKey,
  mostRecentWatchedAt,
  seasonMaxEpisodes,
} from "./progress";
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
    const p = computeProgress(sampleEpisodes(), watched, { now: NOW });

    expect(p.total).toBe(5);
    expect(p.aired).toBe(3);
    expect(p.notAired).toBe(2); // the future one AND the undated one
    expect(p.watched).toBe(1);
    expect(p.remaining).toBe(2);
  });

  it("keeps remaining and remainingEpisodes consistent by construction", () => {
    const p = computeProgress(sampleEpisodes(), {}, { now: NOW });
    expect(p.remaining).toBe(p.remainingEpisodes.length);
  });

  it("orders remaining episodes oldest first and exposes the first as nextToWatch", () => {
    const watched: WatchedMap = { 1: { 1: "2026-09-02T09:00:00Z" } };
    const p = computeProgress(sampleEpisodes(), watched, { now: NOW });

    expect(p.remainingEpisodes.map((e) => e.episode)).toEqual([2, 3]);
    expect(p.nextToWatch?.episode).toBe(2);
  });

  it("treats an episode that aired earlier today as already available", () => {
    const earlierToday = "2026-09-20T09:00:00Z"; // NOW is 12:00Z the same day
    const p = computeProgress([ep(1, 1, earlierToday)], {}, { now: NOW });

    expect(p.aired).toBe(1);
    expect(p.remaining).toBe(1);
    expect(p.nextAiring).toBeNull();
  });

  it("picks the soonest future episode as nextAiring, ignoring undated ones", () => {
    const p = computeProgress(sampleEpisodes(), {}, { now: NOW });
    expect(p.nextAiring?.episode).toBe(4);
  });

  it("excludes specials from every count", () => {
    const withSpecial = [...sampleEpisodes(), ep(0, 1, "2026-09-02T20:00:00+03:00")];
    const p = computeProgress(withSpecial, { 0: { 1: "2026-09-03T00:00:00Z" } }, { now: NOW });

    expect(p.total).toBe(5);
    expect(p.watched).toBe(0);
    expect(p.remainingEpisodes.every((e) => e.season !== 0)).toBe(true);
  });

  it("reports a fully caught-up show as zero remaining with no next episode", () => {
    const watched: WatchedMap = {
      1: { 1: "2026-09-02T09:00:00Z", 2: "2026-09-09T09:00:00Z", 3: "2026-09-16T09:00:00Z" },
    };
    const p = computeProgress(sampleEpisodes(), watched, { now: NOW });

    expect(p.remaining).toBe(0);
    expect(p.nextToWatch).toBeNull();
    expect(p.nextAiring?.episode).toBe(4); // still waiting on the next one
  });

  it("never goes negative when the user watched more than the source lists", () => {
    const watched: WatchedMap = { 1: { 1: "x", 2: "x", 3: "x", 4: "x", 9: "x" } };
    const p = computeProgress(sampleEpisodes(), watched, { now: NOW });

    expect(p.remaining).toBe(0);
    expect(p.watched).toBe(5); // honest about what the user recorded
  });

  it("handles a show with no episode data at all", () => {
    const p = computeProgress([], {}, { now: NOW });
    expect(p).toMatchObject({ total: 0, aired: 0, remaining: 0, nextToWatch: null, nextAiring: null });
  });

  it("tracks the latest aired episode for the new-episode notification", () => {
    const p = computeProgress(sampleEpisodes(), {}, { now: NOW });
    expect(p.latestAired?.episode).toBe(3);
  });
});

/**
 * The rule that replaces SIMKL's self-contradicting aired data. SIMKL marks
 * every undated episode `aired: true` while its aggregate count calls the
 * upcoming ones unaired, so neither field can be trusted and position is used
 * instead. See `computeProgress`.
 */
describe("computeProgress with undated episodes", () => {
  it("counts an undated episode as aired when a later one has already aired", () => {
    // The Israeli-show case: TheTVDB lists the episode but not its date, and
    // the broadcast has demonstrably run past it.
    const p = computeProgress(
      [ep(1, 1, "2026-01-01"), ep(1, 2, null), ep(1, 3, "2026-01-15")],
      {},
      { now: NOW },
    );
    expect(p.aired).toBe(3);
    expect(p.notAired).toBe(0);
    expect(p.remainingEpisodes.map((e) => e.episode)).toEqual([1, 2, 3]);
  });

  it("keeps a trailing undated episode unaired, the safe direction", () => {
    // An unannounced upcoming episode. Listing it as remaining would offer an
    // episode that does not exist yet.
    const p = computeProgress([ep(1, 1, "2026-01-01"), ep(1, 2, null)], {}, { now: NOW });
    expect(p.aired).toBe(1);
    expect(p.notAired).toBe(1);
    expect(p.remainingEpisodes.map((e) => e.episode)).toEqual([1]);
  });

  it("does not let a merely announced future episode place an undated one", () => {
    // S01E03 is scheduled but has not aired, so it says nothing about S01E02.
    const p = computeProgress(
      [ep(1, 1, "2026-01-01"), ep(1, 2, null), ep(1, 3, "2026-12-01")],
      {},
      { now: NOW },
    );
    expect(p.notAired).toBe(2);
    expect(p.remainingEpisodes.map((e) => e.episode)).toEqual([1]);
  });

  it("judges position across season boundaries, not within a season", () => {
    const p = computeProgress(
      [ep(1, 1, "2026-01-01"), ep(1, 2, null), ep(2, 1, "2026-02-01")],
      {},
      { now: NOW },
    );
    expect(p.notAired).toBe(0);
  });

  it("treats every undated episode as aired once the series has ended", () => {
    // A finished show has no future episodes, so an undated one is a past one
    // whose date the source never recorded.
    const episodes = [ep(1, 1, null), ep(1, 2, null), ep(1, 3, null)];
    expect(computeProgress(episodes, {}, { now: NOW }).notAired).toBe(3);
    expect(computeProgress(episodes, {}, { now: NOW, seriesEnded: true }).aired).toBe(3);
  });

  it("still respects a real future date on an ended series", () => {
    // `seriesEnded` only settles episodes with no date; a date always wins.
    const p = computeProgress(
      [ep(1, 1, null), ep(1, 2, "2026-12-01")],
      {},
      { now: NOW, seriesEnded: true },
    );
    expect(p.aired).toBe(1);
    expect(p.notAired).toBe(1);
  });

  it("never makes an undated episode the next airing one", () => {
    const p = computeProgress([ep(1, 1, "2026-01-01"), ep(1, 2, null)], {}, { now: NOW });
    expect(p.nextAiring).toBeNull();
  });

  it("never anchors the notification to an undated episode", () => {
    // latestAired drives "a new episode aired", which needs a date to mean
    // anything; the last DATED aired episode is the honest anchor.
    const p = computeProgress(
      [ep(1, 1, "2026-01-01"), ep(1, 2, "2026-01-08"), ep(1, 3, null)],
      {},
      { now: NOW, seriesEnded: true },
    );
    expect(p.aired).toBe(3);
    expect(p.latestAired?.episode).toBe(2);
  });

  it("defaults the clock to now when no options are passed at all", () => {
    const p = computeProgress([ep(1, 1, "2000-01-01")], {});
    expect(p.aired).toBe(1);
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

/**
 * List membership. SIMKL's `next_to_watch` was always "the episode after your
 * furthest watch" and never counted holes, and My List is defined by it.
 */
describe("remainingAfterFurthest", () => {
  const aired = [
    ep(1, 1, "2026-01-01"),
    ep(1, 2, "2026-01-08"),
    ep(1, 3, "2026-01-15"),
    ep(1, 4, "2026-01-22"),
  ];

  it("counts aired episodes after the furthest one watched", () => {
    const p = computeProgress(aired, { 1: { 1: "x", 2: "x" } }, { now: NOW });
    expect(p.remainingAfterFurthest).toBe(2);
    expect(p.remaining).toBe(2);
  });

  it("ignores a hole BEHIND the furthest watch, unlike remaining", () => {
    // Watched 1 and 3: episode 2 is a hole. `remaining` counts it - right for a
    // badge - but it is not a reason to put the show on My List.
    const p = computeProgress(aired, { 1: { 1: "x", 3: "x", 4: "x" } }, { now: NOW });
    expect(p.remaining).toBe(1);
    expect(p.remainingAfterFurthest).toBe(0);
  });

  it("is everything when nothing has been watched, so a show about to start qualifies", () => {
    const p = computeProgress(aired, {}, { now: NOW });
    expect(p.remainingAfterFurthest).toBe(4);
  });

  it("is zero when the history runs past everything the source lists", () => {
    // The renumbering case: 277 watched against a list of 152.
    const p = computeProgress(aired, { 9: { 40: "x" } }, { now: NOW });
    expect(p.remainingAfterFurthest).toBe(0);
  });

  it("counts a new episode after a caught-up history", () => {
    // Lioness: watched through S03E07, S03E08 airs.
    const p = computeProgress([...aired, ep(1, 5, "2026-01-29")], { 1: { 1: "x", 2: "x", 3: "x", 4: "x" } }, { now: NOW });
    expect(p.remainingAfterFurthest).toBe(1);
  });

  it("does not let a special move the furthest mark", () => {
    const p = computeProgress(aired, { 0: { 99: "x" }, 1: { 1: "x" } }, { now: NOW });
    expect(p.remainingAfterFurthest).toBe(3);
  });

  it("crosses season boundaries in broadcast order", () => {
    const eps = [ep(1, 10, "2026-01-01"), ep(2, 1, "2026-02-01"), ep(2, 2, "2026-02-08")];
    const p = computeProgress(eps, { 1: { 10: "x" } }, { now: NOW });
    expect(p.remainingAfterFurthest).toBe(2);
  });
});

describe("furthestWatchedKey", () => {
  it("returns the highest season/episode key", () => {
    expect(furthestWatchedKey({ 1: { 5: "x" }, 2: { 1: "x" } })).toBe(2001);
  });

  it("is null for an empty history and for specials only", () => {
    expect(furthestWatchedKey({})).toBeNull();
    expect(furthestWatchedKey({ 0: { 1: "x" } })).toBeNull();
  });

  it("counts an episode no source lists, which is how a renumbered show looks", () => {
    expect(furthestWatchedKey({ 22: { 40: "x" } })).toBe(22040);
  });
});
