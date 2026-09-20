import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimklClient } from "../api/simkl";
import { BackendUnsupportedError } from "./backend";
import { emptyLibrary, type Library } from "./schema";
import type { SimklItem } from "./migrate/simkl";

const storage = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, JSON.parse(JSON.stringify(value)));
  }),
}));

const { useLibrary } = await import("./store");
const { createLocalBackend } = await import("./localBackend");
const { createSimklBackend } = await import("./simklBackend");

function fakeSimkl(over: Partial<SimklClient> = {}): SimklClient {
  return {
    getList: vi.fn<SimklClient["getList"]>().mockResolvedValue([]),
    getAllLists: vi.fn<SimklClient["getAllLists"]>().mockResolvedValue({
      watching: [],
      plantowatch: [],
      hold: [],
      completed: [],
      dropped: [],
    }),
    getEpisodes: vi.fn<SimklClient["getEpisodes"]>().mockResolvedValue([]),
    getShowDetail: vi.fn<SimklClient["getShowDetail"]>().mockResolvedValue(null),
    searchShows: vi.fn<SimklClient["searchShows"]>().mockResolvedValue([]),
    addToList: vi.fn<SimklClient["addToList"]>().mockResolvedValue(undefined),
    removeFromList: vi.fn<SimklClient["removeFromList"]>().mockResolvedValue(undefined),
    markEpisodeWatched: vi.fn<SimklClient["markEpisodeWatched"]>().mockResolvedValue(undefined),
    removeEpisodeFromHistory: vi
      .fn<SimklClient["removeEpisodeFromHistory"]>()
      .mockResolvedValue(undefined),
    ...over,
  };
}

function backend(simkl: SimklClient, maxEpisodeFetches?: number) {
  const store = () => useLibrary.getState();
  return createSimklBackend({
    simkl,
    mirror: createLocalBackend(store),
    store,
    ...(maxEpisodeFetches === undefined ? {} : { maxEpisodeFetches }),
  });
}

function item(over: Partial<SimklItem> = {}): SimklItem {
  return {
    watched_episodes_count: 0,
    total_episodes_count: 10,
    show: { title: "Test Show", ids: { simkl: 11, tmdb: "1" } },
    ...over,
  };
}

function seed(): Library {
  const library = emptyLibrary();
  library.shows["tmdb:1"] = {
    key: "tmdb:1",
    ids: { tmdb: 1, simkl: 11 },
    title: "Test Show",
    status: "watching",
    watched: { 1: { 1: "a" } },
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  return library;
}

const persisted = () => storage.get("library") as Library | undefined;

beforeEach(async () => {
  storage.clear();
  await useLibrary.getState().replaceAll(seed());
});

describe("load", () => {
  it("reports SIMKL mode and what it had to do", async () => {
    const simkl = fakeSimkl({
      getAllLists: vi.fn<SimklClient["getAllLists"]>().mockResolvedValue({
        watching: [item({ watched_episodes_count: 1 })],
        plantowatch: [],
        hold: [],
        completed: [],
        dropped: [],
      }),
    });
    const { report } = await backend(simkl).load();
    expect(report).toMatchObject({ mode: "simkl", shows: 1, refetched: 0, removed: 0 });
  });

  it("fetches five lists and no episode lists when nothing changed", async () => {
    // The common case, and the reason a load is cheap.
    const simkl = fakeSimkl({
      getAllLists: vi.fn<SimklClient["getAllLists"]>().mockResolvedValue({
        watching: [item({ watched_episodes_count: 1 })],
        plantowatch: [],
        hold: [],
        completed: [],
        dropped: [],
      }),
    });
    await backend(simkl).load();
    expect(simkl.getEpisodes).not.toHaveBeenCalled();
  });

  it("fetches an episode list only for a show whose history really moved", async () => {
    const simkl = fakeSimkl({
      getAllLists: vi.fn<SimklClient["getAllLists"]>().mockResolvedValue({
        watching: [],
        plantowatch: [],
        hold: [],
        completed: [item({ watched_episodes_count: 3, seasons: null })],
        dropped: [],
      }),
      getEpisodes: vi.fn<SimklClient["getEpisodes"]>().mockResolvedValue([
        { season: 1, episode: 1, date: "2020-01-01" },
        { season: 1, episode: 2, date: "2020-01-08" },
        { season: 1, episode: 3, date: "2020-01-15" },
      ]),
    });

    const { report, library } = await backend(simkl).load();
    expect(simkl.getEpisodes).toHaveBeenCalledWith(11, undefined);
    expect(report.refetched).toBe(1);
    expect(Object.keys(library.shows["tmdb:1"]?.watched[1] ?? {})).toEqual(["1", "2", "3"]);
  });

  it("caps how many episode lists one load may fetch", async () => {
    // A first load against an empty mirror would otherwise want hundreds, behind
    // a blank screen. The rest keep SIMKL's count and fill in on a later load.
    const many = Array.from({ length: 5 }, (_unused, i) =>
      item({
        watched_episodes_count: 2,
        seasons: null,
        show: { title: `Show ${i}`, ids: { simkl: 100 + i, tmdb: String(100 + i) } },
      }),
    );
    const simkl = fakeSimkl({
      getAllLists: vi.fn<SimklClient["getAllLists"]>().mockResolvedValue({
        watching: [],
        plantowatch: [],
        hold: [],
        completed: many,
        dropped: [],
      }),
    });

    await backend(simkl, 2).load();
    expect(simkl.getEpisodes).toHaveBeenCalledTimes(2);
  });

  it("survives one unavailable episode list", async () => {
    const simkl = fakeSimkl({
      getAllLists: vi.fn<SimklClient["getAllLists"]>().mockResolvedValue({
        watching: [],
        plantowatch: [],
        hold: [],
        completed: [item({ watched_episodes_count: 3, seasons: null })],
        dropped: [],
      }),
      getEpisodes: vi.fn<SimklClient["getEpisodes"]>().mockRejectedValue(new Error("500")),
    });

    const { library } = await backend(simkl).load();
    expect(library.shows["tmdb:1"]?.watched).toEqual({});
  });

  it("writes the reconciled library to the mirror", async () => {
    const simkl = fakeSimkl({
      getAllLists: vi.fn<SimklClient["getAllLists"]>().mockResolvedValue({
        watching: [],
        plantowatch: [],
        hold: [],
        completed: [item({ watched_episodes_count: 1, seasons: [{ number: 1, episodes: [{ number: 1 }] }] })],
        dropped: [],
      }),
    });
    await backend(simkl).load();
    expect(persisted()?.shows["tmdb:1"]?.status).toBe("completed");
  });

  it("drops a show SIMKL no longer lists", async () => {
    const { report } = await backend(fakeSimkl()).load();
    expect(report.removed).toBe(1);
    expect(persisted()?.shows).toEqual({});
  });

  it("leaves the mirror readable when SIMKL is unreachable", async () => {
    // A SIMKL outage should degrade to yesterday's list, not to a blank page.
    const simkl = fakeSimkl({
      getAllLists: vi.fn<SimklClient["getAllLists"]>().mockRejectedValue(new Error("offline")),
    });
    await expect(backend(simkl).load()).rejects.toThrow("offline");
    expect(useLibrary.getState().library.shows["tmdb:1"]).toBeDefined();
  });
});

describe("writes", () => {
  it("tells SIMKL before it touches the mirror", async () => {
    const order: string[] = [];
    const simkl = fakeSimkl({
      addToList: vi.fn<SimklClient["addToList"]>(async () => {
        order.push("simkl");
      }),
    });
    const b = backend(simkl);
    await b.setStatus("tmdb:1", "hold");
    order.push("mirror");

    expect(order).toEqual(["simkl", "mirror"]);
    expect(persisted()?.shows["tmdb:1"]?.status).toBe("hold");
  });

  it("leaves the mirror untouched when SIMKL rejects the write", async () => {
    // The failure that would quietly corrupt a backup: the mirror claiming
    // something SIMKL never accepted.
    const simkl = fakeSimkl({
      addToList: vi.fn<SimklClient["addToList"]>().mockRejectedValue(new Error("400")),
    });
    await expect(backend(simkl).setStatus("tmdb:1", "hold")).rejects.toThrow("400");
    expect(persisted()?.shows["tmdb:1"]?.status).toBe("watching");
  });

  it("sends the show's ids with a status change", async () => {
    const simkl = fakeSimkl();
    await backend(simkl).setStatus("tmdb:1", "completed");
    expect(simkl.addToList).toHaveBeenCalledWith({ simkl: 11, tmdb: 1 }, "completed");
  });

  it("marks an episode on SIMKL and mirrors it", async () => {
    const simkl = fakeSimkl();
    await backend(simkl).markWatched("tmdb:1", 2, 5, "2026-05-05T00:00:00Z");

    expect(simkl.markEpisodeWatched).toHaveBeenCalledWith(11, 2, 5);
    expect(persisted()?.shows["tmdb:1"]?.watched[2]).toEqual({ 5: "2026-05-05T00:00:00Z" });
  });

  it("un-marks an episode on SIMKL and mirrors it", async () => {
    const simkl = fakeSimkl();
    await backend(simkl).unmarkWatched("tmdb:1", 1, 1);

    expect(simkl.removeEpisodeFromHistory).toHaveBeenCalledWith(11, 1, 1);
    expect(persisted()?.shows["tmdb:1"]?.watched[1]).toEqual({});
  });

  it("removes a show from SIMKL and from the mirror", async () => {
    const simkl = fakeSimkl();
    await backend(simkl).removeShow("tmdb:1");

    expect(simkl.removeFromList).toHaveBeenCalledWith({ simkl: 11, tmdb: 1 });
    expect(persisted()?.shows["tmdb:1"]).toBeUndefined();
  });

  it("adds a show to SIMKL before the mirror", async () => {
    const simkl = fakeSimkl();
    const key = await backend(simkl).addShow({ ids: { tmdb: 2, simkl: 22 }, title: "New", status: "plantowatch" });

    expect(simkl.addToList).toHaveBeenCalledWith({ simkl: 22, tmdb: 2 }, "plantowatch");
    expect(key).toBe("tmdb:2");
  });

  it("refuses a show SIMKL could not identify, instead of diverging", async () => {
    const simkl = fakeSimkl();
    await expect(
      backend(simkl).addShow({ ids: { tvmaze: 82 }, title: "TVmaze only", status: "watching" }),
    ).rejects.toBeInstanceOf(BackendUnsupportedError);
    expect(simkl.addToList).not.toHaveBeenCalled();
  });

  it("refuses an episode write for a show with no SIMKL id", async () => {
    await useLibrary.getState().replaceAll({
      ...emptyLibrary(),
      shows: {
        "tmdb:9": {
          key: "tmdb:9",
          ids: { tmdb: 9 },
          title: "No simkl id",
          status: "watching",
          watched: {},
          addedAt: "x",
          updatedAt: "x",
        },
      },
    });
    const simkl = fakeSimkl();
    await expect(backend(simkl).markWatched("tmdb:9", 1, 1)).rejects.toBeInstanceOf(
      BackendUnsupportedError,
    );
    expect(simkl.markEpisodeWatched).not.toHaveBeenCalled();
  });
});
