import { describe, expect, it, vi } from "vitest";
import { guardBackend } from "./guardBackend";
import type { LibraryBackend } from "./backend";
import { emptyLibrary } from "./schema";

function fakeBackend(over: Partial<LibraryBackend> = {}): LibraryBackend {
  return {
    mode: "simkl",
    load: vi.fn<LibraryBackend["load"]>().mockResolvedValue({
      library: emptyLibrary(),
      report: { mode: "simkl", shows: 0, refetched: 0, removed: 0, unkeyed: [] },
    }),
    addShow: vi.fn<LibraryBackend["addShow"]>().mockResolvedValue("tmdb:1"),
    setStatus: vi.fn<LibraryBackend["setStatus"]>().mockResolvedValue(undefined),
    removeShow: vi.fn<LibraryBackend["removeShow"]>().mockResolvedValue(undefined),
    markWatched: vi.fn<LibraryBackend["markWatched"]>().mockResolvedValue(undefined),
    unmarkWatched: vi.fn<LibraryBackend["unmarkWatched"]>().mockResolvedValue(undefined),
    applyWatchedPatch: vi.fn<LibraryBackend["applyWatchedPatch"]>().mockResolvedValue(undefined),
    ...over,
  };
}

/** Records every call it wraps, and passes results and failures through. */
function recordingGuard() {
  const calls: number[] = [];
  return {
    calls,
    guard: async <T,>(work: () => Promise<T>): Promise<T> => {
      calls.push(calls.length);
      return work();
    },
  };
}

describe("guardBackend", () => {
  it("passes every method through the guard", async () => {
    // The point of wrapping: a 401 can surface from any call, and a catch
    // repeated in six methods is a catch one of them will forget.
    const { calls, guard } = recordingGuard();
    const wrapped = guardBackend(fakeBackend(), guard);

    await wrapped.load();
    await wrapped.addShow({ ids: { tmdb: 1 }, title: "x", status: "watching" });
    await wrapped.setStatus("tmdb:1", "hold");
    await wrapped.removeShow("tmdb:1");
    await wrapped.markWatched("tmdb:1", 1, 1);
    await wrapped.unmarkWatched("tmdb:1", 1, 1);
    await wrapped.applyWatchedPatch("tmdb:1", { add: [], remove: [] });

    expect(calls).toHaveLength(7);
  });

  it("keeps the mode readable without going through the guard", () => {
    expect(guardBackend(fakeBackend(), recordingGuard().guard).mode).toBe("simkl");
  });

  it("returns what the wrapped method returned", async () => {
    const wrapped = guardBackend(fakeBackend(), recordingGuard().guard);
    await expect(wrapped.addShow({ ids: { tmdb: 1 }, title: "x", status: "watching" })).resolves.toBe(
      "tmdb:1",
    );
  });

  it("passes a rejection through rather than swallowing it", async () => {
    const backend = fakeBackend({
      setStatus: vi.fn<LibraryBackend["setStatus"]>().mockRejectedValue(new Error("nope")),
    });
    const wrapped = guardBackend(backend, recordingGuard().guard);
    await expect(wrapped.setStatus("tmdb:1", "hold")).rejects.toThrow("nope");
  });

  it("forwards the arguments untouched", async () => {
    const backend = fakeBackend();
    const wrapped = guardBackend(backend, recordingGuard().guard);

    await wrapped.markWatched("tmdb:1", 3, 7, "2026-05-05T00:00:00Z");
    expect(backend.markWatched).toHaveBeenCalledWith("tmdb:1", 3, 7, "2026-05-05T00:00:00Z");
  });

  it("omits an absent watchedAt instead of passing undefined through", async () => {
    // exactOptionalPropertyTypes aside, the store defaults this to now - passing
    // an explicit undefined would defeat that default.
    const backend = fakeBackend();
    const wrapped = guardBackend(backend, recordingGuard().guard);

    await wrapped.markWatched("tmdb:1", 1, 1);
    expect(backend.markWatched).toHaveBeenCalledWith("tmdb:1", 1, 1);
  });
});
