/**
 * One-time import of a SIMKL export into the local library.
 *
 * This is the only file in the project that knows SIMKL's data shape, and it
 * is deliberately pure: it takes the JSON produced by `tools/export-simkl.js`
 * and returns a Library, with no network and no storage. That makes the
 * migration testable, re-runnable, and deletable once the cut-over is done.
 *
 * It maps only what SIMKL cannot give back later: which shows are on your
 * list, under what status, and which episodes you have watched. SIMKL's
 * pre-computed counts are read too, but ONLY so `compareToSimkl` can check
 * the locally derived numbers against them - they are never stored.
 */

import type { ShowStatus } from "../../domain/types";
import { SHOW_STATUSES } from "../../domain/types";
import {
  emptyLibrary,
  showKey,
  type Library,
  type LibraryShow,
  type ShowIds,
} from "../schema";

// --- SIMKL's wire shape, as much of it as this file touches -----------------

type SimklEpisode = { number?: number | null; watched_at?: string | null };
type SimklSeason = { number?: number | null; episodes?: SimklEpisode[] | null };

export type SimklItem = {
  status?: string | null;
  next_to_watch?: string | null;
  total_episodes_count?: number | null;
  not_aired_episodes_count?: number | null;
  watched_episodes_count?: number | null;
  last_watched_at?: string | null;
  seasons?: SimklSeason[] | null;
  show?: {
    title?: string | null;
    year?: number | null;
    ids?: { simkl?: number | null; tmdb?: number | string | null; imdb?: string | null; tvdb?: number | string | null } | null;
  } | null;
};

export type SimklExport = {
  exportedAt?: string;
  lists?: Partial<Record<ShowStatus, SimklItem[]>>;
  episodes?: Record<string, unknown>;
};

// --- mapping ----------------------------------------------------------------

function toNumber(value: number | string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function extractIds(item: SimklItem): ShowIds {
  const ids = item.show?.ids ?? {};
  return {
    tmdb: toNumber(ids.tmdb),
    imdb: ids.imdb ?? undefined,
    tvdb: toNumber(ids.tvdb),
    simkl: toNumber(ids.simkl),
  };
}

/**
 * SIMKL's per-episode watch data, flattened into the library's watch map.
 *
 * `episode_watched_at=yes` is what makes `watched_at` present; without it
 * SIMKL returns the episode numbers but no timestamps. An episode with no
 * timestamp is still watched - it just loses its date, so it is recorded
 * against the show's `last_watched_at`, or failing that the export date,
 * rather than being dropped.
 */
export function extractWatched(item: SimklItem, fallbackTimestamp: string): Record<number, Record<number, string>> {
  const out: Record<number, Record<number, string>> = {};
  const fallback = item.last_watched_at ?? fallbackTimestamp;

  for (const season of item.seasons ?? []) {
    const seasonNumber = season?.number;
    if (seasonNumber == null) continue;
    for (const episode of season.episodes ?? []) {
      const episodeNumber = episode?.number;
      if (episodeNumber == null) continue;
      out[seasonNumber] ??= {};
      out[seasonNumber][episodeNumber] = episode.watched_at ?? fallback;
    }
  }
  return out;
}

function normalizeStatus(status: string | null | undefined): ShowStatus | null {
  if (!status) return null;
  return (SHOW_STATUSES as readonly string[]).includes(status) ? (status as ShowStatus) : null;
}

export type MigrationIssue = {
  title: string;
  reason: "no-usable-id" | "unknown-status" | "duplicate-key";
  detail?: string;
};

export type MigrationResult = {
  library: Library;
  issues: MigrationIssue[];
};

export function migrateFromSimkl(exported: SimklExport): MigrationResult {
  const library = emptyLibrary();
  const issues: MigrationIssue[] = [];
  const exportedAt = exported.exportedAt ?? new Date().toISOString();

  for (const [listStatus, items] of Object.entries(exported.lists ?? {})) {
    for (const item of items ?? []) {
      const title = item.show?.title ?? "(untitled)";

      // The list a show came from is more reliable than its own `status`
      // field, which SIMKL sometimes leaves stale.
      const status = normalizeStatus(listStatus) ?? normalizeStatus(item.status);
      if (!status) {
        issues.push({ title, reason: "unknown-status", detail: listStatus });
        continue;
      }

      const ids = extractIds(item);
      const key = showKey(ids);
      if (!key) {
        issues.push({ title, reason: "no-usable-id" });
        continue;
      }

      if (library.shows[key]) {
        // A show can legitimately appear once per list; keep the first and
        // report it rather than silently losing the other one's history.
        issues.push({ title, reason: "duplicate-key", detail: key });
        continue;
      }

      const show: LibraryShow = {
        key,
        ids,
        title,
        year: item.show?.year ?? undefined,
        status,
        watched: extractWatched(item, exportedAt),
        addedAt: exportedAt,
        updatedAt: exportedAt,
      };
      library.shows[key] = show;
    }
  }

  return { library, issues };
}

// --- parity checking --------------------------------------------------------

export type ParityRow = {
  key: string;
  title: string;
  simkl: { total: number; notAired: number; watched: number; remaining: number; nextToWatch: string | null };
  local: { total: number; notAired: number; watched: number; remaining: number; nextToWatch: string | null };
  differences: string[];
};

/** SIMKL's own remaining-count formula, app.js:813-818. */
export function simklRemaining(item: SimklItem): number {
  const total = item.total_episodes_count ?? 0;
  const notAired = item.not_aired_episodes_count ?? 0;
  const watched = item.watched_episodes_count ?? 0;
  return Math.max(Math.max(total - notAired, 0) - watched, 0);
}

/** "S03E07" -> { season: 3, episode: 7 }, app.js:847-852. */
export function parseNextEpisode(nextToWatch: string | null | undefined): { season: number; episode: number } | null {
  if (!nextToWatch) return null;
  const m = /S(\d+)E(\d+)/i.exec(nextToWatch);
  if (!m?.[1] || !m[2]) return null;
  return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
}

export function formatSE(se: { season: number; episode: number } | null): string | null {
  if (!se) return null;
  return `S${String(se.season).padStart(2, "0")}E${String(se.episode).padStart(2, "0")}`;
}
