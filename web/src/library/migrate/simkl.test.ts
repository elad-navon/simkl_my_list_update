import { describe, expect, it } from "vitest";
import {
  extractIds,
  extractWatched,
  formatSE,
  migrateFromSimkl,
  parseNextEpisode,
  reconstructWatched,
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

describe("reconstructWatched", () => {
  const eps = (specs: Array<[number, number]>) => specs.map(([season, episode]) => ({ season, episode }));

  it("prefers SIMKL's own per-episode data when it is there", () => {
    const result = reconstructWatched(item(), eps([[1, 1], [1, 2]]), EXPORTED_AT);
    expect(result.provenance).toBe("episode-level");
    expect(result.watched).toEqual({ 1: { 1: "2026-01-01T00:00:00Z" } });
  });

  it("rebuilds a completed show as every episode, which its own counts confirm", () => {
    // SIMKL reports watched === total for all 444 completed shows in this
    // library, so "the first N" is "all of them" and nothing is inferred.
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 3, total_episodes_count: 3 }),
      eps([[1, 1], [1, 2], [1, 3]]),
      EXPORTED_AT,
    );
    expect(result.provenance).toBe("reconstructed");
    expect(result.watched).toEqual({
      1: { 1: EXPORTED_AT, 2: EXPORTED_AT, 3: EXPORTED_AT },
    });
  });

  it("takes the first N in broadcast order for a partly watched show", () => {
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 3, last_watched: "S02E01" }),
      eps([[2, 1], [1, 2], [1, 1], [1, 3]]), // deliberately out of order
      EXPORTED_AT,
    );
    expect(result.watched).toEqual({
      1: { 1: EXPORTED_AT, 2: EXPORTED_AT, 3: EXPORTED_AT },
    });
  });

  it("records exactly the count SIMKL reported, never more", () => {
    // Taking the first N rather than everything through `last_watched` is what
    // keeps the count exact: the error can only be which episode, not how many.
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 2, last_watched: "S01E04" }),
      eps([[1, 1], [1, 2], [1, 3], [1, 4]]),
      EXPORTED_AT,
    );
    const total = Object.values(result.watched).reduce((n, s) => n + Object.keys(s).length, 0);
    expect(total).toBe(2);
  });

  it("ignores a stale last_watched pointing past the episode list", () => {
    // SIMKL reads S02E99 and S00E15 on completed shows whose history is fine.
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 2, last_watched: "S02E99" }),
      eps([[1, 1], [1, 2]]),
      EXPORTED_AT,
    );
    expect(result.watched).toEqual({ 1: { 1: EXPORTED_AT, 2: EXPORTED_AT } });
    expect(result.shortfall).toBeUndefined();
  });

  it("excludes specials from reconstruction", () => {
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 1 }),
      eps([[0, 1], [1, 1]]),
      EXPORTED_AT,
    );
    expect(result.watched).toEqual({ 1: { 1: EXPORTED_AT } });
  });

  it("dates reconstructed episodes from the show's own last watch", () => {
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 1, last_watched_at: "2015-10-07T08:53:24Z" }),
      eps([[1, 1]]),
      EXPORTED_AT,
    );
    expect(result.watched[1]?.[1]).toBe("2015-10-07T08:53:24Z");
  });

  it("falls back to the export date when SIMKL timestamped nothing", () => {
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 1, last_watched_at: null }),
      eps([[1, 1]]),
      EXPORTED_AT,
    );
    expect(result.watched[1]?.[1]).toBe(EXPORTED_AT);
  });

  it("reports a shortfall instead of inventing episodes to fit the count", () => {
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 5 }),
      eps([[1, 1], [1, 2]]),
      EXPORTED_AT,
    );
    expect(result.shortfall).toBe(3);
    expect(Object.keys(result.watched[1] ?? {})).toHaveLength(2);
  });

  it("returns an empty map for a show with nothing watched", () => {
    const result = reconstructWatched(
      item({ seasons: null, watched_episodes_count: 0 }),
      eps([[1, 1]]),
      EXPORTED_AT,
    );
    expect(result).toEqual({ watched: {}, provenance: "empty" });
  });

  it("does not reconstruct when there is no episode list to place a count on", () => {
    const result = reconstructWatched(item({ seasons: null, watched_episodes_count: 4 }), [], EXPORTED_AT);
    expect(result.watched).toEqual({});
    expect(result.shortfall).toBe(4);
  });
});

describe("migrateFromSimkl with episode data", () => {
  it("reconstructs history for a show SIMKL sent no seasons for", () => {
    const { library, provenance } = migrateFromSimkl({
      exportedAt: EXPORTED_AT,
      lists: {
        completed: [
          item({
            seasons: null,
            watched_episodes_count: 2,
            total_episodes_count: 2,
            show: { title: "Oz", ids: { simkl: 349, tmdb: "3322" } },
          }),
        ],
      },
      episodes: {
        349: [
          { season: 1, episode: 1, date: "1997-07-12" },
          { season: 1, episode: 2, date: "1997-07-19" },
        ],
      },
    });
    expect(provenance.reconstructed).toBe(1);
    expect(library.shows["tmdb:3322"]?.watched).toEqual({
      1: { 1: EXPORTED_AT, 2: EXPORTED_AT },
    });
  });

  it("counts provenance across the whole library", () => {
    const { provenance } = migrateFromSimkl({
      exportedAt: EXPORTED_AT,
      lists: {
        watching: [item({ show: { title: "A", ids: { tmdb: 1 } } })],
        completed: [
          item({ seasons: null, watched_episodes_count: 1, show: { title: "B", ids: { tmdb: 2, simkl: 9 } } }),
        ],
        plantowatch: [
          item({ seasons: null, watched_episodes_count: 0, show: { title: "C", ids: { tmdb: 3 } } }),
        ],
      },
      episodes: { 9: [{ season: 1, episode: 1, date: "2020-01-01" }] },
    });
    expect(provenance).toEqual({ "episode-level": 1, reconstructed: 1, empty: 1 });
  });

  it("takes addedAt from SIMKL's watchlist date when it has one", () => {
    const { library } = migrateFromSimkl(
      exportOf([item({ added_to_watchlist_at: "2024-10-12T23:25:13Z" })]),
    );
    expect(library.shows["tmdb:555"]?.addedAt).toBe("2024-10-12T23:25:13Z");
  });

  it("reports a count it could not place rather than dropping it silently", () => {
    const { issues } = migrateFromSimkl({
      exportedAt: EXPORTED_AT,
      lists: {
        dropped: [item({ seasons: null, watched_episodes_count: 9, show: { title: "Gap", ids: { tmdb: 7, simkl: 8 } } })],
      },
      episodes: { 8: [{ season: 1, episode: 1, date: "2020-01-01" }] },
    });
    expect(issues[0]?.reason).toBe("watch-count-shortfall");
  });
});
