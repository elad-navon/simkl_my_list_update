// @vitest-environment jsdom
/**
 * Which shows the pass decides to look at.
 *
 * The queue rule is the whole behaviour, and it has been wrong twice: first by only
 * covering shows with NO summary - which left a show seeded with zero hidden forever
 * - and before that by not existing, which left every watching show on the list.
 * Lioness is the case that caught it: seeded at 00:53 with nothing to watch, aired
 * at 03:00, and a summary written once would never have noticed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { emptyLibrary, type Library, type LibraryShow } from "../library/schema";
import type { ApiClients } from "../api/clients";

const storage = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, JSON.parse(JSON.stringify(value)));
  }),
}));

const fetched: string[] = [];

vi.mock("./useShowData", () => ({
  fetchShowData: vi.fn(async (_clients: unknown, show: LibraryShow) => {
    fetched.push(show.key);
    return {
      episodes: [
        { season: 1, episode: 1, airDate: "2026-01-01", title: null, runtime: 45 },
        { season: 1, episode: 2, airDate: "2026-01-08", title: null, runtime: 45 },
      ],
      loaded: { seriesEnded: false },
    };
  }),
}));

const { useSummaryBackfill } = await import("./useSummaryBackfill");
const { useLibrary } = await import("../library/store");

const clients = {} as ApiClients;

function show(over: Partial<LibraryShow> = {}): LibraryShow {
  return {
    key: "tmdb:1",
    ids: { tmdb: 1 },
    title: "Test Show",
    status: "watching",
    watched: {},
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function library(shows: LibraryShow[]): Library {
  return { ...emptyLibrary(), shows: Object.fromEntries(shows.map((s) => [s.key, s])) };
}

function Harness({ lib }: { lib: Library }): React.JSX.Element {
  const state = useSummaryBackfill(lib, clients, "local", true);
  return <span data-testid="state">{state.running ? "running" : `done:${state.done}`}</span>;
}

async function mount(lib: Library) {
  await useLibrary.getState().replaceAll(lib);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness lib={lib} />
    </QueryClientProvider>,
  );
}

const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();

beforeEach(() => {
  storage.clear();
  fetched.length = 0;
});

describe("useSummaryBackfill", () => {
  it("checks a show that has no summary at all", async () => {
    await mount(library([show()]));
    await waitFor(() => expect(fetched).toEqual(["tmdb:1"]));
  });

  it("writes the derived summary", async () => {
    await mount(library([show()]));
    await waitFor(() =>
      expect(useLibrary.getState().library.shows["tmdb:1"]?.summary?.remaining).toBe(2),
    );
  });

  it("re-checks a summary that has gone stale", async () => {
    // Lioness: seeded with nothing to watch, then an episode aired.
    await mount(
      library([show({ summary: { remaining: 0, nextAirDate: null, checkedAt: hoursAgo(13) } })]),
    );
    await waitFor(() => expect(fetched).toEqual(["tmdb:1"]));
    await waitFor(() =>
      expect(useLibrary.getState().library.shows["tmdb:1"]?.summary?.remaining).toBe(2),
    );
  });

  it("leaves a recent summary alone", async () => {
    await mount(
      library([show({ summary: { remaining: 0, nextAirDate: null, checkedAt: hoursAgo(1) } })]),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetched).toEqual([]);
  });

  it("re-checks a summary whose timestamp is unreadable", async () => {
    await mount(
      library([show({ summary: { remaining: 0, nextAirDate: null, checkedAt: "not a date" } })]),
    );
    await waitFor(() => expect(fetched).toEqual(["tmdb:1"]));
  });

  it("ignores shows that are not being watched", async () => {
    await mount(
      library([
        show({ key: "tmdb:1", status: "completed" }),
        show({ key: "tmdb:2", ids: { tmdb: 2 }, status: "dropped" }),
        show({ key: "tmdb:3", ids: { tmdb: 3 }, status: "plantowatch" }),
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetched).toEqual([]);
  });

  it("works through several shows and reports when it is done", async () => {
    await mount(
      library([show(), show({ key: "tmdb:2", ids: { tmdb: 2 }, title: "Second" })]),
    );
    await waitFor(() => expect(fetched).toHaveLength(2));
  });

  it("does nothing at all with an empty library", async () => {
    await mount(emptyLibrary());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetched).toEqual([]);
  });
});
