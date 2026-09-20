import { describe, expect, it } from "vitest";
import { compareShow, isUnexplained, summarize, type ParityRow } from "./parity";
import type { SimklItem } from "./simkl";
import type { SimklApiEpisode } from "./simklEpisodes";

const EXPORTED_AT = "2026-09-20T00:00:00.000Z";
const NOW = Date.parse(EXPORTED_AT);

const OPTIONS = { title: "Test Show", key: "tmdb:1", now: NOW, exportedAt: EXPORTED_AT };

/** Three episodes aired a month apart, all in the past. */
function threeAired(): SimklApiEpisode[] {
  return [
    { season: 1, episode: 1, date: "2026-01-01T20:00:00+02:00" },
    { season: 1, episode: 2, date: "2026-02-01T20:00:00+02:00" },
    { season: 1, episode: 3, date: "2026-03-01T20:00:00+02:00" },
  ];
}

function item(over: Partial<SimklItem> = {}): SimklItem {
  return {
    status: "watching",
    total_episodes_count: 3,
    not_aired_episodes_count: 0,
    watched_episodes_count: 1,
    next_to_watch: "S01E02",
    seasons: [{ number: 1, episodes: [{ number: 1, watched_at: "2026-01-02T00:00:00Z" }] }],
    show: { title: "Test Show", ids: { simkl: 1, tmdb: 1 } },
    ...over,
  };
}

const causesOf = (row: ParityRow) => row.differences.map((d) => `${d.field}:${d.cause}`);

describe("compareShow", () => {
  it("reports no differences when the derived figures match SIMKL", () => {
    const row = compareShow(item(), threeAired(), OPTIONS);
    expect(row.differences).toEqual([]);
    expect(row.local).toMatchObject({ total: 3, aired: 3, watched: 1, remaining: 2, nextToWatch: "S01E02" });
  });

  it("records where the watch history came from", () => {
    expect(compareShow(item(), threeAired(), OPTIONS).provenance).toBe("episode-level");
    expect(
      compareShow(item({ seasons: null }), threeAired(), OPTIONS).provenance,
    ).toBe("reconstructed");
  });

  it("flags a show SIMKL sent no episode list for", () => {
    const row = compareShow(item(), null, OPTIONS);
    expect(row.noEpisodeData).toBe(true);
  });

  it("derives nextToWatch in SIMKL's own spelling so the sides read together", () => {
    const row = compareShow(item({ next_to_watch: null }), threeAired(), OPTIONS);
    expect(row.differences).toEqual([
      { field: "nextToWatch", simkl: null, local: "S01E02", cause: null },
    ]);
  });
});

describe("attribution", () => {
  it("blames a total gap on SIMKL's stale aggregate", () => {
    // The episode list IS the local total, so nothing else can explain it.
    const row = compareShow(
      item({ total_episodes_count: 2 }),
      threeAired(),
      OPTIONS,
    );
    expect(causesOf(row)).toContain("total:simkl-aggregate-stale");
    expect(isUnexplained(row)).toBe(false);
  });

  it("carries the same gap through to notAired", () => {
    const episodes = [...threeAired(), { season: 1, episode: 4, date: "2026-12-01T20:00:00+02:00" }];
    const row = compareShow(
      item({ total_episodes_count: 3, not_aired_episodes_count: 0 }),
      episodes,
      OPTIONS,
    );
    expect(causesOf(row)).toEqual([
      "total:simkl-aggregate-stale",
      "notAired:simkl-aggregate-stale",
    ]);
  });

  it("refuses to excuse a notAired gap that is bigger than the total gap", () => {
    // Two causes at once means one of them is unaccounted for, so the row fails.
    const episodes: SimklApiEpisode[] = [
      { season: 1, episode: 1, date: "2026-01-01T20:00:00+02:00" },
      { season: 1, episode: 2, date: "2026-12-01T20:00:00+02:00" },
      { season: 1, episode: 3, date: "2026-12-08T20:00:00+02:00" },
    ];
    const row = compareShow(
      item({ total_episodes_count: 2, not_aired_episodes_count: 0, watched_episodes_count: 1, next_to_watch: null }),
      episodes,
      OPTIONS,
    );
    const notAired = row.differences.find((d) => d.field === "notAired");
    expect(notAired?.cause).toBeNull();
    expect(isUnexplained(row)).toBe(true);
  });

  it("excuses an unplaceable undated episode only when nothing is left to watch", () => {
    const episodes: SimklApiEpisode[] = [
      { season: 1, episode: 1, date: "2026-01-01T20:00:00+02:00" },
      { season: 1, episode: 2 },
    ];
    const watchedBoth = item({
      total_episodes_count: 2,
      not_aired_episodes_count: 0,
      watched_episodes_count: 2,
      next_to_watch: null,
      seasons: [
        { number: 1, episodes: [{ number: 1, watched_at: "x" }, { number: 2, watched_at: "y" }] },
      ],
    });
    expect(causesOf(compareShow(watchedBoth, episodes, OPTIONS))).toEqual([
      "notAired:undated-unplaceable",
    ]);
  });

  it("will not excuse an undated episode on a show with episodes outstanding", () => {
    // Here the classification would hide an episode the user could watch.
    const episodes: SimklApiEpisode[] = [
      { season: 1, episode: 1, date: "2026-01-01T20:00:00+02:00" },
      { season: 1, episode: 2 },
    ];
    const row = compareShow(
      item({
        total_episodes_count: 2,
        not_aired_episodes_count: 0,
        watched_episodes_count: 0,
        next_to_watch: "S01E01",
        seasons: null,
      }),
      episodes,
      OPTIONS,
    );
    expect(row.differences.find((d) => d.field === "notAired")?.cause).toBeNull();
  });

  it("excuses a next_to_watch SIMKL names on a show its own counts call finished", () => {
    const finished = item({
      total_episodes_count: 3,
      not_aired_episodes_count: 0,
      watched_episodes_count: 3,
      next_to_watch: "S02E99",
      seasons: [
        {
          number: 1,
          episodes: [{ number: 1, watched_at: "x" }, { number: 2, watched_at: "y" }, { number: 3, watched_at: "z" }],
        },
      ],
    });
    expect(causesOf(compareShow(finished, threeAired(), OPTIONS))).toEqual([
      "nextToWatch:simkl-next-to-watch-stale",
    ]);
  });

  it("does not excuse a next_to_watch difference while episodes really do remain", () => {
    const row = compareShow(item({ next_to_watch: "S01E03" }), threeAired(), OPTIONS);
    expect(row.differences.find((d) => d.field === "nextToWatch")?.cause).toBeNull();
  });

  it("names reconstruction when the count survived but the boundary episode moved", () => {
    // The Flash: 128 watched with one skipped mid-run, so the 128th episode in
    // order is not the one SIMKL stopped at.
    const episodes = [...threeAired(), { season: 1, episode: 4, date: "2026-04-01T20:00:00+02:00" }];
    const row = compareShow(
      item({
        seasons: null,
        total_episodes_count: 4,
        not_aired_episodes_count: 0,
        watched_episodes_count: 2,
        next_to_watch: "S01E04",
      }),
      episodes,
      OPTIONS,
    );
    expect(causesOf(row)).toEqual(["nextToWatch:reconstruction-approximate"]);
    expect(row.local.remaining).toBe(2);
  });

  it("never excuses a watched or remaining difference", () => {
    const row = compareShow(
      item({ watched_episodes_count: 99, next_to_watch: "S01E02" }),
      threeAired(),
      OPTIONS,
    );
    const fields = row.differences.filter((d) => d.field === "watched" || d.field === "remaining");
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((d) => d.cause === null)).toBe(true);
    expect(isUnexplained(row)).toBe(true);
  });
});

describe("summarize", () => {
  const identical = () => compareShow(item(), threeAired(), OPTIONS);
  const explained = () => compareShow(item({ total_episodes_count: 2 }), threeAired(), OPTIONS);
  const broken = () => compareShow(item({ watched_episodes_count: 99 }), threeAired(), OPTIONS);

  it("splits rows into identical, explained and unexplained", () => {
    const report = summarize([identical(), explained(), broken()], NOW);
    expect(report).toMatchObject({ identical: 1, explained: 1, unexplained: 1 });
  });

  it("counts differences per field, not per row", () => {
    const report = summarize([explained()], NOW);
    expect(report.byField.total).toBe(1);
    expect(report.byField.watched).toBe(0);
  });

  it("tallies every cause it attributed, once per difference", () => {
    // One stale aggregate, two fields moved by it: total and remaining.
    const report = summarize([explained()], NOW);
    expect(report.byCause["simkl-aggregate-stale"]).toBe(2);
    expect(report.explained).toBe(1);
  });

  it("tallies where each row's history came from", () => {
    const report = summarize([identical(), compareShow(item({ seasons: null }), threeAired(), OPTIONS)], NOW);
    expect(report.byProvenance["episode-level"]).toBe(1);
    expect(report.byProvenance.reconstructed).toBe(1);
  });

  it("stamps the clock it ran against so a report is reproducible", () => {
    expect(summarize([], NOW).now).toBe(EXPORTED_AT);
  });

  it("reports an empty run as nothing rather than as a pass with content", () => {
    expect(summarize([], NOW)).toMatchObject({ identical: 0, explained: 0, unexplained: 0 });
  });
});
