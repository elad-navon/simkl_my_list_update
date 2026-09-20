import { describe, expect, it } from "vitest";
import { averageEpisodeRuntime, estimateRemainingTime, showAverageRuntime } from "./runtime";
import type { Episode } from "./types";

function ep(episode: number, runtime: number | null): Episode {
  return { season: 1, episode, airDate: "2026-01-01", title: null, runtime };
}

describe("showAverageRuntime", () => {
  it("averages TMDB's declared runtimes", () => {
    expect(showAverageRuntime({ episode_run_time: [40, 50] })).toBe(45);
  });

  it("falls back to the last aired episode's runtime", () => {
    expect(showAverageRuntime({ episode_run_time: [], last_episode_to_air: { runtime: 62 } })).toBe(62);
  });

  it("returns 0 when nothing is known", () => {
    expect(showAverageRuntime(null)).toBe(0);
    expect(showAverageRuntime({})).toBe(0);
  });
});

describe("averageEpisodeRuntime", () => {
  it("prefers the show's own average over the caller's fallback", () => {
    expect(averageEpisodeRuntime({ episode_run_time: [30] }, 99)).toBe(30);
  });

  it("uses the fallback when the show knows nothing", () => {
    expect(averageEpisodeRuntime(null, 99)).toBe(99);
  });

  it("returns 0 when neither is available", () => {
    expect(averageEpisodeRuntime(null, null)).toBe(0);
  });
});

describe("estimateRemainingTime", () => {
  it("prices each episode with its own runtime", () => {
    const out = estimateRemainingTime([ep(1, 40), ep(2, 55)], 45);
    expect(out.totalMinutes).toBe(95);
    expect(out.nextEpisodeMinutes).toBe(40);
  });

  it("uses the average only for episodes missing their own runtime", () => {
    const out = estimateRemainingTime([ep(1, 40), ep(2, null)], 45);
    expect(out.totalMinutes).toBe(85);
    expect(out.episodes[1]?.runtime).toBe(45);
  });

  it("returns zero for a fully caught-up show", () => {
    const out = estimateRemainingTime([], 45);
    expect(out.totalMinutes).toBe(0);
    expect(out.episodes).toEqual([]);
  });

  it("falls back to the average for nextEpisodeMinutes when nothing remains", () => {
    expect(estimateRemainingTime([], 45).nextEpisodeMinutes).toBe(45);
  });

  it("never pads: one priced episode per remaining episode, always", () => {
    const remaining = [ep(1, 40), ep(2, null), ep(3, 55)];
    const out = estimateRemainingTime(remaining, 45);
    expect(out.episodes).toHaveLength(remaining.length);
    expect(out.episodes.every((e) => e.season != null && e.episode != null)).toBe(true);
  });
});
