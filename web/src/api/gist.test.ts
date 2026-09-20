import { describe, expect, it, vi } from "vitest";
import { createGistClient, GistAuthError, LIBRARY_FILENAME } from "./gist";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetchMock = (...responses: Response[]) => {
  const mock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(responses.shift() ?? json({})));
  return mock;
};
const client = (fetchImpl: unknown) =>
  createGistClient({ token: "tok", fetchImpl: fetchImpl as typeof fetch });

describe("create", () => {
  it("creates a private gist holding library.json", async () => {
    const fetchImpl = fetchMock(json({ id: "abc", html_url: "https://gist.github.com/abc" }));
    const result = await client(fetchImpl).create('{"shows":{}}');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/gists");
    expect(init.method).toBe("POST");

    const body = JSON.parse(String(init.body)) as { public: boolean; files: Record<string, unknown> };
    // "Private" on a gist means unlisted, not encrypted - but it does mean it
    // does not appear on a profile or in search.
    expect(body.public).toBe(false);
    expect(Object.keys(body.files)).toEqual([LIBRARY_FILENAME]);
    expect(result).toEqual({ gistId: "abc", htmlUrl: "https://gist.github.com/abc" });
  });

  it("sends the token and the API version", async () => {
    const fetchImpl = fetchMock(json({ id: "abc" }));
    await client(fetchImpl).create("{}");

    const headers = (fetchImpl.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("raises a specific error for a rejected token", async () => {
    // The recovery is specific and nothing else fixes it: wrong, expired, or
    // missing the gist scope.
    const fetchImpl = fetchMock(new Response("Bad credentials", { status: 401 }));
    await expect(client(fetchImpl).create("{}")).rejects.toBeInstanceOf(GistAuthError);
  });

  it("treats a 403 as an authorization problem too, since that is the scope case", async () => {
    const fetchImpl = fetchMock(new Response("Forbidden", { status: 403 }));
    await expect(client(fetchImpl).create("{}")).rejects.toBeInstanceOf(GistAuthError);
  });

  it("fails loudly when GitHub returns no id to store", async () => {
    const fetchImpl = fetchMock(json({}));
    await expect(client(fetchImpl).create("{}")).rejects.toThrow(/no id/);
  });
});

describe("read", () => {
  it("returns the file's content", async () => {
    const fetchImpl = fetchMock(
      json({
        id: "abc",
        updated_at: "2026-09-20T00:00:00Z",
        files: { [LIBRARY_FILENAME]: { content: '{"shows":{}}' } },
      }),
    );
    await expect(client(fetchImpl).read("abc")).resolves.toEqual({
      gistId: "abc",
      content: '{"shows":{}}',
      updatedAt: "2026-09-20T00:00:00Z",
    });
  });

  it("follows raw_url when GitHub truncated the file", async () => {
    // Not a rare edge: this library exports to 1.3MB, well past the threshold,
    // so the raw fetch is the normal path.
    const fetchImpl = fetchMock(
      json({
        id: "abc",
        files: {
          [LIBRARY_FILENAME]: {
            truncated: true,
            content: '{"sho',
            raw_url: "https://gist.githubusercontent.com/raw/abc",
          },
        },
      }),
      new Response('{"shows":{"tmdb:1":{}}}', { status: 200 }),
    );

    const snapshot = await client(fetchImpl).read("abc");
    expect(snapshot?.content).toBe('{"shows":{"tmdb:1":{}}}');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("gist.githubusercontent.com");
  });

  it("does not send the token to the raw host", async () => {
    // raw_url carries its own access; the token was issued for api.github.com.
    const fetchImpl = fetchMock(
      json({ id: "abc", files: { [LIBRARY_FILENAME]: { truncated: true, raw_url: "https://raw/abc" } } }),
      new Response("{}", { status: 200 }),
    );
    await client(fetchImpl).read("abc");

    const rawInit = (fetchImpl.mock.calls[1] as [string, RequestInit | undefined])[1];
    expect(rawInit).toBeUndefined();
  });

  it("falls back to the partial content when the raw fetch fails", async () => {
    const fetchImpl = fetchMock(
      json({
        id: "abc",
        files: { [LIBRARY_FILENAME]: { truncated: true, content: "partial", raw_url: "https://raw/abc" } },
      }),
      new Response("nope", { status: 500 }),
    );
    expect((await client(fetchImpl).read("abc"))?.content).toBe("partial");
  });

  it("returns null for a gist that is gone", async () => {
    // The caller's answer is to create a new one, which is the same answer as
    // never having had one.
    const fetchImpl = fetchMock(new Response("", { status: 404 }));
    await expect(client(fetchImpl).read("abc")).resolves.toBeNull();
  });

  it("returns null when the gist has no library.json", async () => {
    const fetchImpl = fetchMock(json({ id: "abc", files: { "notes.txt": { content: "hi" } } }));
    await expect(client(fetchImpl).read("abc")).resolves.toBeNull();
  });

  it("raises an authorization error rather than reporting an empty backup", async () => {
    // A rejected token must never look like "there is nothing backed up".
    const fetchImpl = fetchMock(new Response("Bad credentials", { status: 401 }));
    await expect(client(fetchImpl).read("abc")).rejects.toBeInstanceOf(GistAuthError);
  });
});

describe("update", () => {
  it("patches the one file and reports when GitHub saved it", async () => {
    const fetchImpl = fetchMock(json({ id: "abc", updated_at: "2026-09-20T10:00:00Z" }));
    const result = await client(fetchImpl).update("abc", '{"shows":{}}');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/gists/abc");
    expect(init.method).toBe("PATCH");
    expect(Object.keys(JSON.parse(String(init.body)).files)).toEqual([LIBRARY_FILENAME]);
    expect(result.updatedAt).toBe("2026-09-20T10:00:00Z");
  });

  it("reports a failed write instead of resolving quietly", async () => {
    const fetchImpl = fetchMock(new Response("too large", { status: 422 }));
    await expect(client(fetchImpl).update("abc", "{}")).rejects.toThrow(/422/);
  });
});
