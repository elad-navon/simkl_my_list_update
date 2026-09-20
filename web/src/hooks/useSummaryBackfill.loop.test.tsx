// @vitest-environment jsdom
/**
 * That the pass finishes, and does not restart itself.
 *
 * The first version keyed its effect on the size of its own queue - and the pass
 * shrinks that queue by design, so every summary it wrote cancelled the pass that
 * wrote it and started another. This counts fetches and effect runs, which is the
 * only way to see that from outside.
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

const fetches: string[] = [];

vi.mock("./useShowData", () => ({
  fetchShowData: vi.fn(async (_clients: unknown, show: LibraryShow) => {
    fetches.push(show.key);
    // A real fetch yields, which is when a self-cancelling effect gets its chance.
    await new Promise((resolve) => setTimeout(resolve, 1));
    return {
      episodes: [{ season: 1, episode: 1, airDate: "2026-01-01", title: null, runtime: 45 }],
      loaded: { seriesEnded: false },
    };
  }),
}));

const { useSummaryBackfill } = await import("./useSummaryBackfill");
const { useLibrary } = await import("../library/store");

const clients = {} as ApiClients;

function library(count: number): Library {
  const shows: Record<string, LibraryShow> = {};
  for (let i = 0; i < count; i += 1) {
    shows[`tmdb:${i}`] = {
      key: `tmdb:${i}`,
      ids: { tmdb: i },
      title: `Show ${i}`,
      status: "watching",
      watched: {},
      addedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
  }
  return { ...emptyLibrary(), shows };
}

let effectRuns = 0;

function Harness(): React.JSX.Element {
  // Reads the live store, exactly as the dashboard does - which is what made the
  // library's own changes feed back into the effect.
  const lib = useLibrary((s) => s.library);
  const state = useSummaryBackfill(lib, clients, "local", true);
  effectRuns += 1;
  return <span data-testid="state">{state.running ? "running" : `done:${state.done}`}</span>;
}

beforeEach(async () => {
  storage.clear();
  fetches.length = 0;
  effectRuns = 0;
});

describe("useSummaryBackfill settles", () => {
  it("fetches each show exactly once", async () => {
    await useLibrary.getState().replaceAll(library(8));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    await waitFor(
      () => expect(useLibrary.getState().library.shows["tmdb:7"]?.summary).toBeDefined(),
      { timeout: 4000 },
    );

    expect(fetches).toHaveLength(8);
    expect(new Set(fetches).size).toBe(8);
  });

  it("writes a summary for every show and then stops", async () => {
    await useLibrary.getState().replaceAll(library(8));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    await waitFor(
      () =>
        expect(
          Object.values(useLibrary.getState().library.shows).every((s) => s.summary),
        ).toBe(true),
      { timeout: 4000 },
    );

    const settledFetches = fetches.length;
    const settledRenders = effectRuns;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(fetches.length).toBe(settledFetches);
    expect(effectRuns).toBe(settledRenders);
  });
});
