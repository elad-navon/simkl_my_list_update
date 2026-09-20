import { describe, expect, it } from "vitest";
import { normalizeSimklEpisodes, type SimklApiEpisode } from "./simklEpisodes";

describe("normalizeSimklEpisodes", () => {
  it("maps season, episode, date and title across", () => {
    const eps = normalizeSimklEpisodes([
      { season: 1, episode: 1, date: "1997-03-10T19:00:00-05:00", title: "Welcome to the Hellmouth" },
    ]);
    expect(eps).toEqual([
      {
        season: 1,
        episode: 1,
        airDate: "1997-03-10T19:00:00-05:00",
        title: "Welcome to the Hellmouth",
        runtime: null,
      },
    ]);
  });

  it("keeps SIMKL's full offset-bearing timestamp intact", () => {
    // The whole reason the old app preferred SIMKL over TMDB for air times.
    const [ep] = normalizeSimklEpisodes([{ season: 2, episode: 3, date: "2026-09-22T20:00:00+03:00" }]);
    expect(ep?.airDate).toBe("2026-09-22T20:00:00+03:00");
  });

  it("drops an unnumbered special, which is how SIMKL ships them", () => {
    const payload: SimklApiEpisode[] = [
      { type: "special", title: "Behind the scenes", aired: true },
      { season: 1, episode: 1, date: "2026-01-01" },
    ];
    expect(normalizeSimklEpisodes(payload).map((e) => e.episode)).toEqual([1]);
  });

  it("keeps a numbered season-0 episode for the domain layer to exclude", () => {
    // Filtering specials is `computeProgress`'s job, done at one place; this
    // only drops entries that carry no numbering at all.
    const eps = normalizeSimklEpisodes([{ season: 0, episode: 1, date: "2026-01-01" }]);
    expect(eps).toHaveLength(1);
    expect(eps[0]?.season).toBe(0);
  });

  it("keeps an episode with no date rather than discarding it", () => {
    const eps = normalizeSimklEpisodes([{ season: 1, episode: 5, title: "Unscheduled" }]);
    expect(eps[0]?.airDate).toBeNull();
  });

  it("ignores SIMKL's aired flag, which is true even for unaired episodes", () => {
    const eps = normalizeSimklEpisodes([{ season: 1, episode: 1, aired: true }]);
    expect(eps[0]).not.toHaveProperty("aired");
    expect(eps[0]?.airDate).toBeNull();
  });

  it("normalizes a blank title to null", () => {
    const eps = normalizeSimklEpisodes([{ season: 1, episode: 1, title: "   ", date: "2026-01-01" }]);
    expect(eps[0]?.title).toBeNull();
  });

  it("reports no runtime, which SIMKL does not supply per episode", () => {
    const eps = normalizeSimklEpisodes([{ season: 1, episode: 1, date: "2026-01-01" }]);
    expect(eps[0]?.runtime).toBeNull();
  });

  it("tolerates a missing or non-array payload", () => {
    expect(normalizeSimklEpisodes(null)).toEqual([]);
    expect(normalizeSimklEpisodes(undefined)).toEqual([]);
    expect(normalizeSimklEpisodes([])).toEqual([]);
  });
});
