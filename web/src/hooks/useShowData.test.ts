import { describe, expect, it } from "vitest";
import { buildShowData } from "./useShowData";
import type { LoadedEpisodes } from "../api/episodeSources";
import type { Episode } from "../domain/types";

const NOW = Date.parse("2026-09-20T12:00:00Z");

function ep(season: number, episode: number, airDate: string | null, runtime: number | null = 45): Episode {
  return { season, episode, airDate, title: null, runtime };
}

function loaded(over: Partial<LoadedEpisodes> = {}): LoadedEpisodes {
  return {
    episodes: [],
    seriesEnded: false,
    coverage: {
      primaryCount: 0,
      fallbackCount: 0,
      manualCount: 0,
      mergedCount: 0,
      fallbackOnly: 0,
      primaryOnly: 0,
      withBroadcastTime: 0,
    },
    resolved: { tvmaze: null, imdb: null },
    tmdbShow: null,
    sources: { tvmaze: false, tmdb: false },
    ...over,
  };
}

describe("buildShowData", () => {
  it("derives progress from the episode list", () => {
    const data = buildShowData(
      loaded({ episodes: [ep(1, 1, "2026-01-01"), ep(1, 2, "2026-01-08"), ep(1, 3, "2026-12-01")] }),
      [],
      { watched: { 1: { 1: "x" } } },
      NOW,
    );
    expect(data.progress).toMatchObject({ total: 3, aired: 2, watched: 1, remaining: 1 });
    expect(data.progress.nextToWatch?.episode).toBe(2);
  });

  it("prices the remaining episodes for the time-left line", () => {
    const data = buildShowData(
      loaded({ episodes: [ep(1, 1, "2026-01-01", 50), ep(1, 2, "2026-01-08", 40)] }),
      [],
      { watched: {} },
      NOW,
    );
    expect(data.remainingTime.totalMinutes).toBe(90);
    expect(data.remainingTime.nextEpisodeMinutes).toBe(50);
  });

  it("falls back to the show's average runtime where an episode has none", () => {
    const data = buildShowData(
      loaded({
        episodes: [ep(1, 1, "2026-01-01", null)],
        tmdbShow: { episode_run_time: [30] },
      }),
      [],
      { watched: {} },
      NOW,
    );
    expect(data.remainingTime.totalMinutes).toBe(30);
  });

  it("prefers SIMKL's episodes as primary when SIMKL answered", () => {
    // Its dates carry a real broadcast time with an offset, which is the one
    // thing it was ever kept for.
    const data = buildShowData(
      loaded({ episodes: [ep(1, 1, "2026-09-22")] }),
      [ep(1, 1, "2026-09-22T20:00:00+03:00")],
      { watched: {} },
      NOW,
    );
    expect(data.episodes[0]?.airDate).toBe("2026-09-22T20:00:00+03:00");
    expect(data.sources.simkl).toBe(true);
  });

  it("still takes a more precise date from the other source", () => {
    // mergeEpisodes ranks precision above source order, so SIMKL being primary
    // only decides ties.
    const data = buildShowData(
      loaded({ episodes: [ep(1, 1, "2026-09-22T20:00:00+03:00")] }),
      [ep(1, 1, "2026-09-22")],
      { watched: {} },
      NOW,
    );
    expect(data.episodes[0]?.airDate).toBe("2026-09-22T20:00:00+03:00");
  });

  it("keeps episodes SIMKL does not list", () => {
    const data = buildShowData(
      loaded({ episodes: [ep(1, 1, "2026-01-01"), ep(1, 2, "2026-01-08")] }),
      [ep(1, 1, "2026-01-01T20:00:00+02:00")],
      { watched: {} },
      NOW,
    );
    expect(data.episodes).toHaveLength(2);
  });

  it("uses the merged list untouched when SIMKL is off", () => {
    const episodes = [ep(1, 1, "2026-01-01")];
    const data = buildShowData(loaded({ episodes }), [], { watched: {} }, NOW);
    expect(data.episodes).toBe(episodes);
    expect(data.sources.simkl).toBe(false);
  });

  it("passes the ended flag through, which settles undated episodes", () => {
    const withoutFlag = buildShowData(loaded({ episodes: [ep(1, 1, null)] }), [], { watched: {} }, NOW);
    const withFlag = buildShowData(
      loaded({ episodes: [ep(1, 1, null)], seriesEnded: true }),
      [],
      { watched: {} },
      NOW,
    );
    expect(withoutFlag.progress.aired).toBe(0);
    expect(withFlag.progress.aired).toBe(1);
  });

  it("builds the season view from the same list progress was derived from", () => {
    // Two lists would be two truths, which is the whole thing this rewrite ends.
    const data = buildShowData(
      loaded({ episodes: [ep(1, 1, "2026-01-01"), ep(2, 1, "2026-02-01")] }),
      [],
      { watched: { 1: { 1: "x" } } },
      NOW,
    );
    expect(data.seasonView.seasons.map((s) => s.season)).toEqual([1, 2]);
    expect(data.seasonView.watched).toBe(data.progress.watched);
  });

  it("reports which sources answered", () => {
    const data = buildShowData(
      loaded({ sources: { tvmaze: true, tmdb: false } }),
      [ep(1, 1, "2026-01-01")],
      { watched: {} },
      NOW,
    );
    expect(data.sources).toEqual({ tvmaze: true, tmdb: false, simkl: true });
  });

  it("handles a show no source knows anything about", () => {
    const data = buildShowData(loaded(), [], { watched: {} }, NOW);
    expect(data.progress.total).toBe(0);
    expect(data.remainingTime.totalMinutes).toBe(0);
    expect(data.seasonView.seasons).toEqual([]);
  });
});
