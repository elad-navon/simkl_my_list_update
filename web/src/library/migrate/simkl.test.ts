import { describe, expect, it } from "vitest";
import {
  extractIds,
  extractWatched,
  formatSE,
  migrateFromSimkl,
  parseNextEpisode,
  simklRemaining,
  type SimklExport,
  type SimklItem,
} from "./simkl";

const EXPORTED_AT = "2026-09-20T00:00:00.000Z";

function item(over: Partial<SimklItem> = {}): SimklItem {
  return {
    status: "watching",
    total_episodes_count: 10,
    not_aired_episodes_count: 2,
    watched_episodes_count: 3,
    show: { title: "Test Show", year: 2020, ids: { simkl: 1, tmdb: 555, imdb: "tt0000001" } },
    seasons: [{ number: 1, episodes: [{ number: 1, watched_at: "2026-01-01T00:00:00Z" }] }],
    ...over,
  };
}

function exportOf(items: SimklItem[], status = "watching"): SimklExport {
  return { exportedAt: EXPORTED_AT, lists: { [status]: items } as NonNullable<SimklExport["lists"]> };
}

describe("extractIds", () => {
  it("coerces string ids to numbers", () => {
    const ids = extractIds(item({ show: { title: "x", ids: { tmdb: "555", tvdb: "99" } } }));
    expect(ids.tmdb).toBe(555);
    expect(ids.tvdb).toBe(99);
  });

  it("leaves missing ids undefined rather than zero", () => {
    const ids = extractIds(item({ show: { title: "x", ids: {} } }));
    expect(ids.tmdb).toBeUndefined();
    expect(ids.imdb).toBeUndefined();
  });
});

describe("extractWatched", () => {
  it("flattens seasons into a season/episode map", () => {
    const watched = extractWatched(
      item({
        seasons: [
          { number: 1, episodes: [{ number: 1, watched_at: "a" }, { number: 2, watched_at: "b" }] },
          { number: 2, episodes: [{ number: 1, watched_at: "c" }] },
        ],
      }),
      EXPORTED_AT,
    );
    expect(watched).toEqual({ 1: { 1: "a", 2: "b" }, 2: { 1: "c" } });
  });

  it("keeps an untimestamped episode, dated from the show's last watch", () => {
    const watched = extractWatched(
      item({ last_watched_at: "2026-05-05T00:00:00Z", seasons: [{ number: 1, episodes: [{ number: 1 }] }] }),
      EXPORTED_AT,
    );
    expect(watched[1]?.[1]).toBe("2026-05-05T00:00:00Z");
  });

  it("falls back to the export date when the show has no timestamp either", () => {
    const watched = extractWatched(item({ seasons: [{ number: 1, episodes: [{ number: 1 }] }] }), EXPORTED_AT);
    expect(watched[1]?.[1]).toBe(EXPORTED_AT);
  });

  it("returns an empty map for a show with no watch data", () => {
    expect(extractWatched(item({ seasons: null }), EXPORTED_AT)).toEqual({});
  });
});

describe("migrateFromSimkl", () => {
  it("keys shows by tmdb id when there is one", () => {
    const { library } = migrateFromSimkl(exportOf([item()]));
    expect(Object.keys(library.shows)).toEqual(["tmdb:555"]);
  });

  it("falls back to another id space rather than dropping the show", () => {
    const { library, issues } = migrateFromSimkl(
      exportOf([item({ show: { title: "No TMDB", ids: { simkl: 7, imdb: "tt42" } } })]),
    );
    expect(Object.keys(library.shows)).toEqual(["imdb:tt42"]);
    expect(issues).toEqual([]);
  });

  it("takes the status from the list the show came from", () => {
    const { library } = migrateFromSimkl(exportOf([item({ status: "watching" })], "dropped"));
    expect(library.shows["tmdb:555"]?.status).toBe("dropped");
  });

  it("reports a show with no usable id instead of importing it", () => {
    const { library, issues } = migrateFromSimkl(exportOf([item({ show: { title: "Ghost", ids: {} } })]));
    expect(Object.keys(library.shows)).toHaveLength(0);
    expect(issues).toEqual([{ title: "Ghost", reason: "no-usable-id" }]);
  });

  it("reports an unrecognised list rather than guessing a status", () => {
    const { issues } = migrateFromSimkl({ exportedAt: EXPORTED_AT, lists: { nonsense: [item({ status: null })] } as never });
    expect(issues[0]?.reason).toBe("unknown-status");
  });

  it("keeps the first of a duplicated show and reports the rest", () => {
    const exported: SimklExport = {
      exportedAt: EXPORTED_AT,
      lists: { watching: [item()], dropped: [item()] },
    };
    const { library, issues } = migrateFromSimkl(exported);
    expect(Object.keys(library.shows)).toHaveLength(1);
    expect(library.shows["tmdb:555"]?.status).toBe("watching");
    expect(issues[0]?.reason).toBe("duplicate-key");
  });

  it("carries watch history across intact", () => {
    const { library } = migrateFromSimkl(exportOf([item()]));
    expect(library.shows["tmdb:555"]?.watched).toEqual({ 1: { 1: "2026-01-01T00:00:00Z" } });
  });

  it("stores none of SIMKL's pre-computed counts", () => {
    const { library } = migrateFromSimkl(exportOf([item()]));
    const show = library.shows["tmdb:555"] as unknown as Record<string, unknown>;
    expect(show["total_episodes_count"]).toBeUndefined();
    expect(show["next_to_watch"]).toBeUndefined();
  });

  it("produces an empty library from an empty export", () => {
    const { library, issues } = migrateFromSimkl({});
    expect(library.shows).toEqual({});
    expect(issues).toEqual([]);
  });
});

describe("simklRemaining", () => {
  it("reproduces SIMKL's own formula", () => {
    expect(simklRemaining(item())).toBe(5); // 10 total - 2 unaired - 3 watched
  });

  it("never returns a negative count", () => {
    expect(simklRemaining(item({ total_episodes_count: 2, not_aired_episodes_count: 5 }))).toBe(0);
    expect(simklRemaining(item({ watched_episodes_count: 99 }))).toBe(0);
  });

  it("treats missing fields as zero", () => {
    expect(simklRemaining({})).toBe(0);
  });
});

describe("parseNextEpisode / formatSE", () => {
  it("parses SIMKL's SxxEyy string", () => {
    expect(parseNextEpisode("S03E07")).toEqual({ season: 3, episode: 7 });
  });

  it("is case-insensitive", () => {
    expect(parseNextEpisode("s3e7")).toEqual({ season: 3, episode: 7 });
  });

  it("returns null for junk or absence", () => {
    expect(parseNextEpisode(null)).toBeNull();
    expect(parseNextEpisode("")).toBeNull();
    expect(parseNextEpisode("not an episode")).toBeNull();
  });

  it("round-trips through the zero-padded form", () => {
    expect(formatSE(parseNextEpisode("s3e7"))).toBe("S03E07");
  });
});
