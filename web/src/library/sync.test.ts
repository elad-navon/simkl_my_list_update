import { describe, expect, it, vi } from "vitest";
import { createDebouncedPush, pullFromGist, pushToGist } from "./sync";
import { emptyLibrary, type Library, type LibraryShow } from "./schema";
import type { GistClient } from "../api/gist";
import { LIBRARY_VERSION } from "./schema";

const NOW = "2026-09-20T12:00:00.000Z";

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

function library(shows: LibraryShow[] = [], syncedAt: string | null = null): Library {
  return { ...emptyLibrary(), syncedAt, shows: Object.fromEntries(shows.map((s) => [s.key, s])) };
}

function fakeGist(over: Partial<GistClient> = {}): GistClient {
  return {
    create: vi.fn<GistClient["create"]>().mockResolvedValue({ gistId: "new", htmlUrl: null }),
    read: vi.fn<GistClient["read"]>().mockResolvedValue(null),
    update: vi.fn<GistClient["update"]>().mockResolvedValue({ updatedAt: NOW }),
    ...over,
  };
}

describe("pullFromGist", () => {
  it("merges the backup into the local library rather than replacing it", async () => {
    // Replacing would lose the phone's offline evening the moment the desktop syncs.
    const remote = library([show({ watched: { 1: { 2: "2026-02-02T00:00:00Z" } } })]);
    const gist = fakeGist({
      read: vi.fn<GistClient["read"]>().mockResolvedValue({
        gistId: "abc",
        content: JSON.stringify(remote),
        updatedAt: NOW,
      }),
    });

    const local = library([show({ watched: { 1: { 1: "2026-02-01T00:00:00Z" } } })]);
    const outcome = await pullFromGist(gist, "abc", local, NOW);

    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") return;
    expect(Object.keys(outcome.library.shows["tmdb:1"]?.watched[1] ?? {})).toEqual(["1", "2"]);
    expect(outcome.stats.episodesGained).toBe(1);
  });

  it("reports an absent gist so the caller can create one", async () => {
    await expect(pullFromGist(fakeGist(), "abc", library(), NOW)).resolves.toEqual({
      kind: "absent",
    });
  });

  it("refuses to treat an unreadable backup as an empty one", async () => {
    // Pushing over it would destroy the only copy of whatever is in there.
    const gist = fakeGist({
      read: vi.fn<GistClient["read"]>().mockResolvedValue({
        gistId: "abc",
        content: "this is not json",
        updatedAt: null,
      }),
    });

    const outcome = await pullFromGist(gist, "abc", library([show()]), NOW);
    expect(outcome.kind).toBe("unreadable");
    if (outcome.kind !== "unreadable") return;
    expect(outcome.reason).toMatch(/not valid JSON/);
  });

  it("treats a gist holding something that is not a library as unreadable too", async () => {
    const gist = fakeGist({
      read: vi.fn<GistClient["read"]>().mockResolvedValue({
        gistId: "abc",
        content: JSON.stringify({ notes: "shopping list" }),
        updatedAt: null,
      }),
    });
    expect((await pullFromGist(gist, "abc", library(), NOW)).kind).toBe("unreadable");
  });

  it("lets an authorization failure through rather than reporting no backup", async () => {
    const gist = fakeGist({
      read: vi.fn<GistClient["read"]>().mockRejectedValue(new Error("GitHub rejected the token")),
    });
    await expect(pullFromGist(gist, "abc", library(), NOW)).rejects.toThrow(/rejected the token/);
  });
});

describe("pushToGist", () => {
  it("creates the gist on the first push", async () => {
    const gist = fakeGist();
    const result = await pushToGist(gist, null, library([show()]), NOW);

    expect(gist.create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ gistId: "new", updatedAt: NOW, created: true });
  });

  it("updates an existing gist", async () => {
    const gist = fakeGist();
    const result = await pushToGist(gist, "abc", library([show()]), NOW);

    expect(gist.update).toHaveBeenCalledTimes(1);
    expect(gist.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ gistId: "abc", created: false });
  });

  it("writes syncedAt into the pushed copy", async () => {
    // So a device restoring from this file inherits a sync point and can tell a
    // deletion from an addition on its very first merge.
    const gist = fakeGist();
    await pushToGist(gist, "abc", library([show()]), NOW);

    const payload = JSON.parse(vi.mocked(gist.update).mock.calls[0]?.[1] as string) as Library;
    expect(payload.syncedAt).toBe(NOW);
    expect(payload.version).toBe(LIBRARY_VERSION);
    expect(Object.keys(payload.shows)).toEqual(["tmdb:1"]);
  });

  it("passes a failed write through", async () => {
    const gist = fakeGist({
      update: vi.fn<GistClient["update"]>().mockRejectedValue(new Error("422")),
    });
    await expect(pushToGist(gist, "abc", library(), NOW)).rejects.toThrow("422");
  });
});

describe("createDebouncedPush", () => {
  it("collapses a burst of changes into one push", async () => {
    // Marking a season watched is twenty state changes in ten seconds.
    vi.useFakeTimers();
    const push = vi.fn<(library: Library) => Promise<void>>().mockResolvedValue(undefined);
    const debounced = createDebouncedPush(push, 1000);

    debounced.schedule(library([show({ title: "first" })]));
    debounced.schedule(library([show({ title: "second" })]));
    debounced.schedule(library([show({ title: "third" })]));

    await vi.advanceTimersByTimeAsync(1000);
    expect(push).toHaveBeenCalledTimes(1);
    // Only the latest state: an intermediate one is not a version anybody wants
    // restored, and the gist's history would fill up with them.
    expect(push.mock.calls[0]?.[0].shows["tmdb:1"]?.title).toBe("third");
    vi.useRealTimers();
  });

  it("does not push before the delay has passed", async () => {
    vi.useFakeTimers();
    const push = vi.fn<(library: Library) => Promise<void>>().mockResolvedValue(undefined);
    const debounced = createDebouncedPush(push, 1000);

    debounced.schedule(library([show()]));
    await vi.advanceTimersByTimeAsync(999);
    expect(push).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("flushes immediately, for the tab closing mid-debounce", async () => {
    vi.useFakeTimers();
    const push = vi.fn<(library: Library) => Promise<void>>().mockResolvedValue(undefined);
    const debounced = createDebouncedPush(push, 10_000);

    debounced.schedule(library([show()]));
    expect(debounced.pending()).toBe(true);
    await debounced.flush();

    expect(push).toHaveBeenCalledTimes(1);
    expect(debounced.pending()).toBe(false);
    vi.useRealTimers();
  });

  it("flushing with nothing queued does nothing", async () => {
    const push = vi.fn<(library: Library) => Promise<void>>().mockResolvedValue(undefined);
    await createDebouncedPush(push).flush();
    expect(push).not.toHaveBeenCalled();
  });

  it("cancels a pending push", async () => {
    vi.useFakeTimers();
    const push = vi.fn<(library: Library) => Promise<void>>().mockResolvedValue(undefined);
    const debounced = createDebouncedPush(push, 1000);

    debounced.schedule(library([show()]));
    debounced.cancel();
    await vi.advanceTimersByTimeAsync(2000);

    expect(push).not.toHaveBeenCalled();
    expect(debounced.pending()).toBe(false);
    vi.useRealTimers();
  });
});
