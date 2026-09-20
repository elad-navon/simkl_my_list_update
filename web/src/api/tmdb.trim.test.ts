import { describe, expect, it } from "vitest";
import { trimTmdbShow, type TmdbShow } from "./tmdb";
import { computeImages } from "../domain/images";
import { extractContentRating, extractGenreLabel } from "../domain/metadata";
import { latestNetwork } from "../domain/networks";
import { averageEpisodeRuntime } from "../domain/runtime";
import { regularSeasonNumbers } from "./tmdb";

/**
 * A response shaped like TMDB's, with the bulk it really sends.
 *
 * Cast through `unknown` because the narrow types in tmdb.ts model only the fields
 * this app reads - which is the whole point of the projection under test, so the
 * fixture has to carry fields those types deliberately do not know about.
 */
function fullShow(): TmdbShow & Record<string, unknown> {
  return {
    id: 1416,
    name: "Grey's Anatomy",
    original_name: "Grey's Anatomy",
    first_air_date: "2005-03-27",
    last_air_date: "2026-05-15",
    status: "Returning Series",
    poster_path: "/p3.jpg",
    backdrop_path: "/b1.jpg",
    episode_run_time: [43],
    last_episode_to_air: { runtime: 41, overview: "a long overview".repeat(20), name: "Finale" },
    seasons: Array.from({ length: 21 }, (_unused, i) => ({
      season_number: i,
      episode_count: 24,
      overview: "season overview".repeat(20),
      poster_path: `/s${i}.jpg`,
    })),
    networks: [{ name: "ABC", logo_path: "/abc.png", origin_country: "US", id: 2 }],
    genres: [{ name: "Drama", id: 18 }],
    external_ids: { imdb_id: "tt0413573", tvdb_id: 73762, facebook_id: "greys" },
    content_ratings: {
      results: [
        { iso_3166_1: "DE", rating: "" },
        { iso_3166_1: "US", rating: "TV-14" },
      ],
    },
    images: {
      posters: Array.from({ length: 300 }, (_unused, i) => ({
        file_path: `/p${i}.jpg`,
        iso_639_1: "en",
        vote_average: 5,
      })),
      backdrops: Array.from({ length: 200 }, (_unused, i) => ({
        file_path: `/b${i}.jpg`,
        iso_639_1: null,
      })),
    },
    overview: "a very long show overview".repeat(50),
    production_companies: [{ name: "ABC Studios", logo_path: "/x.png", id: 1 }],
    spoken_languages: [{ english_name: "English", iso_639_1: "en" }],
    tagline: "It's a beautiful day to save lives",
  } as unknown as TmdbShow & Record<string, unknown>;
}

const sizeKb = (value: unknown) => JSON.stringify(value ?? null).length / 1024;

describe("trimTmdbShow", () => {
  it("drops the bulk the app never reads", () => {
    // The reason this exists: the raw response is a wire format, and caching a
    // wire format is what made the page crawl while the requests were healthy.
    const full = fullShow();
    const trimmed = trimTmdbShow(full) as Record<string, unknown>;

    expect(trimmed["overview"]).toBeUndefined();
    expect(trimmed["tagline"]).toBeUndefined();
    expect(trimmed["production_companies"]).toBeUndefined();
    expect(trimmed["spoken_languages"]).toBeUndefined();
    expect(sizeKb(trimmed)).toBeLessThan(sizeKb(full) / 4);
  });

  it("caps the artwork lists, which are the largest part", () => {
    const trimmed = trimTmdbShow(fullShow());
    expect(trimmed?.images?.posters?.length).toBe(12);
    expect(trimmed?.images?.backdrops?.length).toBe(12);
  });

  it("keeps TMDB's own primary pick even when it falls outside the cap", () => {
    // Otherwise computeImages falls back to the front of the list and the card
    // shows different artwork - a visible change caused by a cache optimisation.
    const full = fullShow();
    full.poster_path = "/p250.jpg";
    const trimmed = trimTmdbShow(full);

    const paths = trimmed?.images?.posters?.map((p) => p.file_path);
    expect(paths).toContain("/p250.jpg");
    expect(paths).toHaveLength(12);
  });

  it("leaves everything computeImages needs intact", () => {
    const trimmed = trimTmdbShow(fullShow());
    const images = computeImages(trimmed, { poster: "P/", backdrop: "B/" });

    expect(images.posterUrl).toBe("P//p3.jpg");
    expect(images.bannerUrl).toBe("B//b1.jpg");
    expect(images.posterPaths.length).toBeGreaterThan(1);
  });

  it("leaves the metadata extractors working", () => {
    const trimmed = trimTmdbShow(fullShow());
    expect(extractContentRating(trimmed?.content_ratings)).toBe("TV-14");
    expect(extractGenreLabel(trimmed?.genres)).toBe("Drama");
    expect(latestNetwork(trimmed?.networks)?.name).toBe("ABC");
    expect(averageEpisodeRuntime(trimmed, null)).toBe(43);
  });

  it("keeps the season numbers, which decide what gets fetched", () => {
    const trimmed = trimTmdbShow(fullShow());
    expect(regularSeasonNumbers(trimmed)).toEqual(
      Array.from({ length: 20 }, (_unused, i) => i + 1),
    );
  });

  it("keeps only the runtime of the last aired episode", () => {
    const trimmed = trimTmdbShow(fullShow()) as { last_episode_to_air?: Record<string, unknown> };
    expect(trimmed.last_episode_to_air).toEqual({ runtime: 41 });
  });

  it("drops content ratings with no rating in them", () => {
    // TMDB returns one per country and most are empty.
    const trimmed = trimTmdbShow(fullShow());
    expect(trimmed?.content_ratings?.results).toEqual([{ iso_3166_1: "US", rating: "TV-14" }]);
  });

  it("keeps the ids the app identifies a show by", () => {
    const trimmed = trimTmdbShow(fullShow());
    expect(trimmed?.external_ids).toEqual({ imdb_id: "tt0413573", tvdb_id: 73762 });
  });

  it("handles a show with nothing optional set", () => {
    expect(trimTmdbShow({ id: 1 })).toMatchObject({ id: 1, name: null, status: null });
  });

  it("passes null through", () => {
    expect(trimTmdbShow(null)).toBeNull();
  });
});
