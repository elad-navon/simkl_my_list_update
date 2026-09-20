import { describe, expect, it, vi } from "vitest";
import { buildUrl, getJson, HttpError, NetworkError } from "./http";

const ok = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

describe("buildUrl", () => {
  it("appends params as a query string", () => {
    expect(buildUrl("https://x/y", { a: "1", b: 2 })).toBe("https://x/y?a=1&b=2");
  });

  it("joins onto a url that already has a query", () => {
    expect(buildUrl("https://x/y?a=1", { b: "2" })).toBe("https://x/y?a=1&b=2");
  });

  it("drops undefined and empty values rather than sending blanks", () => {
    expect(buildUrl("https://x/y", { a: "1", b: undefined, c: "" })).toBe("https://x/y?a=1");
  });

  it("escapes a value that would otherwise break the query", () => {
    expect(buildUrl("https://x/y", { q: "פרפר נחמד & co" })).toContain("%26+co");
  });

  it("returns the bare url when there is nothing to add", () => {
    expect(buildUrl("https://x/y")).toBe("https://x/y");
    expect(buildUrl("https://x/y", {})).toBe("https://x/y");
  });
});

describe("getJson", () => {
  it("parses a successful response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ hello: "world" }));
    await expect(getJson("https://x", { service: "X", fetchImpl })).resolves.toEqual({ hello: "world" });
  });

  it("treats 404 as an answer, not a failure", async () => {
    // A show the service has never heard of must not take a render down.
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    await expect(getJson("https://x", { service: "X", fetchImpl })).resolves.toBeNull();
  });

  it("returns null for an empty 200 body", async () => {
    // TVmaze answers this way for a show with no episodes; JSON.parse("") would
    // otherwise throw as though the service were broken.
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await expect(getJson("https://x", { service: "X", fetchImpl })).resolves.toBeNull();
  });

  it("throws an HttpError naming the service and status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    const error = await getJson("https://x", { service: "TVmaze", fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    const http = error as HttpError;
    expect(http.status).toBe(429);
    expect(http.service).toBe("TVmaze");
    expect(http.message).toContain("TVmaze");
  });

  it("wraps an unreachable service so the failure says where it came from", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await getJson("https://x", { service: "TMDB", fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain("TMDB");
  });

  it("aborts once the timeout elapses", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(
      getJson("https://x", { service: "X", fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("lets the caller's own abort propagate as itself", async () => {
    // A cancelled query is not a service problem, so it must not be reported
    // as one.
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("user aborted")));
        }),
    );
    const promise = getJson("https://x", {
      service: "X",
      signal: controller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    controller.abort();
    await expect(promise).rejects.not.toBeInstanceOf(NetworkError);
  });

  it("sends the params it was given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({}));
    await getJson("https://x/tv", { service: "X", params: { api_key: "k", page: 2 }, fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://x/tv?api_key=k&page=2");
  });
});
