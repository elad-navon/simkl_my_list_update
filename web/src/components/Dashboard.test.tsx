// @vitest-environment jsdom
/**
 * Renders the dashboard with real query data, which is the state no other test
 * reached - and the state where a render loop lives.
 *
 * The new-episode check runs from an effect that reads the query cache and can
 * set state. The first version of that pair looped forever, because the hook
 * returned a fresh object every render and its merge returned a fresh array even
 * when it added nothing. Typechecking cannot see that; a render count can.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "./Dashboard";
import { queryKeys } from "../query/client";
import { emptyLibrary, type Library, type LibraryShow } from "../library/schema";
import type { LibraryBackend } from "../library/backend";
import type { ApiClients } from "../api/clients";
import type { ShowData } from "../hooks/useShowData";
import type { Episode } from "../domain/types";

const SNAPSHOT_KEY = "tv_latest_episode_snapshot";

function ep(season: number, episode: number): Episode {
  return { season, episode, airDate: "2026-01-01", title: null, runtime: 45 };
}

function show(over: Partial<LibraryShow> = {}): LibraryShow {
  return {
    key: "tmdb:1",
    ids: { tmdb: 1 },
    title: "Test Show",
    status: "watching",
    watched: { 1: { 1: "2026-01-02T00:00:00Z" } },
    addedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function library(shows: LibraryShow[]): Library {
  return { ...emptyLibrary(), shows: Object.fromEntries(shows.map((s) => [s.key, s])) };
}

/** Just enough of a ShowData for the card and the new-episode check. */
function showData(latestAired: Episode | null): ShowData {
  return {
    episodes: [ep(1, 1)],
    progress: {
      total: 1,
      aired: 1,
      notAired: 0,
      watched: 1,
      remaining: 0,
      remainingEpisodes: [],
      nextToWatch: null,
      nextAiring: null,
      lastWatchedAt: Date.parse("2026-01-02T00:00:00Z"),
      latestAired,
    },
    remainingTime: { totalMinutes: 0, nextEpisodeMinutes: 45, episodes: [] },
    seasonView: { seasons: [], specials: [], total: 1, watched: 1 },
    sources: { tvmaze: true, tmdb: true, tmdbSeasons: false, simkl: false },
    loaded: {
      episodes: [ep(1, 1)],
      seriesEnded: false,
      coverage: {
        primaryCount: 1,
        fallbackCount: 0,
        manualCount: 0,
        mergedCount: 1,
        fallbackOnly: 0,
        primaryOnly: 1,
        withBroadcastTime: 0,
      },
      resolved: { tvmaze: null, imdb: null },
      tmdbShow: null,
      sources: { tvmaze: true, tmdb: true, tmdbSeasons: false },
    },
  };
}

const clients: ApiClients = {
  tmdb: null,
  tvmaze: { lookupShow: vi.fn(), getEpisodes: vi.fn(), searchShows: vi.fn() } as never,
  omdb: null,
  simkl: null,
};

const backend: LibraryBackend = {
  mode: "local",
  load: vi.fn(),
  addShow: vi.fn(),
  setStatus: vi.fn(),
  removeShow: vi.fn(),
  markWatched: vi.fn(),
  unmarkWatched: vi.fn(),
  applyWatchedPatch: vi.fn<LibraryBackend["applyWatchedPatch"]>().mockResolvedValue(undefined),
};

let renders = 0;

function Counting({ children }: { children: React.ReactNode }): React.JSX.Element {
  renders += 1;
  return <>{children}</>;
}

function mount(lib: Library, data: Record<string, ShowData>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, value] of Object.entries(data)) {
    client.setQueryData(queryKeys.showData(key, "local"), value);
  }

  renders = 0;
  render(
    <QueryClientProvider client={client}>
      <Counting>
        <Dashboard
          library={lib}
          backend={backend}
          clients={clients}
          imageMode="poster"
          onSetImage={vi.fn()}
        />
      </Counting>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard", () => {
  it("renders the stats, the carousel and both panels", () => {
    mount(library([show()]), { "tmdb:1": showData(ep(1, 1)) });

    expect(screen.getByText("To Watch")).toBeInTheDocument();
    expect(screen.getByText("Watching")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recently Watched" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan to Watch" })).toBeInTheDocument();
  });

  it("settles instead of re-rendering forever once show data has resolved", async () => {
    // The loop this guards against: the check effect set state, the state was a
    // new array even when nothing was added, and that re-ran the effect.
    mount(library([show()]), { "tmdb:1": showData(ep(1, 1)) });

    // The title appears twice - on the card and in Recently Watched - so the
    // heading is the unambiguous anchor.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 3, name: "Test Show" })).toBeInTheDocument(),
    );
    const settled = renders;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(renders).toBe(settled);
    expect(renders).toBeLessThan(25);
  });

  it("seeds the snapshot on the first pass without announcing anything", async () => {
    mount(library([show()]), { "tmdb:1": showData(ep(2, 5)) });

    await waitFor(() => expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull());
    expect(JSON.parse(localStorage.getItem(SNAPSHOT_KEY) as string)).toEqual({ "tmdb:1": 2005 });
    expect(screen.queryByText(/new episode/i)).not.toBeInTheDocument();
  });

  it("announces a show whose latest aired episode moved on", async () => {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ "tmdb:1": 2004 }));
    mount(library([show()]), { "tmdb:1": showData(ep(2, 5)) });

    await waitFor(() => expect(screen.getByText("A new episode aired")).toBeInTheDocument());
    expect(screen.getByText("S02E05")).toBeInTheDocument();
  });

  it("checks nothing until every show has resolved", async () => {
    // A partial pass would seed the shows that had loaded and then announce the
    // rest next time as though they were new.
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ "tmdb:1": 1000, "tmdb:2": 1000 }));
    mount(library([show(), show({ key: "tmdb:2", ids: { tmdb: 2 }, title: "Second" })]), {
      "tmdb:1": showData(ep(2, 5)),
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByText("A new episode aired")).not.toBeInTheDocument();
  });

  it("counts the shows rather than the episodes when several moved", async () => {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ "tmdb:1": 1000, "tmdb:2": 1000 }));
    mount(library([show(), show({ key: "tmdb:2", ids: { tmdb: 2 }, title: "Second" })]), {
      "tmdb:1": showData(ep(2, 5)),
      "tmdb:2": showData(ep(3, 1)),
    });

    await waitFor(() =>
      expect(screen.getByText("2 shows have new episodes")).toBeInTheDocument(),
    );
  });

  it("dismisses the banner", async () => {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ "tmdb:1": 2004 }));
    mount(library([show()]), { "tmdb:1": showData(ep(2, 5)) });

    await waitFor(() => expect(screen.getByText("A new episode aired")).toBeInTheDocument());
    screen.getByRole("button", { name: "Dismiss" }).click();

    await waitFor(() =>
      expect(screen.queryByText("A new episode aired")).not.toBeInTheDocument(),
    );
  });

  it("says so when there is nothing left to watch", () => {
    mount(library([show({ status: "completed" })]), {});
    expect(screen.getByText(/Everything on your watching list is up to date/)).toBeInTheDocument();
  });

  it("leaves out a watching show with nothing left, which is the list's definition", () => {
    // The old app listed a watching show only when SIMKL said it had a next
    // episode (app.js:1157) - being caught up means it does not belong here.
    mount(
      library([
        show({ summary: { remaining: 0, nextAirDate: null, checkedAt: "2026-09-20T00:00:00Z" } }),
        show({
          key: "tmdb:2",
          ids: { tmdb: 2 },
          title: "Still Going",
          summary: { remaining: 3, nextAirDate: null, checkedAt: "2026-09-20T00:00:00Z" },
        }),
      ]),
      {},
    );

    expect(screen.queryByRole("heading", { level: 3, name: "Test Show" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Still Going" })).toBeInTheDocument();
  });

  it("includes a show whose progress is not known yet", () => {
    // Hiding it would make a freshly imported library look empty; it drops out by
    // itself once its data arrives.
    mount(library([show()]), {});
    expect(screen.getByRole("heading", { level: 3, name: "Test Show" })).toBeInTheDocument();
  });
});
