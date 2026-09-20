/**
 * Times what a first load actually costs, per show and in total.
 *
 *   TMDB_API_KEY=... npm run profile -- "C:/Elad/TV/library-2026-09-20.json"
 *
 * Runs the real `loadEpisodes` against the real services, with the same rate
 * limiter the app uses, so the number it prints is the number the browser gets.
 * Written because an estimate was wrong by a lot: the app was predicted to fill
 * its cards in about two minutes and in practice filled one.
 *
 * Reports the wait BEFORE each request as well as the request's own duration,
 * because those are different problems with different fixes - one is pacing, the
 * other is the service.
 */

import { readFileSync } from "node:fs";
import { createTvmazeClient } from "../src/api/tvmaze";
import { createTmdbClient } from "../src/api/tmdb";
import { createRateLimiter, TVMAZE_RATE_LIMIT } from "../src/api/rateLimit";
import { loadEpisodes } from "../src/api/episodeSources";
import type { Library } from "../src/library/schema";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? 0);
const status = args.find((a) => a.startsWith("--status="))?.slice("--status=".length) ?? "watching";

if (!file) {
  console.error("usage: TMDB_API_KEY=... npm run profile -- <library.json> [--limit=N] [--status=S]");
  process.exit(2);
}

const tmdbKey = process.env["TMDB_API_KEY"];
if (!tmdbKey) {
  console.error("TMDB_API_KEY is required - without it only half the work happens.");
  process.exit(2);
}

const library = JSON.parse(readFileSync(file, "utf8")) as Library;
const shows = Object.values(library.shows).filter((s) => s.status === status);
const selected = limit > 0 ? shows.slice(0, limit) : shows;

// --- instrumented clients ---------------------------------------------------

type Call = { service: string; waitedMs: number; tookMs: number };
const calls: Call[] = [];

/** Wraps fetch so every request records how long it waited and how long it took. */
function timedFetch(service: string, schedulerStart: () => number): typeof fetch {
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const waitedMs = Date.now() - schedulerStart();
    const started = Date.now();
    try {
      return await fetch(input, init);
    } finally {
      calls.push({ service, waitedMs, tookMs: Date.now() - started });
    }
  };
}

const runStart = Date.now();
const sinceStart = () => runStart;

const tvmaze = createTvmazeClient({
  schedule: createRateLimiter(TVMAZE_RATE_LIMIT),
  fetchImpl: timedFetch("tvmaze", sinceStart),
});
const tmdb = createTmdbClient({ apiKey: tmdbKey, fetchImpl: timedFetch("tmdb", sinceStart) });

// --- run --------------------------------------------------------------------

console.log(`\nProfiling a first load of ${selected.length} "${status}" shows.\n`);

type Row = { title: string; ms: number; episodes: number; sources: string };
const rows: Row[] = [];

// All at once, which is what the app does: every card mounts its own query.
await Promise.all(
  selected.map(async (show) => {
    const started = Date.now();
    // The watch history has to go in, or the profile measures a path the app no
    // longer takes: it is what decides whether TMDB's per-season lists are needed.
    const loaded = await loadEpisodes({ tvmaze, tmdb }, { ids: show.ids, watched: show.watched });
    const ms = Date.now() - started;

    rows.push({
      title: show.title,
      ms,
      episodes: loaded.episodes.length,
      sources: [
        loaded.sources.tvmaze ? "tvmaze" : null,
        loaded.sources.tmdb ? "tmdb" : null,
        loaded.sources.tmdbSeasons ? "tmdb-seasons" : null,
      ]
        .filter(Boolean)
        .join("+") || "none",
    });

    // Printed as they land, so the shape of the problem is visible while it runs
    // rather than only in the summary.
    if (rows.length % 10 === 0 || rows.length === selected.length) {
      console.log(`  ${rows.length}/${selected.length} resolved, ${((Date.now() - runStart) / 1000).toFixed(1)}s elapsed`);
    }
  }),
);

const totalMs = Date.now() - runStart;

// --- report -----------------------------------------------------------------

const pad = (label: string) => label.padEnd(30);
const line = (label: string, value: string | number) => console.log(`  ${pad(label)}${value}`);
const byService = (service: string) => calls.filter((c) => c.service === service);
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const median = (ns: number[]) => {
  if (ns.length === 0) return 0;
  const sorted = [...ns].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

console.log(`\nTotal`);
line("wall clock", `${(totalMs / 1000).toFixed(1)}s`);
line("shows", rows.length);
line("requests", calls.length);

for (const service of ["tvmaze", "tmdb"]) {
  const serviceCalls = byService(service);
  if (serviceCalls.length === 0) continue;
  console.log(`\n${service}`);
  line("requests", serviceCalls.length);
  line("median request", `${median(serviceCalls.map((c) => c.tookMs))}ms`);
  line("slowest request", `${Math.max(...serviceCalls.map((c) => c.tookMs))}ms`);
  line("time spent in requests", `${(sum(serviceCalls.map((c) => c.tookMs)) / 1000).toFixed(1)}s`);
  // How far into the run the last one was even STARTED, which is the pacing cost
  // rather than the service's.
  line("last request started at", `${(Math.max(...serviceCalls.map((c) => c.waitedMs)) / 1000).toFixed(1)}s`);
}

const slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 10);
console.log(`\nSlowest shows`);
for (const row of slowest) {
  console.log(`  ${row.title.padEnd(40)} ${(row.ms / 1000).toFixed(1)}s  ${row.episodes} episodes via ${row.sources}`);
}

const firstTen = [...rows].sort((a, b) => a.ms - b.ms).slice(0, 3);
console.log(`\nFastest shows`);
for (const row of firstTen) {
  console.log(`  ${row.title.padEnd(40)} ${(row.ms / 1000).toFixed(1)}s  ${row.episodes} episodes via ${row.sources}`);
}
console.log();
