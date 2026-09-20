import { describe, expect, it, vi } from "vitest";
import {
  createSimklClient,
  normalizeSimklApiEpisodes,
  pollForToken,
  simklSearchResultToSummary,
  SimklAuthError,
  startPinAuth,
} from "./simkl";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fetch mock whose recorded arguments are typed, so the calls can be read. */
const fetchMock = (respond: () => Response) =>
  vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(respond()));

const client = (fetchImpl: unknown) =>
  createSimklClient({ clientId: "cid", token: "tok", fetchImpl: fetchImpl as typeof fetch });

describe("createSimklClient reads", () => {
  it("sends the client id, app identity and bearer token", async () => {
    const fetchImpl = fetchMock(() => json([]));
    await client(fetchImpl).getList("watching");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("client_id=cid");
    expect(url).toContain("app-name=my-list-summary-web");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("asks for the parameters that make per-episode timestamps appear", async () => {
    const fetchImpl = fetchMock(() => json([]));
    await client(fetchImpl).getList("watching");

    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("extended=full");
    expect(url).toContain("episode_watched_at=yes");
  });

  it("unwraps a list SIMKL wrapped in an object", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json({ shows: [{ status: "watching" }] })));
    await expect(client(fetchImpl).getList("watching")).resolves.toHaveLength(1);
  });

  it("returns an empty list rather than null for a missing list", async () => {
    const fetchImpl = fetchMock(() => new Response("", { status: 404 }));
    await expect(client(fetchImpl).getList("hold")).resolves.toEqual([]);
  });

  it("fetches all five lists in one go", async () => {
    const fetchImpl = fetchMock(() => json([]));
    const all = await client(fetchImpl).getAllLists();

    expect(Object.keys(all).sort()).toEqual(
      ["completed", "dropped", "hold", "plantowatch", "watching"].sort(),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("hits the episode endpoint, not the show one", async () => {
    const fetchImpl = fetchMock(() => json([]));
    await client(fetchImpl).getEpisodes(4989);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/tv/episodes/4989");
  });

  it("hits the show endpoint for the rating and network", async () => {
    const fetchImpl = fetchMock(() => json({}));
    await client(fetchImpl).getShowDetail(4989);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(/\/tv\/4989\?/);
  });

  it("turns a 401 into SimklAuthError, which is terminal in the PIN flow", async () => {
    // There is no refresh token, so the UI has to say "authorize again" rather
    // than showing a generic request failure.
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("nope", { status: 401 })));
    await expect(client(fetchImpl).getList("watching")).rejects.toBeInstanceOf(SimklAuthError);
  });

  it("does not turn other failures into auth errors", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("boom", { status: 500 })));
    await expect(client(fetchImpl).getList("watching")).rejects.not.toBeInstanceOf(SimklAuthError);
  });
});

describe("createSimklClient writes", () => {
  it("posts a status change with the show's ids", async () => {
    const fetchImpl = fetchMock(() => json({}));
    await client(fetchImpl).addToList({ simkl: 1, tmdb: 2 }, "completed");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sync/add-to-list");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      shows: [{ ids: { simkl: 1, tmdb: 2 }, to: "completed" }],
    });
  });

  it("posts a removal", async () => {
    const fetchImpl = fetchMock(() => json({}));
    await client(fetchImpl).removeFromList({ simkl: 9 });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/sync/history/remove");
    expect(JSON.parse(String(init.body))).toEqual({ shows: [{ ids: { simkl: 9 } }] });
  });

  it("posts a watched episode in SIMKL's nested shape", async () => {
    const fetchImpl = fetchMock(() => json({}));
    await client(fetchImpl).markEpisodeWatched(4989, 3, 7);

    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toEqual({
      shows: [{ ids: { simkl: 4989 }, seasons: [{ number: 3, episodes: [{ number: 7 }] }] }],
    });
  });

  it("raises SimklAuthError on a 401 write too", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("", { status: 401 })));
    await expect(client(fetchImpl).markEpisodeWatched(1, 1, 1)).rejects.toBeInstanceOf(SimklAuthError);
  });

  it("reports a failed write rather than resolving quietly", async () => {
    // A write that silently failed would leave the mirror disagreeing with SIMKL.
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("bad", { status: 400 })));
    await expect(client(fetchImpl).addToList({ simkl: 1 }, "watching")).rejects.toThrow(/400/);
  });

  it("accepts an empty response body on a successful write", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
    await expect(client(fetchImpl).removeFromList({ simkl: 1 })).resolves.toBeUndefined();
  });
});

describe("startPinAuth", () => {
  it("returns the code and the interval SIMKL asked for", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        json({ user_code: "ABC123", verification_url: "https://simkl.com/pin", interval: 3, expires_in: 600 }),
      ),
    );
    await expect(startPinAuth("cid", fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      userCode: "ABC123",
      verificationUrl: "https://simkl.com/pin",
      intervalSec: 3,
      expiresIn: 600,
    });
  });

  it("falls back to SIMKL's documented defaults", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json({ user_code: "X" })));
    const start = await startPinAuth("cid", fetchImpl as unknown as typeof fetch);
    expect(start).toMatchObject({ verificationUrl: "https://simkl.com/pin", intervalSec: 5, expiresIn: 900 });
  });

  it("fails loudly when no code came back, since there is nothing to show", async () => {
    const fetchImpl = fetchMock(() => json({}));
    await expect(startPinAuth("cid", fetchImpl as unknown as typeof fetch)).rejects.toThrow(/PIN code/);
  });
});

describe("pollForToken", () => {
  /** Sleeping advances the clock instead of waiting, so a poll test is instant. */
  function fakeClock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  const START = { userCode: "ABC", verificationUrl: "u", intervalSec: 5, expiresIn: 30 };

  it("returns the token once the user approves", async () => {
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ result: "KO" }))
      .mockResolvedValueOnce(json({ result: "OK", access_token: "tok" }));

    await expect(
      pollForToken("cid", START, { ...clock, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe("tok");
  });

  it("waits the interval SIMKL asked for before the first poll", async () => {
    const clock = fakeClock();
    const sleep = vi.fn(clock.sleep);
    const fetchImpl = vi.fn(() => Promise.resolve(json({ result: "OK", access_token: "t" })));

    await pollForToken("cid", START, {
      now: clock.now,
      sleep,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("keeps polling through a transient failure", async () => {
    // The user is off approving in another tab; one bad response is no reason to
    // make them start over.
    const clock = fakeClock();
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(json({ result: "OK", access_token: "tok" }));

    await expect(
      pollForToken("cid", START, { ...clock, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBe("tok");
  });

  it("returns null when the code expires, which the UI offers a retry for", async () => {
    const clock = fakeClock();
    const fetchImpl = vi.fn(() => Promise.resolve(json({ result: "KO" })));

    await expect(
      pollForToken("cid", START, { ...clock, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeNull();
    // 30s window, 5s interval.
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("stops when the caller aborts", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => {
      controller.abort();
      return Promise.resolve(json({ result: "KO" }));
    });

    await expect(
      pollForToken("cid", START, {
        ...clock,
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeSimklApiEpisodes", () => {
  it("keeps SIMKL's offset-bearing timestamp", () => {
    const [ep] = normalizeSimklApiEpisodes([
      { season: 1, episode: 1, date: "1997-03-10T19:00:00-05:00", title: "Welcome" },
    ]);
    expect(ep).toEqual({
      season: 1,
      episode: 1,
      airDate: "1997-03-10T19:00:00-05:00",
      title: "Welcome",
      runtime: null,
    });
  });

  it("drops the unnumbered specials SIMKL ships", () => {
    expect(
      normalizeSimklApiEpisodes([{ type: "special", title: "Extra" }, { season: 1, episode: 1 }]),
    ).toHaveLength(1);
  });

  it("keeps a dateless episode", () => {
    const [ep] = normalizeSimklApiEpisodes([{ season: 1, episode: 5 }]);
    expect(ep?.airDate).toBeNull();
  });

  it("tolerates a missing payload", () => {
    expect(normalizeSimklApiEpisodes(null)).toEqual([]);
  });
});

describe("simklSearchResultToSummary", () => {
  it("normalizes a result to the same shape TMDB's uses", () => {
    expect(
      simklSearchResultToSummary({
        title: "Six Feet Under",
        year: 2001,
        poster: "33/335225a3fdbf155",
        ids: { simkl: 4989, tmdb: "1274", imdb: "tt0248654" },
      }),
    ).toEqual({
      title: "Six Feet Under",
      year: "2001",
      posterUrl: "https://simkl.in/posters/33/335225a3fdbf155_m.jpg",
      ids: { simkl: 4989, tmdb: 1274, imdb: "tt0248654" },
    });
  });

  it("coerces SIMKL's string tmdb id to a number", () => {
    expect(simklSearchResultToSummary({ ids: { tmdb: "42" } }).ids.tmdb).toBe(42);
  });

  it("omits an id SIMKL did not supply", () => {
    expect(simklSearchResultToSummary({ title: "X", ids: {} }).ids).toEqual({});
  });

  it("leaves the poster null rather than building a broken url", () => {
    expect(simklSearchResultToSummary({ title: "X" }).posterUrl).toBeNull();
  });
});
