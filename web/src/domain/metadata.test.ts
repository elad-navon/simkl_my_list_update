import { describe, expect, it } from "vitest";
import { extractContentRating, extractGenreLabel, joinGenreNames, yearRangeLabel } from "./metadata";

describe("extractContentRating", () => {
  it("prefers the US rating", () => {
    const ratings = { results: [{ iso_3166_1: "GB", rating: "15" }, { iso_3166_1: "US", rating: "TV-MA" }] };
    expect(extractContentRating(ratings)).toBe("TV-MA");
  });

  it("falls back to any country with a non-empty rating", () => {
    const ratings = { results: [{ iso_3166_1: "IL", rating: "" }, { iso_3166_1: "GB", rating: "15" }] };
    expect(extractContentRating(ratings)).toBe("15");
  });

  it("returns null when nothing is rated", () => {
    expect(extractContentRating({ results: [] })).toBeNull();
    expect(extractContentRating(null)).toBeNull();
  });
});

describe("joinGenreNames", () => {
  it("returns a single genre as-is", () => {
    expect(joinGenreNames(["Drama"])).toBe("Drama");
  });

  it("joins two with 'and'", () => {
    expect(joinGenreNames(["Drama", "Crime"])).toBe("Drama and Crime");
  });

  it("comma-separates all but the last", () => {
    expect(joinGenreNames(["Action & Adventure", "Drama", "Crime"])).toBe(
      "Action & Adventure, Drama and Crime",
    );
  });

  it("returns null for an empty list", () => {
    expect(joinGenreNames([])).toBeNull();
  });
});

describe("extractGenreLabel", () => {
  it("drops genres with no name", () => {
    expect(extractGenreLabel([{ name: "Drama" }, { name: null }])).toBe("Drama");
  });

  it("returns null when there are no genres", () => {
    expect(extractGenreLabel([])).toBeNull();
    expect(extractGenreLabel(null)).toBeNull();
  });
});

describe("yearRangeLabel", () => {
  it("closes the range once the show has ended", () => {
    expect(yearRangeLabel("2016-09-01", "2019-05-20", true)).toBe("2016-2019");
  });

  it("leaves it open while the show is still running", () => {
    expect(yearRangeLabel("2016-09-01", "2026-05-20", false)).toBe("2016-");
  });

  it("still reads as finished when the final year is unknown", () => {
    // Better than silently reading as ongoing.
    expect(yearRangeLabel("2016-09-01", null, true)).toBe("2016-");
  });

  it("is null without a start year, rather than a bare dash", () => {
    expect(yearRangeLabel(null, "2019-01-01", true)).toBeNull();
    expect(yearRangeLabel("", null, false)).toBeNull();
  });
});
