import { describe, expect, it, vi } from "vitest";
import { createOmdbClient, parseRating, parseVotes } from "./omdb";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("parseRating", () => {
  it("parses a rating", () => {
    expect(parseRating("8.6")).toBe(8.6);
  });

  it("treats OMDb's literal N/A as no rating", () => {
    expect(parseRating("N/A")).toBeNull();
  });

  it("rejects a zero or unparseable rating rather than showing 0.0", () => {
    expect(parseRating("0")).toBeNull();
    expect(parseRating("abc")).toBeNull();
    expect(parseRating(null)).toBeNull();
  });
});

describe("parseVotes", () => {
  it("strips the thousands separators OMDb sends", () => {
    expect(parseVotes("1,234,567")).toBe(1234567);
  });

  it("returns null for junk or absence", () => {
    expect(parseVotes("N/A")).toBeNull();
    expect(parseVotes(undefined)).toBeNull();
  });
});

describe("createOmdbClient", () => {
  it("returns the rating and vote count", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ Response: "True", imdbRating: "9.2", imdbVotes: "2,100,000" }));
    const client = createOmdbClient({ apiKey: "k", fetchImpl });

    await expect(client.getRating("tt0903747")).resolves.toEqual({ rating: 9.2, votes: 2100000 });
  });

  it("sends the IMDb id and the key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ Response: "True", imdbRating: "8.0" }));
    await createOmdbClient({ apiKey: "k", fetchImpl }).getRating("tt1");

    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain("i=tt1");
    expect(url).toContain("apikey=k");
  });

  it("reads OMDb's 200-with-Response-False as a miss, not a hit", async () => {
    // A bare res.ok check would take this for success.
    const fetchImpl = vi.fn().mockResolvedValue(json({ Response: "False", Error: "Incorrect IMDb ID." }));
    await expect(createOmdbClient({ apiKey: "k", fetchImpl }).getRating("tt1")).resolves.toBeNull();
  });

  it("returns null when the rating itself is N/A", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ Response: "True", imdbRating: "N/A" }));
    await expect(createOmdbClient({ apiKey: "k", fetchImpl }).getRating("tt1")).resolves.toBeNull();
  });

  it("makes no request at all without a key, since the rating is optional", async () => {
    // A user who never sets a key should not see errors about one.
    const fetchImpl = vi.fn();
    await expect(createOmdbClient({ apiKey: null, fetchImpl }).getRating("tt1")).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("makes no request for a show with no IMDb id", async () => {
    const fetchImpl = vi.fn();
    await expect(createOmdbClient({ apiKey: "k", fetchImpl }).getRating(null)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
