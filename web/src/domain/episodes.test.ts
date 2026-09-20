import { describe, expect, it } from "vitest";
import { describeCoverage, mergeEpisodes } from "./episodes";
import type { Episode } from "./types";

function ep(season: number, episode: number, over: Partial<Episode> = {}): Episode {
  return { season, episode, airDate: null, title: null, runtime: null, ...over };
}

describe("mergeEpisodes", () => {
  it("returns the primary list when it is the only source", () => {
    const primary = [ep(1, 2), ep(1, 1)];
    expect(mergeEpisodes({ primary }).map((e) => e.episode)).toEqual([1, 2]);
  });

  it("sorts by season and episode, which the progress rule depends on", () => {
    const merged = mergeEpisodes({ primary: [ep(2, 1), ep(1, 10), ep(1, 2)] });
    expect(merged.map((e) => `${e.season}x${e.episode}`)).toEqual(["1x2", "1x10", "2x1"]);
  });

  it("adds episodes only the fallback knows about", () => {
    // TVmaze's blind spots: whole Israeli shows, or seasons it never listed.
    const merged = mergeEpisodes({
      primary: [ep(1, 1)],
      fallback: [ep(1, 1), ep(1, 2), ep(1, 3)],
    });
    expect(merged).toHaveLength(3);
  });

  it("keeps an episode only the primary knows about", () => {
    // Usually next week's, which TVmaze lists before TMDB does.
    const merged = mergeEpisodes({ primary: [ep(1, 1), ep(1, 2)], fallback: [ep(1, 1)] });
    expect(merged).toHaveLength(2);
  });

  it("prefers a real broadcast timestamp over a bare date", () => {
    const merged = mergeEpisodes({
      primary: [ep(1, 1, { airDate: "2026-09-22T20:00:00+03:00" })],
      fallback: [ep(1, 1, { airDate: "2026-09-22" })],
    });
    expect(merged[0]?.airDate).toBe("2026-09-22T20:00:00+03:00");
  });

  it("takes a timestamp from the fallback over a bare date from the primary", () => {
    // Precision outranks source priority: only a timestamp with an offset can
    // support a "Today" label that does not drift across timezones.
    const merged = mergeEpisodes({
      primary: [ep(1, 1, { airDate: "2026-09-22" })],
      fallback: [ep(1, 1, { airDate: "2026-09-22T20:00:00+03:00" })],
    });
    expect(merged[0]?.airDate).toBe("2026-09-22T20:00:00+03:00");
  });

  it("fills a missing date from whichever source has one", () => {
    const merged = mergeEpisodes({
      primary: [ep(1, 1)],
      fallback: [ep(1, 1, { airDate: "2026-09-22" })],
    });
    expect(merged[0]?.airDate).toBe("2026-09-22");
  });

  it("keeps the primary's date when both are equally precise", () => {
    const merged = mergeEpisodes({
      primary: [ep(1, 1, { airDate: "2026-09-22" })],
      fallback: [ep(1, 1, { airDate: "2026-09-29" })],
    });
    expect(merged[0]?.airDate).toBe("2026-09-22");
  });

  it("fills a missing title and runtime from the fallback", () => {
    const merged = mergeEpisodes({
      primary: [ep(1, 1)],
      fallback: [ep(1, 1, { title: "Pilot", runtime: 42 })],
    });
    expect(merged[0]).toMatchObject({ title: "Pilot", runtime: 42 });
  });

  it("does not let the fallback overwrite a title the primary has", () => {
    const merged = mergeEpisodes({
      primary: [ep(1, 1, { title: "Pilot", runtime: 42 })],
      fallback: [ep(1, 1, { title: "Episode 1", runtime: 60 })],
    });
    expect(merged[0]).toMatchObject({ title: "Pilot", runtime: 42 });
  });

  it("adds a manual episode neither source lists", () => {
    // The replacement for the one thing SIMKL did better: knowing about a
    // brand-new episode first.
    const merged = mergeEpisodes({
      primary: [ep(1, 1)],
      manual: [ep(1, 2, { airDate: "2026-09-29", title: "Typed by hand" })],
    });
    expect(merged.map((e) => e.episode)).toEqual([1, 2]);
    expect(merged[1]?.title).toBe("Typed by hand");
  });

  it("lets a real source supersede a manual entry once it appears", () => {
    // A manual entry is a stopgap for an absence; it should stop mattering the
    // moment the absence ends, not pin a hand-typed date in place for good.
    const merged = mergeEpisodes({
      primary: [ep(1, 1, { airDate: "2026-09-29T21:00:00+03:00", title: "Real" })],
      manual: [ep(1, 1, { airDate: "2026-09-30", title: "Guessed" })],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ title: "Real", airDate: "2026-09-29T21:00:00+03:00" });
  });

  it("does not deduplicate across seasons that share an episode number", () => {
    const merged = mergeEpisodes({ primary: [ep(1, 1), ep(2, 1), ep(3, 1)] });
    expect(merged).toHaveLength(3);
  });

  it("keeps specials for the domain layer to exclude, rather than dropping them", () => {
    const merged = mergeEpisodes({ primary: [ep(0, 1), ep(1, 1)] });
    expect(merged.map((e) => e.season)).toEqual([0, 1]);
  });

  it("handles no sources at all", () => {
    expect(mergeEpisodes({})).toEqual([]);
  });
});

describe("describeCoverage", () => {
  it("counts what each source contributed", () => {
    const coverage = describeCoverage({
      primary: [ep(1, 1, { airDate: "2026-01-01T20:00:00+02:00" }), ep(1, 2)],
      fallback: [ep(1, 1), ep(1, 3)],
      manual: [ep(1, 4)],
    });
    expect(coverage).toEqual({
      primaryCount: 2,
      fallbackCount: 2,
      manualCount: 1,
      mergedCount: 4,
      fallbackOnly: 1,
      primaryOnly: 1,
      withBroadcastTime: 1,
    });
  });

  it("reports a show TVmaze does not carry at all", () => {
    const coverage = describeCoverage({ fallback: [ep(1, 1, { airDate: "2026-01-01" })] });
    expect(coverage).toMatchObject({ primaryCount: 0, fallbackOnly: 1, withBroadcastTime: 0 });
  });
});
