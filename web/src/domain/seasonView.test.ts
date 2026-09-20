import { describe, expect, it } from "vitest";
import { buildSeasonView, defaultOpenSeason } from "./seasonView";
import type { Episode, WatchedMap } from "./types";

const NOW = Date.parse("2026-09-20T12:00:00Z");

function ep(season: number, episode: number, airDate: string | null, title: string | null = null): Episode {
  return { season, episode, airDate, title, runtime: 45 };
}

const EPISODES: Episode[] = [
  ep(0, 1, "2026-01-01", "Behind the scenes"),
  ep(1, 1, "2026-01-01", "Pilot"),
  ep(1, 2, "2026-01-08"),
  ep(1, 3, "2026-01-15"),
  ep(2, 1, "2026-09-01"),
  ep(2, 2, "2026-12-01"), // still to air
];

const WATCHED: WatchedMap = { 1: { 1: "2026-01-02T00:00:00Z", 2: "2026-01-09T00:00:00Z", 3: "x" } };

describe("buildSeasonView", () => {
  it("groups episodes by season in order", () => {
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    expect(view.seasons.map((s) => s.season)).toEqual([1, 2]);
    expect(view.seasons[0]?.episodes.map((e) => e.episode)).toEqual([1, 2, 3]);
  });

  it("keeps specials out of the running order", () => {
    // Every count in the app excludes them, so mixing them in would make the
    // totals read wrong.
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    expect(view.specials.map((e) => e.episode)).toEqual([1]);
    expect(view.total).toBe(5);
  });

  it("marks which episodes are watched and when", () => {
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    const first = view.seasons[0]?.episodes[0];
    expect(first?.watched).toBe(true);
    expect(first?.watchedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("reports an unwatched episode with no timestamp", () => {
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    expect(view.seasons[1]?.episodes[0]).toMatchObject({ watched: false, watchedAt: null });
  });

  it("marks an episode that has not aired, so the row does not invite a click", () => {
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    expect(view.seasons[1]?.episodes.map((e) => e.aired)).toEqual([true, false]);
  });

  it("treats an undated episode as not aired in this view", () => {
    const view = buildSeasonView([ep(1, 1, null)], {}, NOW);
    expect(view.seasons[0]?.episodes[0]?.aired).toBe(false);
  });

  it("counts per season for the header", () => {
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    expect(view.seasons[0]).toMatchObject({ total: 3, watched: 3, aired: 3, complete: true });
    expect(view.seasons[1]).toMatchObject({ total: 2, watched: 0, aired: 1, complete: false });
  });

  it("calls a season complete when every AIRED episode is watched", () => {
    // A season still airing is complete once you are caught up on it.
    const episodes = [ep(1, 1, "2026-01-01"), ep(1, 2, "2026-12-01")];
    const view = buildSeasonView(episodes, { 1: { 1: "x" } }, NOW);
    expect(view.seasons[0]?.complete).toBe(true);
  });

  it("does not call a season with nothing aired complete", () => {
    const view = buildSeasonView([ep(1, 1, "2026-12-01")], {}, NOW);
    expect(view.seasons[0]?.complete).toBe(false);
  });

  it("carries premiere and finale badges", () => {
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    expect(view.seasons[0]?.episodes.map((e) => e.badge)).toEqual([
      "SERIES PREMIERE",
      null,
      "SEASON FINALE",
    ]);
    expect(view.seasons[1]?.episodes[0]?.badge).toBe("SEASON PREMIERE");
  });

  it("shows an episode the history knows about that no source lists", () => {
    // A reconstructed history can point at an episode the source has since
    // renumbered away, and an episode you cannot see is one you cannot un-mark.
    const view = buildSeasonView([ep(1, 1, "2026-01-01")], { 1: { 1: "x", 99: "x" } }, NOW);
    expect(view.seasons[0]?.episodes.map((e) => e.episode)).toEqual([1, 99]);
    expect(view.seasons[0]?.episodes[1]).toMatchObject({ watched: true, aired: false, airDate: null });
  });

  it("shows a whole season only the history knows about", () => {
    const view = buildSeasonView([ep(1, 1, "2026-01-01")], { 4: { 1: "x" } }, NOW);
    expect(view.seasons.map((s) => s.season)).toEqual([1, 4]);
  });

  it("carries the title and runtime through for the row", () => {
    const view = buildSeasonView(EPISODES, WATCHED, NOW);
    expect(view.seasons[0]?.episodes[0]).toMatchObject({ title: "Pilot", runtime: 45 });
  });

  it("totals watched across seasons, specials excluded", () => {
    const view = buildSeasonView(EPISODES, { 0: { 1: "x" }, ...WATCHED }, NOW);
    expect(view.watched).toBe(3);
  });

  it("handles a show with no episode data at all", () => {
    expect(buildSeasonView([], {}, NOW)).toEqual({
      seasons: [],
      specials: [],
      total: 0,
      watched: 0,
    });
  });
});

describe("defaultOpenSeason", () => {
  it("opens the first season with something left", () => {
    expect(defaultOpenSeason(buildSeasonView(EPISODES, WATCHED, NOW))).toBe(2);
  });

  it("opens the last season when everything is watched", () => {
    const watched: WatchedMap = { 1: { 1: "x", 2: "x", 3: "x" }, 2: { 1: "x" } };
    expect(defaultOpenSeason(buildSeasonView(EPISODES, watched, NOW))).toBe(2);
  });

  it("returns null for a show with no seasons", () => {
    expect(defaultOpenSeason(buildSeasonView([], {}, NOW))).toBeNull();
  });
});
