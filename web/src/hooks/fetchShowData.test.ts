import { describe, expect, it, vi } from "vitest";
import { emptyLibrary } from "../library/schema";
import type { ApiClients } from "../api/clients";

vi.mock("idb-keyval", () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
}));

const { bestEffort, fetchShowData } = await import("./useShowData");
const { useLibrary } = await import("../library/store");

const clients: ApiClients = {
  tmdb: null,
  tvmaze: {
    lookupShow: vi.fn(async () => ({ id: 82 })),
    getEpisodes: vi.fn(async () => [
      { season: 1, number: 1, airstamp: "2026-01-01T20:00:00+02:00", runtime: 45, name: "One" },
    ]),
    searchShows: vi.fn(async () => []),
  } as never,
  omdb: null,
  simkl: null,
};

const show = {
  key: "tmdb:1",
  ids: { tmdb: 1, imdb: "tt1" },
  title: "Test Show",
  status: "watching" as const,
  watched: {},
  addedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("bestEffort", () => {
  it("swallows a synchronous throw", () => {
    expect(() => bestEffort(() => { throw new Error("x is not a function"); })).not.toThrow();
  });

  it("swallows a rejected promise instead of leaving it unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    bestEffort(() => Promise.reject(new Error("quota")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("runs the write when nothing goes wrong", () => {
    const write = vi.fn();
    bestEffort(write);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("fetchShowData when the cache writes fail", () => {
  it("still returns the show, because the data was fetched perfectly well", async () => {
    // A stale dev server once served a store with no `rememberSummary`, and every
    // card on the page reported that instead of rendering.
    await useLibrary.getState().replaceAll({ ...emptyLibrary(), shows: { "tmdb:1": show } });
    useLibrary.setState({
      rememberSummary: () => { throw new Error("rememberSummary is not a function"); },
      rememberIds: () => Promise.reject(new Error("quota")),
    });

    const data = await fetchShowData(clients, show);
    expect(data.progress.total).toBe(1);
    expect(data.episodes).toHaveLength(1);
  });
});
