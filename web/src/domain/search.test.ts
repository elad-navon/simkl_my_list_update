import { describe, expect, it } from "vitest";
import { matchAgainstLibrary, mergeSearchResults, statusLabel, type SearchResult } from "./search";
import { emptyLibrary, type Library, type LibraryShow } from "../library/schema";

function result(over: Partial<SearchResult> = {}): SearchResult {
  return { title: "Show", year: "2020", posterUrl: null, ids: { tmdb: 1 }, source: "tmdb", ...over };
}

function libraryWith(shows: Partial<LibraryShow>[]): Library {
  const library = emptyLibrary();
  for (const [i, over] of shows.entries()) {
    const key = over.key ?? `tmdb:${i}`;
    library.shows[key] = {
      key,
      ids: { tmdb: i },
      title: "Existing",
      status: "watching",
      watched: {},
      addedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...over,
    };
  }
  return library;
}

describe("mergeSearchResults", () => {
  it("keeps both sources' results, SIMKL's first", () => {
    // Each list arrives in its own relevance order, so they are concatenated
    // rather than re-ranked against each other.
    const merged = mergeSearchResults(
      [result({ title: "From SIMKL", ids: { simkl: 9, tmdb: 5 }, source: "simkl" })],
      [result({ title: "From TMDB", ids: { tmdb: 7 } })],
    );
    expect(merged.map((r) => r.title)).toEqual(["From SIMKL", "From TMDB"]);
  });

  it("drops a TMDB result SIMKL already covered", () => {
    const merged = mergeSearchResults(
      [result({ title: "SIMKL copy", ids: { simkl: 9, tmdb: 5 }, source: "simkl" })],
      [result({ title: "TMDB copy", ids: { tmdb: 5 } })],
    );
    expect(merged).toHaveLength(1);
    // SIMKL's wins because it carries the richer id set, and more ids means more
    // ways to find the show's episodes later.
    expect(merged[0]?.ids).toEqual({ simkl: 9, tmdb: 5 });
  });

  it("keeps a result with no TMDB id rather than treating them as one", () => {
    const merged = mergeSearchResults(
      [
        result({ title: "A", ids: { simkl: 1 }, source: "simkl" }),
        result({ title: "B", ids: { simkl: 2 }, source: "simkl" }),
      ],
      [],
    );
    expect(merged).toHaveLength(2);
  });

  it("deduplicates within one source too", () => {
    const merged = mergeSearchResults([], [result({ ids: { tmdb: 1 } }), result({ ids: { tmdb: 1 } })]);
    expect(merged).toHaveLength(1);
  });

  it("handles either side being empty", () => {
    expect(mergeSearchResults([], [])).toEqual([]);
    expect(mergeSearchResults([result()], [])).toHaveLength(1);
  });
});

describe("matchAgainstLibrary", () => {
  it("reports the status a show already has", () => {
    // This used to be five network requests per query.
    const matched = matchAgainstLibrary(
      [result({ ids: { tmdb: 3 } })],
      libraryWith([{ key: "tmdb:3", ids: { tmdb: 3 }, status: "completed" }]),
    );
    expect(matched[0]).toMatchObject({ libraryStatus: "completed", libraryKey: "tmdb:3" });
  });

  it("reports null for a show that is not on the list", () => {
    const matched = matchAgainstLibrary([result({ ids: { tmdb: 99 } })], libraryWith([]));
    expect(matched[0]).toMatchObject({ libraryStatus: null, libraryKey: null });
  });

  it("matches through any shared id, not just TMDB", () => {
    const matched = matchAgainstLibrary(
      [result({ ids: { imdb: "tt42" } })],
      libraryWith([{ key: "imdb:tt42", ids: { imdb: "tt42" }, status: "hold" }]),
    );
    expect(matched[0]?.libraryStatus).toBe("hold");
  });

  it("does not match two shows that merely share a title", () => {
    // "The Office" the American one and "The Office" the British one.
    const matched = matchAgainstLibrary(
      [result({ title: "The Office", ids: { tmdb: 2316 } })],
      libraryWith([{ key: "tmdb:4805", ids: { tmdb: 4805 }, title: "The Office" }]),
    );
    expect(matched[0]?.libraryStatus).toBeNull();
  });

  it("does not match on an id space the two do not share", () => {
    const matched = matchAgainstLibrary(
      [result({ ids: { tmdb: 1 } })],
      libraryWith([{ key: "imdb:tt1", ids: { imdb: "tt1" } }]),
    );
    expect(matched[0]?.libraryStatus).toBeNull();
  });

  it("keeps every result, annotated rather than filtered", () => {
    const matched = matchAgainstLibrary(
      [result({ ids: { tmdb: 0 } }), result({ ids: { tmdb: 99 } })],
      libraryWith([{ key: "tmdb:0", ids: { tmdb: 0 } }]),
    );
    expect(matched).toHaveLength(2);
    expect(matched.map((m) => m.libraryStatus)).toEqual(["watching", null]);
  });
});

describe("statusLabel", () => {
  it("gives the label the old menu used", () => {
    expect(statusLabel("plantowatch")).toBe("Plan to Watch");
    expect(statusLabel("hold")).toBe("On Hold");
  });
});
