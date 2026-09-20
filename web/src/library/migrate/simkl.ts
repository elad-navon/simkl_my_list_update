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
import { normalizeSimklEpisodes, type SimklApiEpisode } from "./simklEpisodes";

// --- SIMKL's wire shape, as much of it as this file touches -----------------

type SimklEpisode = { number?: number | null; watched_at?: string | null };
type SimklSeason = { number?: number | null; episodes?: SimklEpisode[] | null };

export type SimklItem = {
  status?: string | null;
  added_to_watchlist_at?: string | null;
  next_to_watch?: string | null;
  /**
   * SIMKL's "SxxEyy" marker for the furthest episode watched. Read only as a
   * cross-check, never as a cutoff: it goes stale, reading `S02E99` or a
   * special's `S00E15` on shows whose history is complete.
   */
  last_watched?: string | null;
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
  /** Keyed by SIMKL show id, as `tools/export-simkl.js` writes it. */
  episodes?: Record<string, SimklApiEpisode[] | null> | undefined;
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
  reason:
    | "no-usable-id"
    | "unknown-status"
    | "duplicate-key"
    /**
     * SIMKL says more episodes were watched than its episode list contains, so
     * some of the count could not be placed on a specific episode. The history
     * kept is everything that could be placed; nothing is invented to make the
     * number add up.
     */
    | "watch-count-shortfall";
  detail?: string;
};

export type MigrationResult = {
  library: Library;
  issues: MigrationIssue[];
  /**
   * How many shows' histories came from SIMKL episode by episode versus were
   * rebuilt from a count. Printed by the migration so the split is on the
   * record rather than buried - see `reconstructWatched` for why the second
   * group exists and how exact it is.
   */
  provenance: Record<WatchProvenance, number>;
};

export function migrateFromSimkl(exported: SimklExport): MigrationResult {
  const library = emptyLibrary();
  const issues: MigrationIssue[] = [];
  const provenance: Record<WatchProvenance, number> = {
    "episode-level": 0,
    reconstructed: 0,
    empty: 0,
  };
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

      const episodes = normalizeSimklEpisodes(
        ids.simkl != null ? exported.episodes?.[String(ids.simkl)] : null,
      );
      const watch = reconstructWatched(item, episodes, exportedAt);
      provenance[watch.provenance] += 1;

      if (watch.shortfall != null) {
        issues.push({
          title,
          reason: "watch-count-shortfall",
          detail: `SIMKL counted ${item.watched_episodes_count ?? 0} watched, only ${
            (item.watched_episodes_count ?? 0) - watch.shortfall
          } episodes exist to place them on`,
        });
      }

      const show: LibraryShow = {
        key,
        ids,
        title,
        year: item.show?.year ?? undefined,
        status,
        watched: watch.watched,
        summary: summaryFromSimkl(item, exportedAt),
        addedAt: item.added_to_watchlist_at ?? exportedAt,
        updatedAt: exportedAt,
      };
      library.shows[key] = show;
    }
  }

  return { library, issues, provenance };
}

// --- parity checking --------------------------------------------------------

export type ParityRow = {
  key: string;
  title: string;
  simkl: { total: number; notAired: number; watched: number; remaining: number; nextToWatch: string | null };
  local: { total: number; notAired: number; watched: number; remaining: number; nextToWatch: string | null };
  differences: string[];
};

/**
 * Seeds the cached progress summary from SIMKL's own figures.
 *
 * The summary decides which shows appear on My List, and computing it properly
 * needs each show's episode list - a hundred requests before the list can even be
 * built. SIMKL has already answered the only question the list asks, because its
 * `next_to_watch` is exactly what the old app listed on (app.js:1157), so there is
 * no reason to go and ask again before showing anything.
 *
 * Still a cache: the real derivation overwrites it the first time each show loads.
 * What this avoids is an empty or wrong list in the meantime.
 */
export function summaryFromSimkl(item: SimklItem, now: string): NonNullable<LibraryShow["summary"]> {
  return {
    remaining: simklRemaining(item),
    // SIMKL's list response carries no air date for the next episode, only its
    // code. Ordering falls back to the last watch, which the library does have.
    nextAirDate: null,
    checkedAt: now,
  };
}

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

// --- reconstructing watch history where SIMKL withholds it ------------------

/**
 * How a show's watch map was arrived at. Recorded per show so the migration
 * report can state exactly which history is SIMKL's own and which is inferred.
 */
export type WatchProvenance = "episode-level" | "reconstructed" | "empty";

export type ReconstructedWatch = {
  watched: Record<number, Record<number, string>>;
  provenance: WatchProvenance;
  /** Set when the count SIMKL reports and the episodes we could place disagree. */
  shortfall?: number;
};

/**
 * Builds a show's watch map, reconstructing it when SIMKL gives no episodes.
 *
 * `/sync/all-items/shows/{status}` returns per-episode `seasons` data for
 * `watching` and `hold`, and NONE for `completed` or `dropped`, whatever
 * `episode_watched_at=yes` is set to. That is 584 of the 709 shows in this
 * library - the bulk of a decade of watch history - so the migration cannot
 * simply skip them, and it must not pretend to certainty it does not have.
 *
 * What SIMKL does give for those shows is `watched_episodes_count`, plus
 * `last_watched` as a cross-check. Reconstruction takes the first N episodes
 * in broadcast order, and it is exact far more often than that sounds:
 *
 * - `completed` (444 shows): `watched_episodes_count === total_episodes_count`
 *   for every single one, so "the first N" is "all of them". Exact by
 *   definition, and no ordering assumption is involved at all.
 * - `dropped` (140 shows): the Nth episode in broadcast order is exactly
 *   SIMKL's `last_watched` for 136 of them, 3 more have nothing watched, and
 *   one - The Flash, stopped at S06E15 with one episode skipped along the way -
 *   resolves to S06E14 instead. The count is right; one episode's identity is
 *   not.
 *
 * So 708 of 709 shows migrate exactly and one is off by a single episode on a
 * dropped show. The count is always SIMKL's own, never inflated: taking the
 * FIRST N rather than everything through `last_watched` means the error can
 * only ever be which episode, not how many.
 *
 * `last_watched` is deliberately not used as the cutoff, because SIMKL leaves
 * it stale - it reads `S00E15` (a special) or `S02E99` on 18 completed shows
 * whose real history is complete.
 */
export function reconstructWatched(
  item: SimklItem,
  episodes: readonly { season: number; episode: number }[],
  exportedAt: string,
): ReconstructedWatch {
  const fromSeasons = extractWatched(item, exportedAt);
  if (Object.keys(fromSeasons).length > 0) {
    return { watched: fromSeasons, provenance: "episode-level" };
  }

  const count = item.watched_episodes_count ?? 0;
  if (count <= 0) return { watched: {}, provenance: "empty" };

  const ordered = episodes
    .filter((ep) => ep.season !== 0)
    .slice()
    .sort((a, b) => a.season * 1000 + a.episode - (b.season * 1000 + b.episode));

  // One timestamp for the whole show: SIMKL kept only the show-level
  // `last_watched_at` for these, so inventing per-episode dates would be
  // fabrication. Every reconstructed episode carries the date SIMKL actually
  // recorded, which is what "recently watched" sorts on.
  const watchedAt = item.last_watched_at ?? exportedAt;
  const watched: Record<number, Record<number, string>> = {};
  const take = Math.min(count, ordered.length);

  for (let i = 0; i < take; i += 1) {
    const ep = ordered[i];
    if (!ep) continue;
    const season = (watched[ep.season] ??= {});
    season[ep.episode] = watchedAt;
  }

  const result: ReconstructedWatch = { watched, provenance: "reconstructed" };
  if (take < count) result.shortfall = count - take;
  return result;
}
