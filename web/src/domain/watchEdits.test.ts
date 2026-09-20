import { describe, expect, it } from "vitest";
import {
  applyPatch,
  isEmptyPatch,
  markAllAired,
  markOne,
  markUpTo,
  unmarkFrom,
  unmarkOne,
  watchedRefs,
} from "./watchEdits";
import type { Episode, WatchedMap } from "./types";

const AT = "2026-09-20T12:00:00.000Z";

function ep(season: number, episode: number, airDate: string | null = "2026-01-01"): Episode {
  return { season, episode, airDate, title: null, runtime: null };
}

/** Two seasons of three, with season 1 fully watched. */
const WATCHED: WatchedMap = {
  1: { 1: "2026-01-01", 2: "2026-01-08", 3: "2026-01-15" },
  2: { 1: "2026-02-01" },
};

const EPISODES: Episode[] = [
  ep(0, 1),
  ep(1, 1),
  ep(1, 2),
  ep(1, 3),
  ep(2, 1),
  ep(2, 2),
  ep(2, 3),
];

describe("watchedRefs", () => {
  it("lists watched episodes in broadcast order", () => {
    expect(watchedRefs(WATCHED).map((r) => `${r.season}x${r.episode}`)).toEqual([
      "1x1",
      "1x2",
      "1x3",
      "2x1",
    ]);
  });

  it("skips specials, which no count includes", () => {
    expect(watchedRefs({ 0: { 1: "x" }, 1: { 1: "x" } })).toEqual([{ season: 1, episode: 1 }]);
  });

  it("handles an empty history", () => {
    expect(watchedRefs({})).toEqual([]);
  });
});

describe("unmarkOne", () => {
  it("removes the episode", () => {
    expect(unmarkOne(WATCHED, { season: 1, episode: 2 })).toEqual({
      add: [],
      remove: [{ season: 1, episode: 2 }],
    });
  });

  it("returns nothing to do for an episode that was not marked", () => {
    // So the caller can skip the write, the timestamp bump, and in SIMKL mode
    // the request for something that was never there.
    expect(isEmptyPatch(unmarkOne(WATCHED, { season: 9, episode: 9 }))).toBe(true);
  });
});

describe("markOne", () => {
  it("adds the episode with the given timestamp", () => {
    expect(markOne(WATCHED, { season: 2, episode: 2 }, AT)).toEqual({
      add: [{ season: 2, episode: 2, watchedAt: AT }],
      remove: [],
    });
  });

  it("does nothing for an episode already watched, keeping its original date", () => {
    expect(isEmptyPatch(markOne(WATCHED, { season: 1, episode: 1 }, AT))).toBe(true);
  });
});

describe("unmarkFrom", () => {
  it("removes the episode and everything after it", () => {
    // "I stopped here" - the correction a reconstructed boundary needs.
    const patch = unmarkFrom(WATCHED, { season: 1, episode: 2 });
    expect(patch.remove.map((r) => `${r.season}x${r.episode}`)).toEqual(["1x2", "1x3", "2x1"]);
    expect(patch.add).toEqual([]);
  });

  it("crosses season boundaries in broadcast order", () => {
    expect(unmarkFrom(WATCHED, { season: 2, episode: 1 }).remove).toEqual([
      { season: 2, episode: 1 },
    ]);
  });

  it("works from the history, not the episode list", () => {
    // It has to be able to clear a mark on an episode no source lists any more,
    // which is exactly what a reconstructed history can leave behind.
    const orphaned: WatchedMap = { 5: { 99: "x" } };
    expect(unmarkFrom(orphaned, { season: 5, episode: 1 }).remove).toEqual([
      { season: 5, episode: 99 },
    ]);
  });

  it("leaves specials alone", () => {
    const withSpecial: WatchedMap = { 0: { 1: "x" }, 1: { 1: "x" } };
    expect(unmarkFrom(withSpecial, { season: 0, episode: 1 }).remove).toEqual([
      { season: 1, episode: 1 },
    ]);
  });

  it("returns nothing to do when there is nothing at or after that point", () => {
    expect(isEmptyPatch(unmarkFrom(WATCHED, { season: 9, episode: 1 }))).toBe(true);
  });
});

describe("markUpTo", () => {
  it("adds every unwatched episode at or before the given one", () => {
    const patch = markUpTo(WATCHED, EPISODES, { season: 2, episode: 3 }, AT);
    expect(patch.add.map((r) => `${r.season}x${r.episode}`)).toEqual(["2x2", "2x3"]);
  });

  it("leaves episodes already watched untouched, so their real date survives", () => {
    // A watch is a fact that happened at a time; re-stamping it loses when.
    const patch = markUpTo(WATCHED, EPISODES, { season: 1, episode: 3 }, AT);
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it("never invents an episode the sources do not list", () => {
    const patch = markUpTo({}, [ep(1, 1)], { season: 5, episode: 20 }, AT);
    expect(patch.add).toEqual([{ season: 1, episode: 1, watchedAt: AT }]);
  });

  it("excludes specials", () => {
    const patch = markUpTo({}, EPISODES, { season: 1, episode: 1 }, AT);
    expect(patch.add).toEqual([{ season: 1, episode: 1, watchedAt: AT }]);
  });

  it("returns the additions in broadcast order", () => {
    const shuffled = [ep(2, 2), ep(1, 1), ep(1, 2)];
    const patch = markUpTo({}, shuffled, { season: 2, episode: 2 }, AT);
    expect(patch.add.map((r) => `${r.season}x${r.episode}`)).toEqual(["1x1", "1x2", "2x2"]);
  });
});

describe("markAllAired", () => {
  it("adds every aired episode not already watched", () => {
    // The one-click fix for a finished show reading as having episodes left
    // because the source numbers it differently from the recorded history.
    const aired = [ep(1, 1), ep(1, 2), ep(1, 3), ep(2, 1), ep(2, 2)];
    const patch = markAllAired(WATCHED, aired, AT);
    expect(patch.add.map((r) => `${r.season}x${r.episode}`)).toEqual(["2x2"]);
  });

  it("does not touch unaired episodes, which remaining never counted", () => {
    const aired = [ep(1, 1)];
    const patch = markAllAired({}, aired, AT);
    expect(patch.add).toHaveLength(1);
  });

  it("does nothing when everything aired is already watched", () => {
    expect(isEmptyPatch(markAllAired(WATCHED, [ep(1, 1), ep(1, 2), ep(1, 3)], AT))).toBe(true);
  });
});

describe("applyPatch", () => {
  it("adds and removes in one pass", () => {
    const next = applyPatch(WATCHED, {
      add: [{ season: 2, episode: 2, watchedAt: AT }],
      remove: [{ season: 1, episode: 1 }],
    });
    expect(next[1]).toEqual({ 2: "2026-01-08", 3: "2026-01-15" });
    expect(next[2]).toEqual({ 1: "2026-02-01", 2: AT });
  });

  it("drops a season left with no episodes rather than keeping an empty object", () => {
    // The map is what gets written to IndexedDB and uploaded to the backup, and
    // {"2":{}} claims season 2 exists in the history when nothing in it does.
    const next = applyPatch(WATCHED, { add: [], remove: [{ season: 2, episode: 1 }] });
    expect(next[2]).toBeUndefined();
    expect(Object.keys(next)).toEqual(["1"]);
  });

  it("does not mutate the map it was given", () => {
    const before = JSON.stringify(WATCHED);
    applyPatch(WATCHED, { add: [{ season: 9, episode: 9, watchedAt: AT }], remove: [] });
    expect(JSON.stringify(WATCHED)).toBe(before);
  });

  it("tolerates removing something that is not there", () => {
    expect(applyPatch(WATCHED, { add: [], remove: [{ season: 9, episode: 9 }] })).toEqual(WATCHED);
  });

  it("applies removals before additions, so re-marking wins", () => {
    const next = applyPatch(WATCHED, {
      add: [{ season: 1, episode: 1, watchedAt: AT }],
      remove: [{ season: 1, episode: 1 }],
    });
    expect(next[1]?.[1]).toBe(AT);
  });

  it("round-trips an unmark then a mark back to a full season", () => {
    const cleared = applyPatch(WATCHED, unmarkFrom(WATCHED, { season: 1, episode: 1 }));
    expect(cleared).toEqual({});
    const restored = applyPatch(cleared, markUpTo(cleared, EPISODES, { season: 1, episode: 3 }, AT));
    expect(Object.keys(restored[1] ?? {})).toEqual(["1", "2", "3"]);
  });
});
