/**
 * Converts a SIMKL export into a library file.
 *
 *   npm run migrate -- "C:/Elad/TV/simkl-export-2026-09-20.json"
 *
 * Writes `library-<date>.json` next to the export: the same shape the app
 * stores in IndexedDB and the same shape the Gist backup carries, so the file
 * doubles as the first backup and as the import target for the Settings
 * screen's manual import.
 *
 * Re-runnable and non-destructive - it reads the export and writes a new file,
 * touching neither SIMKL nor any existing library. Run `npm run parity` on the
 * same export first; this script prints the same provenance split so the two
 * runs can be read against each other.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { migrateFromSimkl, type SimklExport } from "../src/library/migrate/simkl";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);

if (!file) {
  console.error("usage: npm run migrate -- <path-to-simkl-export.json> [--out=path]");
  process.exit(2);
}

const exported = JSON.parse(readFileSync(file, "utf8")) as SimklExport;
const { library, issues, provenance } = migrateFromSimkl(exported);

const shows = Object.values(library.shows);
const byStatus = new Map<string, number>();
let watchedEpisodes = 0;
for (const show of shows) {
  byStatus.set(show.status, (byStatus.get(show.status) ?? 0) + 1);
  for (const season of Object.values(show.watched)) {
    watchedEpisodes += Object.keys(season).length;
  }
}

const pad = (label: string) => label.padEnd(26);
const line = (label: string, value: string | number) => console.log(`  ${pad(label)}${value}`);

console.log(`\nMigration`);
line("export", basename(file));
line("exportedAt", exported.exportedAt ?? "(absent)");
line("shows imported", shows.length);
line("watched episodes", watchedEpisodes);

console.log(`\nBy status`);
for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) line(status, n);

console.log(`\nWatch history source`);
line("SIMKL per-episode", provenance["episode-level"]);
line("reconstructed from count", provenance.reconstructed);
line("nothing watched", provenance.empty);

if (issues.length) {
  console.log(`\nIssues (${issues.length})`);
  for (const issue of issues) {
    console.log(`  ${issue.reason.padEnd(24)}${issue.title}${issue.detail ? ` - ${issue.detail}` : ""}`);
  }
} else {
  console.log(`\nNo issues.`);
}

const stamp = (exported.exportedAt ?? new Date().toISOString()).slice(0, 10);
const out = outArg ?? join(dirname(file), `library-${stamp}.json`);
writeFileSync(out, JSON.stringify(library, null, 2));
console.log(`\nLibrary: ${out}\n`);
