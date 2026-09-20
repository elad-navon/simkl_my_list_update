import { describe, expect, it, vi } from "vitest";
import { createTvmazeClient, normalizeTvmazeEpisodes, tvmazeSeriesEnded } from "./tvmaze";

const passthrough = <T,>(task: () => Promise<T>) => task();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("normalizeTvmazeEpisodes", () => {
  it("prefers airstamp, which is the whole reason for using TVmaze", () => {
    // Only a timestamp with an offset can support a non-drifting "Today" label.
    const [ep] = normalizeTvmazeEpisodes([
      { season: 1, number: 1, airstamp: "2026-09-22T20:00:00+03:00", airdate: "2026-09-22" },
    ]);
    expect(ep?.airDate).toBe("2026-09-22T20:00:00+03:00");
  });

  it("falls back to the bare airdate when there is no airstamp", () => {
    const [ep] = normalizeTvmazeEpisodes([{ season: 1, number: 1, airdate: "2026-09-22" }]);
    expect(ep?.airDate).toBe("2026-09-22");
  });

  it("carries the per-episode runtime SIMKL never had", () => {
    const [ep] = normalizeTvmazeEpisodes([{ season: 1, number: 1, runtime: 42 }]);
    expect(ep?.runtime).toBe(42);
  });

  it("files a special with no season into season 0", () => {
    const [ep] = normalizeTvmazeEpisodes([{ season: null, number: 1, type: "significant_special" }]);
    expect(ep?.season).toBe(0);
  });

  it("drops an episode with no number, which nothing can key on", () => {
    expect(normalizeTvmazeEpisodes([{ season: 1, number: null }])).toEqual([]);
  });

  it("keeps an episode with no date at all", () => {
    const [ep] = normalizeTvmazeEpisodes([{ season: 1, number: 5 }]);
    expect(ep?.airDate).toBeNull();
  });

  it("normalizes a blank name to null", () => {
    const [ep] = normalizeTvmazeEpisodes([{ season: 1, number: 1, name: "  " }]);
    expect(ep?.title).toBeNull();
  });

  it("tolerates a missing payload", () => {
    expect(normalizeTvmazeEpisodes(null)).toEqual([]);
    expect(normalizeTvmazeEpisodes(undefined)).toEqual([]);
  });
});

describe("tvmazeSeriesEnded", () => {
  it("recognises the statuses that mean no more episodes", () => {
    expect(tvmazeSeriesEnded({ id: 1, status: "Ended" })).toBe(true);
    expect(tvmazeSeriesEnded({ id: 1, status: "Canceled" })).toBe(true);
  });

  it("is false for a running show or an unknown status", () => {
    expect(tvmazeSeriesEnded({ id: 1, status: "Running" })).toBe(false);
    expect(tvmazeSeriesEnded({ id: 1 })).toBe(false);
    expect(tvmazeSeriesEnded(null)).toBe(false);
  });
});

describe("createTvmazeClient", () => {
  it("looks a show up by IMDb id first", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ id: 82, name: "Game of Thrones" }));
    const client = createTvmazeClient({ schedule: passthrough, fetchImpl });

    const show = await client.lookupShow({ imdb: "tt0944947", tvdb: 121361 });
    expect(show?.id).toBe(82);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("imdb=tt0944947");
  });

  it("falls back to the TheTVDB id when IMDb finds nothing", async () => {
    // SIMKL's episode data came from TheTVDB, so a show it knew tends to have a
    // TheTVDB id even where it has no IMDb one.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(json({ id: 7 }));
    const client = createTvmazeClient({ schedule: passthrough, fetchImpl });

    const show = await client.lookupShow({ imdb: "tt000", tvdb: 999 });
    expect(show?.id).toBe(7);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("thetvdb=999");
  });

  it("returns null for a show with no ids to look up by", async () => {
    const fetchImpl = vi.fn();
    const client = createTvmazeClient({ schedule: passthrough, fetchImpl });
    await expect(client.lookupShow({})).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks for specials so season 0 arrives too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json([]));
    const client = createTvmazeClient({ schedule: passthrough, fetchImpl });
    await client.getEpisodes(82);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("specials=1");
  });

  it("unwraps the shows out of a search response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json([{ show: { id: 1 } }, { notAShow: true }]));
    const client = createTvmazeClient({ schedule: passthrough, fetchImpl });
    await expect(client.searchShows("buffy")).resolves.toEqual([{ id: 1 }]);
  });

  it("puts every request through the scheduler", async () => {
    // Unpaced requests are how a library this size earns a 429 storm.
    let scheduled = 0;
    const schedule = <T,>(task: () => Promise<T>) => {
      scheduled += 1;
      return task();
    };
    // A fresh Response per call: a body can only be read once.
    const fetchImpl = vi.fn(() => Promise.resolve(json([])));
    const client = createTvmazeClient({ schedule, fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.getEpisodes(1);
    await client.searchShows("x");
    expect(scheduled).toBe(2);
  });
});
