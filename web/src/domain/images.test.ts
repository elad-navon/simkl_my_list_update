import { describe, expect, it } from "vitest";
import { computeImages, type TmdbImageSource } from "./images";

const BASES = { poster: "P/", backdrop: "B/" };

const img = (file_path: string, iso_639_1: string | null) => ({ file_path, iso_639_1 });

function source(over: Partial<TmdbImageSource> = {}): TmdbImageSource {
  return {
    images: {
      posters: [img("/en.jpg", "en"), img("/none.jpg", null), img("/he.jpg", "he")],
      backdrops: [img("/bd-en.jpg", "en")],
    },
    poster_path: "/none.jpg",
    backdrop_path: "/bd-en.jpg",
    ...over,
  };
}

describe("computeImages", () => {
  it("keeps English and language-less artwork, dropping foreign text", () => {
    const out = computeImages(source(), BASES);
    expect(out.posterPaths).toEqual(["/en.jpg", "/none.jpg"]);
  });

  it("falls back to Hebrew only when there is no English or language-less option", () => {
    const out = computeImages(
      source({ images: { posters: [img("/he.jpg", "he")], backdrops: [] }, poster_path: "/he.jpg" }),
      BASES,
    );
    expect(out.posterPaths).toEqual(["/he.jpg"]);
    expect(out.posterUrl).toBe("P//he.jpg");
  });

  it("decides posters and backdrops independently", () => {
    const out = computeImages(
      source({
        images: { posters: [img("/en.jpg", "en")], backdrops: [img("/bd-he.jpg", "he")] },
        poster_path: "/en.jpg",
        backdrop_path: "/bd-he.jpg",
      }),
      BASES,
    );
    expect(out.posterPaths).toEqual(["/en.jpg"]);
    expect(out.backdropPaths).toEqual(["/bd-he.jpg"]);
  });

  it("starts from TMDB's primary pick when it survived the language filter", () => {
    const out = computeImages(source(), BASES);
    expect(out.posterIndex).toBe(1);
    expect(out.posterUrl).toBe("P//none.jpg");
  });

  it("starts at the front of the list when the primary pick was filtered out", () => {
    const out = computeImages(source({ poster_path: "/he.jpg" }), BASES);
    expect(out.posterIndex).toBe(0);
    expect(out.posterUrl).toBe("P//en.jpg");
  });

  it("lets a saved override outrank TMDB's pick", () => {
    const out = computeImages(source(), BASES, { posterPath: "/en.jpg" });
    expect(out.posterIndex).toBe(0);
    expect(out.posterUrl).toBe("P//en.jpg");
  });

  it("ignores a stale override whose path the show no longer has", () => {
    const out = computeImages(source(), BASES, { posterPath: "/deleted.jpg" });
    expect(out.posterUrl).toBe("P//none.jpg");
  });

  it("returns empty output for a show with no detail at all", () => {
    expect(computeImages(null, BASES)).toMatchObject({
      posterUrl: null,
      bannerUrl: null,
      posterPaths: [],
      backdropPaths: [],
    });
  });

  it("returns a null url, not a broken one, when a show has no artwork", () => {
    const out = computeImages(source({ images: { posters: [], backdrops: [] } }), BASES);
    expect(out.posterUrl).toBeNull();
    expect(out.bannerUrl).toBeNull();
  });
});
