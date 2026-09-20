/**
 * Can the replacement sources account for your whole watch history?
 *
 *   npm run coverage -- "C:/Elad/TV/library-2026-09-20.json"
 *   npm run coverage -- "C:/Elad/TV/library-2026-09-20.json" --tmdb-key=KEY --all
 *
 * This is the gate the plan asks for before SIMKL can be deleted: not "do the
 * services answer" but "does what they return cover every episode you have
 * already watched". If a merged episode list is shorter than your history, the
 * progress derived from it is wrong, and no amount of retrying fixes that - the
 * show needs the manual-episode escape hatch instead.
 *
 * It runs the real `loadEpisodes` rather than a parallel reimplementation, so
 * what it measures is the code path the app will actually use, merge rules and
 * all. Reads only.
 *
 * Without --tmdb-key it measures TVmaze alone, which is still worth knowing
 * since TVmaze is the primary and needs no key. With a key it measures the
 * merge, which is what the app will really have.
 *
 * Paced by TVmaze's rate limit, so budget about a second per show. Results are
 * cached next to the library and a rerun only fetches what it has not seen;
 * pass --refresh to start over. Defaults to the statuses whose numbers are on
 * screen (watching, hold, plantowatch); --all does the whole library.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createTvmazeClient } from "../src/api/tvmaze";
import { createTmdbClient } from "../src/api/tmdb";
import { loadEpisodes, type EpisodeSourceDeps } from "../src/api/episodeSources";
import { computeProgress } from "../src/domain/progress";
import { encodeSE } from "../src/domain/types";
import type { Library, LibraryShow } from "../src/library/schema";

type Probe = {
  key: string;
  title: string;
  status: string;
  sources: { tvmaze: boolean; tmdb: boolean };
  tvmazeId: number | null;
  /** Episodes in the merged list, specials excluded. */
  episodeCount: number;
  /** Merged episodes carrying a real broadcast time rather than a bare date. */
  withBroadcastTime: number;
  /** Episodes only TMDB knew about - TVmaze's gaps. */
  fallbackOnly: number;
  /** Watched episodes no source lists. These are the real failures. */
  missingWatched: string[];
  /** What the app would show as left to watch. */
  remaining: number;
  /**
   * Listed episodes the watch map does not cover. For a `completed` show this
   * should be zero, and anything else is a numbering mismatch between sources -
   * see the report section at the bottom.
   */
  unwatchedListed: number;
  seriesEnded: boolean;
};

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const tmdbKey = args.find((a) => a.startsWith("--tmdb-key="))?.slice("--tmdb-key=".length);
const checkAll = args.includes("--all");
const refresh = args.includes("--refresh");

if (!file) {
  console.error(
    "usage: npm run coverage -- <path-to-library.json> [--tmdb-key=KEY] [--all] [--refresh]",
  );
  process.exit(2);
}

const DISPLAYED_STATUSES = new Set(["watching", "hold", "plantowatch"]);

const library = JSON.parse(readFileSync(file, "utf8")) as Library;
const shows = Object.values(library.shows).filter(
  (show) => checkAll || DISPLAYED_STATUSES.has(show.status),
);

// The cache is keyed by which sources were in play, so a TVmaze-only run and a
// merged run never contaminate each other's numbers.
const mode = tmdbKey ? "merged" : "tvmaze";
const cachePath = join(dirname(file), `coverage-${mode}-${basename(file, ".json")}.json`);
const cache: Record<string, Probe> =
  !refresh && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const deps: EpisodeSourceDeps = {
  tvmaze: createTvmazeClient(),
  tmdb: tmdbKey ? createTmdbClient({ apiKey: tmdbKey }) : null,
};

/** Every non-special episode the library records as watched, as SxxEyy labels. */
function watchedLabels(show: LibraryShow): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [seasonKey, episodes] of Object.entries(show.watched)) {
    const season = Number(seasonKey);
    if (season === 0) continue;
    for (const episodeKey of Object.keys(episodes)) {
      const episode = Number(episodeKey);
      labels.set(
        encodeSE(season, episode),
        `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
      );
    }
  }
  return labels;
}

async function probe(show: LibraryShow): Promise<Probe> {
  const loaded = await loadEpisodes(deps, {
    ids: {
      ...(show.ids.tmdb !== undefined ? { tmdb: show.ids.tmdb } : {}),
      ...(show.ids.imdb !== undefined ? { imdb: show.ids.imdb } : {}),
      ...(show.ids.tvdb !== undefined ? { tvdb: show.ids.tvdb } : {}),
      ...(show.ids.tvmaze !== undefined ? { tvmaze: show.ids.tvmaze } : {}),
    },
  });

  const regular = loaded.episodes.filter((e) => e.season !== 0);
  const listed = new Set(regular.map((e) => encodeSE(e.season, e.episode)));
  const missingWatched: string[] = [];
  for (const [key, label] of watchedLabels(show)) {
    if (!listed.has(key)) missingWatched.push(label);
  }

  const progress = computeProgress(loaded.episodes, show.watched, {
    seriesEnded: loaded.seriesEnded,
  });

  const unwatchedListed = regular.filter((e) => show.watched[e.season]?.[e.episode] == null).length;

  return {
    key: show.key,
    title: show.title,
    status: show.status,
    sources: loaded.sources,
    tvmazeId: loaded.resolved.tvmaze,
    episodeCount: listed.size,
    withBroadcastTime: loaded.coverage.withBroadcastTime,
    fallbackOnly: loaded.coverage.fallbackOnly,
    missingWatched,
    remaining: progress.remaining,
    unwatchedListed,
    seriesEnded: loaded.seriesEnded,
  };
}

// --- run --------------------------------------------------------------------

const todo = shows.filter((show) => !cache[show.key]);
console.log(
  `\nCoverage check: ${mode}${tmdbKey ? "" : " (no TMDB key given - TVmaze only)"}`,
);
console.log(
  `${shows.length} shows (${checkAll ? "whole library" : "displayed statuses only"}); ` +
    `${shows.length - todo.length} cached, ${todo.length} to fetch.`,
);
if (todo.length) console.log(`Expect roughly ${Math.ceil(todo.length * 1.2)}s.\n`);

let done = 0;
for (const show of todo) {
  cache[show.key] = await probe(show);
  done += 1;
  if (done % 20 === 0 || done === todo.length) {
    console.log(`  ${done}/${todo.length}`);
    writeFileSync(cachePath, JSON.stringify(cache, null, 2)); // survive an interrupt
  }
}
writeFileSync(cachePath, JSON.stringify(cache, null, 2));

// --- report -----------------------------------------------------------------

const probes = shows.map((s) => cache[s.key]).filter((p): p is Probe => Boolean(p));
const noSource = probes.filter((p) => !p.sources.tvmaze && !p.sources.tmdb);
const tvmazeOnly = probes.filter((p) => p.sources.tvmaze && !p.sources.tmdb);
const tmdbOnly = probes.filter((p) => !p.sources.tvmaze && p.sources.tmdb);
const both = probes.filter((p) => p.sources.tvmaze && p.sources.tmdb);
const incomplete = probes.filter((p) => p.missingWatched.length > 0);
const noEpisodes = probes.filter((p) => p.episodeCount === 0);

/**
 * SIMKL reported watched === total for every completed show, so a completed show
 * with episodes still listed as unwatched means the sources number the show
 * differently - not that any history was lost.
 *
 * Money Heist is the clearest case: SIMKL and TVmaze both list 41 episodes but
 * split them into seasons differently, so 18 of TVmaze's episode numbers have no
 * counterpart in the migrated history. The rest are mostly two-part episodes
 * that TheTVDB counted as one and TVmaze counts as two.
 *
 * Harmless but visible - the show reads as having episodes left. One "mark
 * remaining as watched" per show settles it for good, which is why this is
 * reported rather than worked around in the data model.
 */
const phantom = probes.filter((p) => p.status === "completed" && p.unwatchedListed > 0);

const pad = (label: string) => label.padEnd(32);
const line = (label: string, value: string | number) => console.log(`  ${pad(label)}${value}`);
const pct = (n: number) => (probes.length ? `${((n / probes.length) * 100).toFixed(1)}%` : "-");

console.log(`\nWhich sources answered`);
line("both", both.length);
line("TVmaze only", tvmazeOnly.length);
line("TMDB only", tmdbOnly.length);
line("neither", noSource.length);

console.log(`\nEpisode data`);
line("shows checked", probes.length);
line("no episodes at all", `${noEpisodes.length} (${pct(noEpisodes.length)})`);
line("history fully covered", `${probes.length - incomplete.length} (${pct(probes.length - incomplete.length)})`);
line("history NOT covered", `${incomplete.length} (${pct(incomplete.length)})`);
line("watched episodes unaccounted", incomplete.reduce((n, p) => n + p.missingWatched.length, 0));
line("episodes only TMDB had", probes.reduce((n, p) => n + p.fallbackOnly, 0));
line("episodes with a broadcast time", probes.reduce((n, p) => n + p.withBroadcastTime, 0));
line("completed, yet reading unwatched", phantom.length);

if (tmdbOnly.length) {
  console.log(`\nTVmaze has no record of these - TMDB is carrying them alone`);
  for (const p of tmdbOnly) console.log(`  ${p.title}  [${p.status}]  ${p.episodeCount} episodes`);
}

if (incomplete.length) {
  console.log(`\nWatch history the sources cannot account for`);
  console.log(`These need manual episodes; nothing else will fix them.`);
  for (const p of incomplete.sort((a, b) => b.missingWatched.length - a.missingWatched.length)) {
    const sample = p.missingWatched.slice(0, 6).join(", ");
    const more = p.missingWatched.length > 6 ? ` +${p.missingWatched.length - 6} more` : "";
    const who = [p.sources.tvmaze ? "tvmaze" : null, p.sources.tmdb ? "tmdb" : null]
      .filter(Boolean)
      .join("+") || "none";
    console.log(
      `  ${p.title}  [${p.status}] via ${who}: ${p.episodeCount} listed, ` +
        `${p.missingWatched.length} watched missing: ${sample}${more}`,
    );
  }
}

if (phantom.length) {
  console.log(`\nCompleted shows that still read as having episodes left`);
  console.log(`Source numbering differs from SIMKL's; mark them watched once and they are done.`);
  for (const p of [...phantom].sort((a, b) => b.unwatchedListed - a.unwatchedListed)) {
    console.log(`  ${p.title.padEnd(44)} ${p.unwatchedListed} of ${p.episodeCount} listed`);
  }
  console.log(
    `  ${phantom.length} shows, ${phantom.reduce((n, p) => n + p.unwatchedListed, 0)} episodes total`,
  );
}

if (noSource.length) {
  console.log(`\nNo source answered at all`);
  for (const p of noSource) console.log(`  ${p.title}  [${p.status}]`);
}

console.log(`\nCache: ${cachePath}\n`);

process.exitCode = incomplete.length === 0 ? 0 : 1;
