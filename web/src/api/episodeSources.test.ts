import { describe, expect, it, vi } from "vitest";
import { loadEpisodes, type EpisodeSourceDeps } from "./episodeSources";
import type { TmdbClient, TmdbSeason, TmdbShow } from "./tmdb";
import type { TvmazeClient, TvmazeEpisode, TvmazeShow } from "./tvmaze";

function fakeTvmaze(over: Partial<TvmazeClient> = {}): TvmazeClient {
  return {
    lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue(null),
    getEpisodes: vi.fn<TvmazeClient["getEpisodes"]>().mockResolvedValue([]),
    searchShows: vi.fn<TvmazeClient["searchShows"]>().mockResolvedValue([]),
    ...over,
  };
}

function fakeTmdb(over: Partial<TmdbClient> = {}): TmdbClient {
  return {
    getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue(null),
    getSeason: vi.fn<TmdbClient["getSeason"]>().mockResolvedValue(null),
    getEpisodeExternalIds: vi.fn<TmdbClient["getEpisodeExternalIds"]>().mockResolvedValue(null),
    getAggregateCredits: vi.fn<TmdbClient["getAggregateCredits"]>().mockResolvedValue(null),
    getPersonExternalIds: vi.fn<TmdbClient["getPersonExternalIds"]>().mockResolvedValue(null),
    searchShows: vi.fn<TmdbClient["searchShows"]>().mockResolvedValue([]),
    ...over,
  };
}

const TVMAZE_SHOW: TvmazeShow = { id: 82, name: "Show", status: "Running" };

const TVMAZE_EPISODES: TvmazeEpisode[] = [
  { season: 1, number: 1, airstamp: "2026-01-01T20:00:00+02:00", runtime: 50, name: "One" },
  { season: 1, number: 2, airstamp: "2026-01-08T20:00:00+02:00", runtime: 50, name: "Two" },
];

const TMDB_SHOW: TmdbShow = {
  id: 1,
  status: "Returning Series",
  seasons: [{ season_number: 0 }, { season_number: 1 }],
  external_ids: { imdb_id: "tt999" },
};

const TMDB_SEASON: TmdbSeason = {
  season_number: 1,
  episodes: [
    { episode_number: 1, air_date: "2026-01-01" },
    { episode_number: 2, air_date: "2026-01-08" },
    { episode_number: 3, air_date: "2026-01-15" },
  ],
};

describe("loadEpisodes", () => {
  it("merges both sources, keeping TVmaze's broadcast timestamps", async () => {
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue(TVMAZE_SHOW),
        getEpisodes: vi.fn<TvmazeClient["getEpisodes"]>().mockResolvedValue(TVMAZE_EPISODES),
      }),
      tmdb: fakeTmdb({
        getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue(TMDB_SHOW),
        getSeason: vi.fn<TmdbClient["getSeason"]>().mockResolvedValue(TMDB_SEASON),
      }),
    };

    const result = await loadEpisodes(deps, { ids: { tmdb: 1, imdb: "tt1" } });

    expect(result.episodes).toHaveLength(3);
    expect(result.episodes[0]?.airDate).toBe("2026-01-01T20:00:00+02:00");
    // The third episode exists only in TMDB, which is exactly the gap a
    // first-source-wins fallback would never notice.
    expect(result.episodes[2]?.airDate).toBe("2026-01-15");
    expect(result.coverage.fallbackOnly).toBe(1);
  });

  it("falls back to TMDB alone for a show TVmaze has never heard of", async () => {
    // 13 of the shows being watched in this library, all Israeli.
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze(),
      tmdb: fakeTmdb({
        getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue(TMDB_SHOW),
        getSeason: vi.fn<TmdbClient["getSeason"]>().mockResolvedValue(TMDB_SEASON),
      }),
    };

    const result = await loadEpisodes(deps, { ids: { tmdb: 1, imdb: "tt1" } });

    expect(result.episodes).toHaveLength(3);
    expect(result.sources).toEqual({ tvmaze: false, tmdb: true });
  });

  it("works with no TMDB key at all", async () => {
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue(TVMAZE_SHOW),
        getEpisodes: vi.fn<TvmazeClient["getEpisodes"]>().mockResolvedValue(TVMAZE_EPISODES),
      }),
      tmdb: null,
    };

    const result = await loadEpisodes(deps, { ids: { tmdb: 1, imdb: "tt1" } });
    expect(result.episodes).toHaveLength(2);
    expect(result.sources.tmdb).toBe(false);
  });

  it("skips the TVmaze lookup when the id was already resolved once", async () => {
    // TVmaze's rate limit is what makes the saved id worth keeping.
    const lookupShow = vi.fn<TvmazeClient["lookupShow"]>();
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow,
        getEpisodes: vi.fn<TvmazeClient["getEpisodes"]>().mockResolvedValue(TVMAZE_EPISODES),
      }),
      tmdb: null,
    };

    const result = await loadEpisodes(deps, { ids: { tvmaze: 82 } });
    expect(lookupShow).not.toHaveBeenCalled();
    expect(result.episodes).toHaveLength(2);
  });

  it("reports the ids worth saving back to the library", async () => {
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue(TVMAZE_SHOW),
      }),
      tmdb: fakeTmdb({ getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue(TMDB_SHOW) }),
    };

    const result = await loadEpisodes(deps, { ids: { tmdb: 1 } });
    expect(result.resolved).toEqual({ tvmaze: 82, imdb: "tt999" });
  });

  it("does not fetch the specials season", async () => {
    const getSeason = vi.fn<TmdbClient["getSeason"]>().mockResolvedValue(TMDB_SEASON);
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze(),
      tmdb: fakeTmdb({ getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue(TMDB_SHOW), getSeason }),
    };

    await loadEpisodes(deps, { ids: { tmdb: 1 } });
    expect(getSeason).toHaveBeenCalledTimes(1);
    expect(getSeason).toHaveBeenCalledWith(1, 1, undefined);
  });

  it("treats a thrown source as a missing one, not as a failed load", async () => {
    // A show with approximate dates still tells you what is left to watch; a
    // show that throws tells you nothing.
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockRejectedValue(new Error("429")),
      }),
      tmdb: fakeTmdb({
        getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue(TMDB_SHOW),
        getSeason: vi.fn<TmdbClient["getSeason"]>().mockResolvedValue(TMDB_SEASON),
      }),
    };

    const result = await loadEpisodes(deps, { ids: { tmdb: 1, imdb: "tt1" } });
    expect(result.episodes).toHaveLength(3);
    expect(result.sources.tvmaze).toBe(false);
  });

  it("returns an empty list when every source fails", async () => {
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockRejectedValue(new Error("down")),
      }),
      tmdb: fakeTmdb({ getShow: vi.fn<TmdbClient["getShow"]>().mockRejectedValue(new Error("down")) }),
    };

    const result = await loadEpisodes(deps, { ids: { tmdb: 1, imdb: "tt1" } });
    expect(result.episodes).toEqual([]);
    expect(result.sources).toEqual({ tvmaze: false, tmdb: false });
  });

  it("marks the series ended when either source says so", async () => {
    const endedOnTvmaze: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue({ id: 1, status: "Ended" }),
      }),
      tmdb: fakeTmdb({
        getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue({ status: "Returning Series" }),
      }),
    };
    expect((await loadEpisodes(endedOnTvmaze, { ids: { tmdb: 1 } })).seriesEnded).toBe(true);

    const endedOnTmdb: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue({ id: 1, status: "Running" }),
      }),
      tmdb: fakeTmdb({ getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue({ status: "Ended" }) }),
    };
    expect((await loadEpisodes(endedOnTmdb, { ids: { tmdb: 1 } })).seriesEnded).toBe(true);
  });

  it("is not ended while both sources say the show is running", async () => {
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue({ id: 1, status: "Running" }),
      }),
      tmdb: fakeTmdb({
        getShow: vi.fn<TmdbClient["getShow"]>().mockResolvedValue({ status: "Returning Series" }),
      }),
    };
    expect((await loadEpisodes(deps, { ids: { tmdb: 1 } })).seriesEnded).toBe(false);
  });

  it("folds in manual episodes neither source lists", async () => {
    const deps: EpisodeSourceDeps = {
      tvmaze: fakeTvmaze({
        lookupShow: vi.fn<TvmazeClient["lookupShow"]>().mockResolvedValue(TVMAZE_SHOW),
        getEpisodes: vi.fn<TvmazeClient["getEpisodes"]>().mockResolvedValue(TVMAZE_EPISODES),
      }),
      tmdb: null,
    };

    const result = await loadEpisodes(deps, {
      ids: { tvmaze: 82 },
      manualEpisodes: [
        { season: 1, episode: 3, airDate: "2026-01-15", title: "Aired last night", runtime: null },
      ],
    });

    expect(result.episodes).toHaveLength(3);
    expect(result.coverage.manualCount).toBe(1);
  });
});
