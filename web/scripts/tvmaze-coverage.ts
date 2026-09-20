/**
 * How much of your library does TVmaze actually know?
 *
 *   npm run tvmaze-coverage -- "C:/Elad/TV/library-2026-09-20.json"
 *
 * The plan's largest named risk is that TVmaze - the source that replaces
 * SIMKL's broadcast calendar - has thin coverage of Israeli shows, and says to
 * find out early rather than discover it in the UI. This measures it against
 * the real library, and TVmaze needs no API key, so it can just be run.
 *
 * Two questions, because "TVmaze has the show" is not the same as "TVmaze has
 * enough of the show":
 *
 *  1. Can the show be found at all, by IMDb id or TheTVDB id?
 *  2. Does its episode list cover every episode you have already watched? If
 *     TVmaze lists fewer episodes than your history contains, progress derived
 *     from it alone would be wrong - the show needs TMDB underneath.
 *
 * Reads only, and paced through the same rate limiter the app uses, so a run
 * takes real time: roughly a second per show. Results are cached next to the
 * library, so a second run is instant and only fetches shows it has not seen.
 *
 * By default it checks the statuses whose numbers are actually on screen -
 * watching, hold, plantowatch. Pass --all for the whole library.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createTvmazeClient, normalizeTvmazeEpisodes, type TvmazeShow } from "../src/api/tvmaze";
import { encodeSE } from "../src/domain/types";
import type { Library, LibraryShow } from "../src/library/schema";

type Probe = {
  key: string;
  title: string;
  status: string;
  found: boolean;
  /** Which id the lookup succeeded on, for a sense of what carries the library. */
  matchedBy: "imdb" | "tvdb" | null;
  tvmazeId: number | null;
  tvmazeStatus: string | null;
  episodeCount: number;
  /** Non-special episodes you have watched that TVmaze's list does not contain. */
  missingWatched: string[];
  error: string | null;
};

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const checkAll = args.includes("--all");
const refresh = args.includes("--refresh");

if (!file) {
  console.error("usage: npm run tvmaze-coverage -- <path-to-library.json> [--all] [--refresh]");
  process.exit(2);
}

const DISPLAYED_STATUSES = new Set(["watching", "hold", "plantowatch"]);

const library = JSON.parse(readFileSync(file, "utf8")) as Library;
const shows = Object.values(library.shows).filter(
  (show) => checkAll || DISPLAYED_STATUSES.has(show.status),
);

const cachePath = join(dirname(file), `tvmaze-coverage-${basename(file, ".json")}.json`);
const cache: Record<string, Probe> =
  !refresh && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

const client = createTvmazeClient();

/** Every non-special episode the library records as watched, as sort keys. */
function watchedKeys(show: LibraryShow): Map<number, string> {
  const keys = new Map<number, string>();
  for (const [seasonKey, episodes] of Object.entries(show.watched)) {
    const season = Number(seasonKey);
    if (season === 0) continue;
    for (const episodeKey of Object.keys(episodes)) {
      const episode = Number(episodeKey);
      keys.set(
        encodeSE(season, episode),
        `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
      );
    }
  }
  return keys;
}

async function probe(show: LibraryShow): Promise<Probe> {
  const base: Probe = {
    key: show.key,
    title: show.title,
    status: show.status,
    found: false,
    matchedBy: null,
    tvmazeId: null,
    tvmazeStatus: null,
    episodeCount: 0,
    missingWatched: [],
    error: null,
  };

  try {
    // Done by hand rather than through `lookupShow` so the report can say WHICH
    // id carried the match - that is what tells you whether the library could
    // survive losing its TheTVDB ids.
    let found: TvmazeShow | null = null;
    if (show.ids.imdb) {
      found = await client.lookupShow({ imdb: show.ids.imdb });
      if (found) base.matchedBy = "imdb";
    }
    if (!found && show.ids.tvdb != null) {
      found = await client.lookupShow({ tvdb: show.ids.tvdb });
      if (found) base.matchedBy = "tvdb";
    }
    if (!found) return base;

    base.found = true;
    base.tvmazeId = found.id;
    base.tvmazeStatus = found.status ?? null;

    const episodes = normalizeTvmazeEpisodes(await client.getEpisodes(found.id));
    const listed = new Set(
      episodes.filter((e) => e.season !== 0).map((e) => encodeSE(e.season, e.episode)),
    );
    base.episodeCount = listed.size;

    for (const [key, label] of watchedKeys(show)) {
      if (!listed.has(key)) base.missingWatched.push(label);
    }
    return base;
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
    return base;
  }
}

// --- run --------------------------------------------------------------------

const todo = shows.filter((show) => !cache[show.key]);
console.log(
  `\nChecking ${shows.length} shows (${checkAll ? "whole library" : "displayed statuses only"}); ` +
    `${shows.length - todo.length} already cached, ${todo.length} to fetch.`,
);
if (todo.length) console.log(`Paced at TVmaze's rate limit, so expect about ${Math.ceil(todo.length * 1.2)}s.\n`);

let done = 0;
for (const show of todo) {
  cache[show.key] = await probe(show);
  done += 1;
  if (done % 20 === 0 || done === todo.length) {
    const missing = Object.values(cache).filter((p) => !p.found).length;
    console.log(`  ${done}/${todo.length} fetched, ${missing} not on TVmaze so far`);
    writeFileSync(cachePath, JSON.stringify(cache, null, 2)); // survive an interrupt
  }
}
writeFileSync(cachePath, JSON.stringify(cache, null, 2));

// --- report -----------------------------------------------------------------

const probes = shows.map((show) => cache[show.key]).filter((p): p is Probe => Boolean(p));
const found = probes.filter((p) => p.found);
const missing = probes.filter((p) => !p.found && !p.error);
const errored = probes.filter((p) => p.error);
const incomplete = found.filter((p) => p.missingWatched.length > 0);

const pad = (label: string) => label.padEnd(30);
const line = (label: string, value: string | number) => console.log(`  ${pad(label)}${value}`);
const pct = (n: number) => (probes.length ? `${((n / probes.length) * 100).toFixed(1)}%` : "-");

console.log(`\nTVmaze coverage`);
line("shows checked", probes.length);
line("found on TVmaze", `${found.length} (${pct(found.length)})`);
line("not on TVmaze", `${missing.length} (${pct(missing.length)})`);
if (errored.length) line("errored", errored.length);
line("matched by IMDb id", found.filter((p) => p.matchedBy === "imdb").length);
line("matched by TheTVDB id", found.filter((p) => p.matchedBy === "tvdb").length);
line("episode list too short", incomplete.length);

if (missing.length) {
  console.log(`\nNot on TVmaze - these need TMDB for their episodes`);
  for (const p of missing) console.log(`  ${p.title}  [${p.status}]`);
}

if (incomplete.length) {
  console.log(`\nFound, but TVmaze lists fewer episodes than you have watched`);
  for (const p of incomplete) {
    const sample = p.missingWatched.slice(0, 6).join(", ");
    const more = p.missingWatched.length > 6 ? ` +${p.missingWatched.length - 6} more` : "";
    console.log(`  ${p.title}  [${p.status}]  ${p.episodeCount} listed, missing ${p.missingWatched.length}: ${sample}${more}`);
  }
}

if (errored.length) {
  console.log(`\nErrors`);
  for (const p of errored) console.log(`  ${p.title}: ${p.error}`);
}

console.log(`\nCache: ${cachePath}\n`);
