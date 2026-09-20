import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, type Library } from "./schema";

/**
 * A stand-in for IndexedDB. The store's job is to make every mutation durable,
 * so what these tests check is not only the resulting state but that it was
 * written - a mutation that updates the store and forgets to persist would look
 * perfectly correct until the next reload.
 */
const storage = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    // Structured-clone semantics: what comes back must not alias what went in.
    storage.set(key, JSON.parse(JSON.stringify(value)));
  }),
}));

const { useLibrary } = await import("./store");

const persisted = () => storage.get("library") as Library | undefined;

function seed(): Library {
  const library = emptyLibrary();
  library.shows["tmdb:1"] = {
    key: "tmdb:1",
    ids: { tmdb: 1, imdb: "tt1" },
    title: "Test Show",
    status: "watching",
    watched: { 1: { 1: "2026-01-01T00:00:00Z", 2: "2026-01-08T00:00:00Z" } },
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  return library;
}

beforeEach(async () => {
  storage.clear();
  await useLibrary.getState().replaceAll(seed());
});

describe("hydrate", () => {
  it("starts empty and unhydrated, then loads what was stored", async () => {
    storage.clear();
    storage.set("library", seed());
    useLibrary.setState({ library: emptyLibrary(), hydrated: false });

    await useLibrary.getState().hydrate();
    expect(useLibrary.getState().hydrated).toBe(true);
    expect(Object.keys(useLibrary.getState().library.shows)).toEqual(["tmdb:1"]);
  });

  it("hydrates to an empty library when nothing was ever stored", async () => {
    storage.clear();
    await useLibrary.getState().hydrate();
    expect(useLibrary.getState().library).toEqual(emptyLibrary());
    expect(useLibrary.getState().hydrated).toBe(true);
  });
});

describe("addShow", () => {
  it("adds a new show and returns its key", async () => {
    const key = await useLibrary.getState().addShow({
      ids: { tmdb: 2 },
      title: "New",
      status: "plantowatch",
    });
    expect(key).toBe("tmdb:2");
    expect(persisted()?.shows["tmdb:2"]?.title).toBe("New");
  });

  it("keeps the watch history when a show already on the list is re-added", async () => {
    // Re-adding is a status change, not a reset. Losing history here would be
    // the single worst bug this store could have.
    await useLibrary.getState().addShow({ ids: { tmdb: 1 }, title: "Test Show", status: "completed" });

    const show = useLibrary.getState().library.shows["tmdb:1"];
    expect(show?.status).toBe("completed");
    expect(show?.watched).toEqual({ 1: { 1: "2026-01-01T00:00:00Z", 2: "2026-01-08T00:00:00Z" } });
  });

  it("refuses a show with no usable id rather than inventing a key", async () => {
    const key = await useLibrary.getState().addShow({ ids: {}, title: "Ghost", status: "watching" });
    expect(key).toBeNull();
    expect(Object.keys(useLibrary.getState().library.shows)).toEqual(["tmdb:1"]);
  });
});

describe("setStatus", () => {
  it("changes the status and stamps the change", async () => {
    await useLibrary.getState().setStatus("tmdb:1", "hold");
    const show = persisted()?.shows["tmdb:1"];
    expect(show?.status).toBe("hold");
    expect(show?.updatedAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("leaves addedAt alone, which orders the list", async () => {
    await useLibrary.getState().setStatus("tmdb:1", "hold");
    expect(persisted()?.shows["tmdb:1"]?.addedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("does nothing for a show that is not there", async () => {
    await useLibrary.getState().setStatus("tmdb:999", "hold");
    expect(Object.keys(useLibrary.getState().library.shows)).toEqual(["tmdb:1"]);
  });
});

describe("removeShow", () => {
  it("removes the show and persists the removal", async () => {
    await useLibrary.getState().removeShow("tmdb:1");
    expect(useLibrary.getState().library.shows["tmdb:1"]).toBeUndefined();
    expect(persisted()?.shows["tmdb:1"]).toBeUndefined();
  });

  it("is a no-op for a show that is not there", async () => {
    await useLibrary.getState().removeShow("tmdb:999");
    expect(Object.keys(useLibrary.getState().library.shows)).toEqual(["tmdb:1"]);
  });
});

describe("markWatched", () => {
  it("records an episode with a timestamp", async () => {
    await useLibrary.getState().markWatched("tmdb:1", 2, 1, "2026-02-01T00:00:00Z");
    expect(persisted()?.shows["tmdb:1"]?.watched[2]).toEqual({ 1: "2026-02-01T00:00:00Z" });
  });

  it("keeps the episodes already in that season", async () => {
    await useLibrary.getState().markWatched("tmdb:1", 1, 3, "2026-01-15T00:00:00Z");
    expect(Object.keys(persisted()?.shows["tmdb:1"]?.watched[1] ?? {})).toEqual(["1", "2", "3"]);
  });

  it("defaults the timestamp to now", async () => {
    await useLibrary.getState().markWatched("tmdb:1", 3, 1);
    const at = persisted()?.shows["tmdb:1"]?.watched[3]?.[1];
    expect(at).toBeDefined();
    expect(Number.isNaN(Date.parse(at as string))).toBe(false);
  });

  it("does nothing for a show that is not there", async () => {
    await useLibrary.getState().markWatched("tmdb:999", 1, 1);
    expect(persisted()?.shows["tmdb:999"]).toBeUndefined();
  });
});

describe("unmarkWatched", () => {
  it("removes just that episode", async () => {
    await useLibrary.getState().unmarkWatched("tmdb:1", 1, 2);
    expect(persisted()?.shows["tmdb:1"]?.watched[1]).toEqual({ 1: "2026-01-01T00:00:00Z" });
  });

  it("tolerates unmarking something that was never marked", async () => {
    await useLibrary.getState().unmarkWatched("tmdb:1", 9, 9);
    expect(persisted()?.shows["tmdb:1"]?.watched[1]).toEqual({
      1: "2026-01-01T00:00:00Z",
      2: "2026-01-08T00:00:00Z",
    });
  });
});

describe("setImage", () => {
  it("remembers a hand-picked poster", async () => {
    await useLibrary.getState().setImage("tmdb:1", "poster", "/chosen.jpg");
    expect(persisted()?.shows["tmdb:1"]?.images).toEqual({ posterPath: "/chosen.jpg" });
  });

  it("keeps the poster and banner choices independent", async () => {
    await useLibrary.getState().setImage("tmdb:1", "poster", "/p.jpg");
    await useLibrary.getState().setImage("tmdb:1", "banner", "/b.jpg");
    expect(persisted()?.shows["tmdb:1"]?.images).toEqual({
      posterPath: "/p.jpg",
      bannerPath: "/b.jpg",
    });
  });

  it("clears a choice back to TMDB's own pick", async () => {
    await useLibrary.getState().setImage("tmdb:1", "poster", "/p.jpg");
    await useLibrary.getState().setImage("tmdb:1", "poster", null);
    expect(persisted()?.shows["tmdb:1"]?.images?.posterPath).toBeUndefined();
  });
});

describe("rememberIds", () => {
  it("caches an id a lookup resolved", async () => {
    // A saved tvmaze id removes one rate-limited request per show per load.
    await useLibrary.getState().rememberIds("tmdb:1", { tvmaze: 82 });
    expect(persisted()?.shows["tmdb:1"]?.ids.tvmaze).toBe(82);
  });

  it("never overwrites an id the library already had", async () => {
    // An id from the SIMKL export outranks a lookup's guess.
    await useLibrary.getState().rememberIds("tmdb:1", { imdb: "tt-different" });
    expect(persisted()?.shows["tmdb:1"]?.ids.imdb).toBe("tt1");
  });

  it("ignores null and undefined values", async () => {
    await useLibrary.getState().rememberIds("tmdb:1", { tvmaze: undefined });
    expect(persisted()?.shows["tmdb:1"]?.ids.tvmaze).toBeUndefined();
  });

  it("does not touch updatedAt when nothing changed", async () => {
    await useLibrary.getState().rememberIds("tmdb:1", { imdb: "tt-different" });
    expect(persisted()?.shows["tmdb:1"]?.updatedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("does nothing for a show that is not there", async () => {
    await useLibrary.getState().rememberIds("tmdb:999", { tvmaze: 1 });
    expect(persisted()?.shows["tmdb:999"]).toBeUndefined();
  });
});
