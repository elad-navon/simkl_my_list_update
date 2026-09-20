import { describe, expect, it } from "vitest";
import { applyReconcile, episodeFetchList, planReconcile } from "./reconcile";
import { emptyLibrary, type Library, type LibraryShow } from "./schema";
import type { SimklItem } from "./migrate/simkl";
import type { SimklApiEpisode } from "./migrate/simklEpisodes";

const NOW = "2026-09-20T00:00:00.000Z";

function item(over: Partial<SimklItem> = {}): SimklItem {
  return {
    watched_episodes_count: 2,
    total_episodes_count: 10,
    show: { title: "Test Show", year: 2020, ids: { simkl: 11, tmdb: "1" } },
    ...over,
  };
}

function mirrorWith(over: Partial<LibraryShow> = {}): Library {
  const library = emptyLibrary();
  library.shows["tmdb:1"] = {
    key: "tmdb:1",
    ids: { tmdb: 1, simkl: 11 },
    title: "Test Show",
    status: "watching",
    watched: { 1: { 1: "a", 2: "b" } },
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
  return library;
}

const actionsOf = (plan: ReturnType<typeof planReconcile>) =>
  plan.entries.map((e) => `${e.key}:${e.action}`);

describe("planReconcile", () => {
  it("leaves a show alone when status and watched count both match", () => {
    // The cheap check the whole design rests on: no fetch, no rebuild, and the
    // mirror keeps its own per-episode map, which is richer than the count.
    const plan = planReconcile(mirrorWith(), { watching: [item()] });
    expect(actionsOf(plan)).toEqual(["tmdb:1:unchanged"]);
    expect(episodeFetchList(plan)).toEqual([]);
  });

  it("notices a status change made on simkl.com", () => {
    const plan = planReconcile(mirrorWith(), { completed: [item()] });
    expect(plan.entries[0]?.action).not.toBe("unchanged");
    expect(plan.entries[0]?.status).toBe("completed");
  });

  it("notices a watched count that moved elsewhere", () => {
    const plan = planReconcile(mirrorWith(), { watching: [item({ watched_episodes_count: 5 })] });
    expect(plan.entries[0]?.action).toBe("needs-episodes");
  });

  it("uses SIMKL's per-episode data when it sent any, with no fetch", () => {
    const plan = planReconcile(mirrorWith(), {
      watching: [
        item({
          watched_episodes_count: 3,
          seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }, { number: 3 }] }],
        }),
      ],
    });
    expect(plan.entries[0]?.action).toBe("from-seasons");
    expect(episodeFetchList(plan)).toEqual([]);
  });

  it("needs an episode list only when SIMKL withheld the seasons", () => {
    // Which is what SIMKL does for completed and dropped - 584 of 709 shows.
    const plan = planReconcile(emptyLibrary(), {
      completed: [item({ watched_episodes_count: 10, seasons: null })],
    });
    expect(plan.entries[0]?.action).toBe("needs-episodes");
    expect(episodeFetchList(plan)).toEqual([11]);
  });

  it("needs nothing for a show with nothing watched", () => {
    const plan = planReconcile(emptyLibrary(), {
      plantowatch: [item({ watched_episodes_count: 0, seasons: null })],
    });
    expect(plan.entries[0]?.action).toBe("empty");
    expect(episodeFetchList(plan)).toEqual([]);
  });

  it("ignores specials when comparing counts, as SIMKL does", () => {
    const mirror = mirrorWith({ watched: { 0: { 1: "s" }, 1: { 1: "a", 2: "b" } } });
    expect(actionsOf(planReconcile(mirror, { watching: [item()] }))).toEqual(["tmdb:1:unchanged"]);
  });

  it("marks a show the mirror has and SIMKL no longer lists for removal", () => {
    // SIMKL is the source of truth in this mode, so it was removed elsewhere.
    const plan = planReconcile(mirrorWith(), { watching: [] });
    expect(plan.removed).toEqual(["tmdb:1"]);
    expect(plan.entries).toEqual([]);
  });

  it("reports a show with no usable id instead of dropping it silently", () => {
    const plan = planReconcile(emptyLibrary(), {
      watching: [item({ show: { title: "Ghost", ids: {} } })],
    });
    expect(plan.unkeyed).toEqual(["Ghost"]);
    expect(plan.entries).toEqual([]);
  });

  it("keeps the first of a duplicated show rather than processing it twice", () => {
    const plan = planReconcile(emptyLibrary(), { watching: [item()], dropped: [item()] });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.status).toBe("watching");
  });

  it("plans nothing for empty lists and an empty mirror", () => {
    expect(planReconcile(emptyLibrary(), {})).toEqual({ entries: [], removed: [], unkeyed: [] });
  });
});

describe("applyReconcile", () => {
  it("keeps an unchanged show's row byte for byte", () => {
    const mirror = mirrorWith();
    const plan = planReconcile(mirror, { watching: [item()] });
    const { library } = applyReconcile(mirror, plan, {}, NOW);

    expect(library.shows["tmdb:1"]).toBe(mirror.shows["tmdb:1"]);
  });

  it("drops a show SIMKL no longer lists", () => {
    const mirror = mirrorWith();
    const plan = planReconcile(mirror, { watching: [] });
    const { library, removed } = applyReconcile(mirror, plan, {}, NOW);

    expect(library.shows).toEqual({});
    expect(removed).toBe(1);
  });

  it("takes history from SIMKL's seasons when it sent them", () => {
    const plan = planReconcile(emptyLibrary(), {
      watching: [
        item({
          watched_episodes_count: 2,
          seasons: [{ number: 1, episodes: [{ number: 1, watched_at: "2026-01-01T00:00:00Z" }] }],
        }),
      ],
    });
    const { library } = applyReconcile(emptyLibrary(), plan, {}, NOW);
    expect(library.shows["tmdb:1"]?.watched).toEqual({ 1: { 1: "2026-01-01T00:00:00Z" } });
  });

  it("rebuilds history from the fetched episode list and SIMKL's count", () => {
    const plan = planReconcile(emptyLibrary(), {
      completed: [item({ watched_episodes_count: 2, seasons: null })],
    });
    const episodes: Record<number, SimklApiEpisode[]> = {
      11: [
        { season: 1, episode: 1, date: "2020-01-01" },
        { season: 1, episode: 2, date: "2020-01-08" },
        { season: 1, episode: 3, date: "2020-01-15" },
      ],
    };
    const { library, counts } = applyReconcile(emptyLibrary(), plan, episodes, NOW);

    expect(Object.keys(library.shows["tmdb:1"]?.watched[1] ?? {})).toEqual(["1", "2"]);
    expect(counts["needs-episodes"]).toBe(1);
  });

  it("leaves history empty rather than guessing when the episode list is missing", () => {
    const plan = planReconcile(emptyLibrary(), {
      completed: [item({ watched_episodes_count: 5, seasons: null })],
    });
    const { library } = applyReconcile(emptyLibrary(), plan, { 11: null }, NOW);
    expect(library.shows["tmdb:1"]?.watched).toEqual({});
  });

  it("never lets a reconcile delete a hand-picked poster or a manual episode", () => {
    // Reconciling is about the list and the history. Anything the user chose
    // about a show has to survive it.
    const manual = [{ season: 9, episode: 1, airDate: "2026-09-01", title: "Typed by hand" }];
    const mirror = mirrorWith({ images: { posterPath: "/chosen.jpg" }, manualEpisodes: manual });
    const plan = planReconcile(mirror, { completed: [item()] });
    const { library } = applyReconcile(mirror, plan, {}, NOW);

    expect(library.shows["tmdb:1"]?.images).toEqual({ posterPath: "/chosen.jpg" });
    expect(library.shows["tmdb:1"]?.manualEpisodes).toEqual(manual);
    expect(library.shows["tmdb:1"]?.status).toBe("completed");
  });

  it("keeps the original addedAt, which orders the list", () => {
    const mirror = mirrorWith();
    const plan = planReconcile(mirror, { completed: [item()] });
    const { library } = applyReconcile(mirror, plan, {}, NOW);
    expect(library.shows["tmdb:1"]?.addedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("takes addedAt from SIMKL for a show the mirror has never seen", () => {
    const plan = planReconcile(emptyLibrary(), {
      watching: [item({ added_to_watchlist_at: "2024-10-12T23:25:13Z", seasons: null, watched_episodes_count: 0 })],
    });
    const { library } = applyReconcile(emptyLibrary(), plan, {}, NOW);
    expect(library.shows["tmdb:1"]?.addedAt).toBe("2024-10-12T23:25:13Z");
  });

  it("merges ids rather than replacing them, so a cached tvmaze id survives", () => {
    const mirror = mirrorWith({ ids: { tmdb: 1, simkl: 11, tvmaze: 82 } });
    const plan = planReconcile(mirror, { completed: [item()] });
    const { library } = applyReconcile(mirror, plan, {}, NOW);
    expect(library.shows["tmdb:1"]?.ids.tvmaze).toBe(82);
  });

  it("counts what it had to do, so a slow load can explain itself", () => {
    const plan = planReconcile(mirrorWith(), {
      watching: [item()],
      completed: [item({ show: { title: "Other", ids: { simkl: 22, tmdb: "2" } }, seasons: null })],
    });
    const { counts } = applyReconcile(mirrorWith(), plan, {}, NOW);
    expect(counts.unchanged).toBe(1);
    expect(counts["needs-episodes"]).toBe(1);
  });
});

describe("applyReconcile and the cached summary", () => {
  it("refreshes it from SIMKL, so My List is right without fetching episodes", () => {
    const plan = planReconcile(emptyLibrary(), {
      watching: [item({ total_episodes_count: 10, not_aired_episodes_count: 2, watched_episodes_count: 3, seasons: null })],
    });
    const { library } = applyReconcile(emptyLibrary(), plan, {}, NOW);

    expect(library.shows["tmdb:1"]?.summary).toEqual({
      remaining: 5,
      nextAirDate: null,
      checkedAt: NOW,
    });
  });

  it("keeps a derived summary on an unchanged show rather than replacing it", () => {
    // An unchanged row is kept whole, and its summary is the DERIVED one if the
    // show has ever loaded - which is better than SIMKL's own count.
    const mirror = mirrorWith({
      summary: { remaining: 2, nextAirDate: "2026-09-22T20:00:00+03:00", checkedAt: "2026-09-01T00:00:00Z" },
    });
    const plan = planReconcile(mirror, { watching: [item()] });
    const { library } = applyReconcile(mirror, plan, {}, NOW);

    expect(library.shows["tmdb:1"]?.summary?.nextAirDate).toBe("2026-09-22T20:00:00+03:00");
  });
});
