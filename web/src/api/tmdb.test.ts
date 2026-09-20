import { describe, expect, it, vi } from "vitest";
import {
  createTmdbClient,
  normalizeTmdbSeasons,
  regularSeasonNumbers,
  tmdbSearchResultToSummary,
  tmdbSeriesEnded,
  TMDB_IMAGE_BASES,
} from "./tmdb";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("normalizeTmdbSeasons", () => {
  it("flattens seasons into a flat episode list", () => {
    const episodes = normalizeTmdbSeasons([
      { season_number: 1, episodes: [{ episode_number: 1 }, { episode_number: 2 }] },
      { season_number: 2, episodes: [{ episode_number: 1 }] },
    ]);
    expect(episodes.map((e) => `${e.season}x${e.episode}`)).toEqual(["1x1", "1x2", "2x1"]);
  });

  it("takes the episode's own season number over the season wrapper's", () => {
    const episodes = normalizeTmdbSeasons([
      { season_number: 1, episodes: [{ episode_number: 1, season_number: 5 }] },
    ]);
    expect(episodes[0]?.season).toBe(5);
  });

  it("keeps a bare date bare, so it is never mistaken for a broadcast time", () => {
    const episodes = normalizeTmdbSeasons([
      { season_number: 1, episodes: [{ episode_number: 1, air_date: "2026-09-22" }] },
    ]);
    expect(episodes[0]?.airDate).toBe("2026-09-22");
  });

  it("discards TMDB's placeholder Episode N titles", () => {
    const episodes = normalizeTmdbSeasons([
      {
        season_number: 1,
        episodes: [
          { episode_number: 1, name: "Episode 1" },
          { episode_number: 2, name: "The Real Title" },
        ],
      },
    ]);
    expect(episodes.map((e) => e.title)).toEqual([null, "The Real Title"]);
  });

  it("carries the per-episode runtime", () => {
    const episodes = normalizeTmdbSeasons([
      { season_number: 1, episodes: [{ episode_number: 1, runtime: 47 }] },
    ]);
    expect(episodes[0]?.runtime).toBe(47);
  });

  it("turns an empty air_date into null rather than an empty string", () => {
    const episodes = normalizeTmdbSeasons([
      { season_number: 1, episodes: [{ episode_number: 1, air_date: "" }] },
    ]);
    expect(episodes[0]?.airDate).toBeNull();
  });

  it("skips an episode with no number and tolerates a null season", () => {
    const episodes = normalizeTmdbSeasons([
      null,
      { season_number: 1, episodes: [{ name: "no number" }, { episode_number: 3 }] },
    ]);
    expect(episodes.map((e) => e.episode)).toEqual([3]);
  });
});

describe("regularSeasonNumbers", () => {
  it("lists every season except specials", () => {
    expect(
      regularSeasonNumbers({ seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }] }),
    ).toEqual([1, 2]);
  });

  it("returns nothing for a show with no season list", () => {
    expect(regularSeasonNumbers(null)).toEqual([]);
    expect(regularSeasonNumbers({})).toEqual([]);
  });
});

describe("tmdbSeriesEnded", () => {
  it("recognises the statuses that settle undated episodes", () => {
    expect(tmdbSeriesEnded({ status: "Ended" })).toBe(true);
    expect(tmdbSeriesEnded({ status: "Canceled" })).toBe(true);
    expect(tmdbSeriesEnded({ status: "Returning Series" })).toBe(false);
    expect(tmdbSeriesEnded(null)).toBe(false);
  });
});

describe("tmdbSearchResultToSummary", () => {
  it("normalizes a result to the shape the search UI uses", () => {
    expect(
      tmdbSearchResultToSummary({
        id: 1399,
        name: "Game of Thrones",
        first_air_date: "2011-04-17",
        poster_path: "/abc.jpg",
      }),
    ).toEqual({
      title: "Game of Thrones",
      year: "2011",
      posterUrl: `${TMDB_IMAGE_BASES.poster}/abc.jpg`,
      ids: { tmdb: 1399 },
    });
  });

  it("falls back to the original name, then to Unknown", () => {
    expect(tmdbSearchResultToSummary({ id: 1, original_name: "שמש" }).title).toBe("שמש");
    expect(tmdbSearchResultToSummary({ id: 1 }).title).toBe("Unknown");
  });

  it("leaves the poster null rather than building a broken url", () => {
    expect(tmdbSearchResultToSummary({ id: 1 }).posterUrl).toBeNull();
  });
});

describe("createTmdbClient", () => {
  it("appends images, external ids and content ratings to the show request", async () => {
    // One request instead of four, which is how the old app kept per-show work
    // to a single fetch.
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: 1 }));
    await createTmdbClient({ apiKey: "k", fetchImpl }).getShow(1);

    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("append_to_response=images%2Cexternal_ids%2Ccontent_ratings");
    expect(url).toContain("include_image_language=en%2Cnull%2Che");
    expect(url).toContain("api_key=k");
  });

  it("asks for Hebrew titles when searching", async () => {
    // SIMKL could not handle Hebrew queries at all; TMDB now carries that case
    // by itself.
    const fetchImpl = vi.fn().mockResolvedValue(json({ results: [{ id: 1 }] }));
    await createTmdbClient({ apiKey: "k", fetchImpl }).searchShows("פאודה");

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("language=he-IL");
  });

  it("returns an empty list for a search that matched nothing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(createTmdbClient({ apiKey: "k", fetchImpl }).searchShows("x")).resolves.toEqual([]);
  });

  it("uses aggregate_credits so long-running cast still rank first", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}));
    await createTmdbClient({ apiKey: "k", fetchImpl }).getAggregateCredits(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/tv/1/aggregate_credits");
  });

  it("returns null for a show TMDB does not have", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(createTmdbClient({ apiKey: "k", fetchImpl }).getShow(1)).resolves.toBeNull();
  });
});
