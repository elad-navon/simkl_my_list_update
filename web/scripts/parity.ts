/**
 * Runs the parity harness against a real SIMKL export.
 *
 *   npm run parity -- "C:/Elad/TV/simkl-export-2026-09-20.json"
 *
 * Reads only. Prints where each show's watch history came from, a per-field
 * difference count, every unexplained difference in full, and writes the whole
 * report as JSON next to the export so one run can be diffed against the next.
 *
 * Exits non-zero when any UNEXPLAINED difference remains. Differences that are
 * SIMKL disagreeing with its own episode list are classified and printed, not
 * suppressed - see `ParityCause`.
 *
 * The clock is pinned to the export's own `exportedAt` by default. SIMKL's
 * counts were true at the moment of the export, so deriving with today's clock
 * would invent a difference for every episode that has aired since - a real
 * difference in the data, not in the logic, and therefore noise. Pass
 * --now=<ISO> to override.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { showKey } from "../src/library/schema";
import { extractIds, type SimklExport, type SimklItem } from "../src/library/migrate/simkl";
import type { SimklApiEpisode } from "../src/library/migrate/simklEpisodes";
import {
  compareShow,
  isUnexplained,
  PARITY_CAUSES,
  PARITY_FIELDS,
  summarize,
  type ParityRow,
} from "../src/library/migrate/parity";

type RawExport = SimklExport & {
  episodes?: Record<string, SimklApiEpisode[] | null>;
  errors?: unknown[];
};

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const nowArg = args.find((a) => a.startsWith("--now="))?.slice("--now=".length);
const showAll = args.includes("--all");

if (!file) {
  console.error("usage: npm run parity -- <path-to-simkl-export.json> [--now=ISO] [--all]");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(file, "utf8")) as RawExport;
const exportedAt = raw.exportedAt ?? new Date().toISOString();
const now = new Date(nowArg ?? exportedAt).getTime();

if (Number.isNaN(now)) {
  console.error(`Unparseable clock: ${nowArg ?? exportedAt}`);
  process.exit(2);
}

const rows: ParityRow[] = [];
const skipped: Array<{ title: string; reason: string }> = [];

for (const items of Object.values(raw.lists ?? {})) {
  for (const item of (items ?? []) as SimklItem[]) {
    const title = item.show?.title ?? "(untitled)";
    const ids = extractIds(item);
    const key = showKey(ids);
    if (!key) {
      skipped.push({ title, reason: "no usable id" });
      continue;
    }
    const simklId = ids.simkl;
    const payload = simklId != null ? (raw.episodes?.[String(simklId)] ?? null) : null;
    rows.push(compareShow(item, payload, { title, key, now, exportedAt }));
  }
}

const report = summarize(rows, now);

// --- output -----------------------------------------------------------------

const pct = (n: number) => (rows.length ? ((n / rows.length) * 100).toFixed(1) : "0.0");
const pad = (label: string) => label.padEnd(26);
const line = (label: string, value: string | number) => console.log(`  ${pad(label)}${value}`);
const detailOf = (row: ParityRow) =>
  row.differences
    .map((d) => `${d.field}: simkl=${d.simkl ?? "-"} local=${d.local ?? "-"}`)
    .join("  ·  ");

console.log(`\nParity report`);
line("export", basename(file));
line("exportedAt", exportedAt);
line("clock", `${report.now}${nowArg ? " (overridden)" : " (pinned to export)"}`);
line("shows", rows.length);
line("identical", `${report.identical} (${pct(report.identical)}%)`);
line("explained", report.explained);
line("UNEXPLAINED", report.unexplained);
if (skipped.length) line("skipped", skipped.length);

console.log(`\nWatch history source`);
line("SIMKL per-episode", report.byProvenance["episode-level"]);
line("reconstructed from count", report.byProvenance.reconstructed);
line("nothing watched", report.byProvenance.empty);
const noData = rows.filter((r) => r.noEpisodeData);
if (noData.length) line("no episode list", noData.length);

console.log(`\nDiffering fields (one show can contribute to several)`);
for (const field of PARITY_FIELDS) {
  const n = report.byField[field];
  console.log(`  ${pad(field)}${String(n).padStart(4)}${n === 0 ? "  identical everywhere" : ""}`);
}

console.log(`\nAttributed causes`);
for (const cause of PARITY_CAUSES) {
  const n = report.byCause[cause];
  if (n) console.log(`  ${pad(cause)}${String(n).padStart(4)}`);
}

// The one cause that is a real limitation rather than SIMKL contradicting
// itself, so it gets said out loud instead of sitting in a tally.
const approx = rows.filter((r) => r.differences.some((d) => d.cause === "reconstruction-approximate"));
if (approx.length) {
  console.log(`\nKnown inaccuracy - history rebuilt from a count, boundary episode off by one`);
  for (const row of approx) console.log(`  ${row.title} [${row.status}]  ${detailOf(row)}`);
}

const explainedRows = rows.filter((r) => r.differences.length && !isUnexplained(r) && !approx.includes(r));
if (explainedRows.length) {
  console.log(`\nExplained differences (${explainedRows.length})`);
  for (const row of explainedRows) {
    const causes = [...new Set(row.differences.map((d) => d.cause))].join(", ");
    console.log(`  ${row.title} [${row.status}] (${causes})`);
    console.log(`      ${detailOf(row)}`);
  }
}

const bad = rows.filter(isUnexplained);
if (bad.length) {
  const shown = showAll ? bad : bad.slice(0, 40);
  console.log(`\nUNEXPLAINED differences (${bad.length})`);
  for (const row of shown) {
    console.log(`  ${row.title} [${row.status}] ${row.provenance}${row.noEpisodeData ? " (no episode list)" : ""}`);
    console.log(`      ${detailOf(row)}`);
  }
  if (!showAll && bad.length > shown.length) {
    console.log(`  ... ${bad.length - shown.length} more; re-run with --all`);
  }
} else {
  console.log(`\nNo unexplained differences.`);
}

const out = join(dirname(file), `parity-${basename(file, ".json")}.json`);
writeFileSync(out, JSON.stringify({ ...report, skipped }, null, 2));
console.log(`\nFull report: ${out}\n`);

process.exitCode = report.unexplained === 0 ? 0 : 1;
