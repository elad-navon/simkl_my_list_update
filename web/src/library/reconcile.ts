/**
 * Bringing the local mirror back in line with SIMKL.
 *
 * In SIMKL mode the lists live on SIMKL and the local library is a mirror kept
 * current beside them, so that switching to independence is a setting rather
 * than a migration. Which means every load has to answer: what changed on SIMKL
 * since the mirror was last written?
 *
 * The expensive part is watch history. SIMKL returns per-episode `watched_at`
 * data for `watching` and `hold` only - for `completed` and `dropped` the
 * `seasons` array is absent whatever the parameters say, which on this library
 * is 584 of 709 shows. Rebuilding those needs the show's episode list, and
 * fetching 584 episode lists on every load is not an option.
 *
 * So the work is split in two. `planReconcile` is pure and decides, from the
 * five list responses alone, which shows actually need anything fetched - which
 * is normally none of them, because `watched_episodes_count` is a cheap and
 * exact check against what the mirror already holds. The caller then fetches
 * only for that set, and `applyReconcile` folds the result in.
 *
 * Both halves are pure so the decision logic is testable without a network,
 * which matters: getting this wrong means either a stale mirror or 584 requests
 * per page load.
 */

import { countWatched } from "../domain/progress";
import type { ShowStatus } from "../domain/types";
import { normalizeSimklEpisodes, type SimklApiEpisode } from "./migrate/simklEpisodes";
import { reconstructWatched, extractWatched, type SimklItem } from "./migrate/simkl";
import { showKey, type Library, type LibraryShow, type ShowIds, type ShowKey } from "./schema";

/** Why a show needs work, which is also what the caller has to fetch for it. */
export type ReconcileAction =
  /** Nothing to do: status and watched count both already match the mirror. */
  | "unchanged"
  /** SIMKL sent per-episode data, so the history can be rebuilt with no fetch. */
  | "from-seasons"
  /**
   * SIMKL sent a watched COUNT but no episodes, and the count disagrees with
   * the mirror. Needs this show's episode list to place the count onto specific
   * episodes - one request, and only for shows that really changed.
   */
  | "needs-episodes"
  /** New to the mirror, and SIMKL says nothing is watched. No fetch needed. */
  | "empty";

export type ReconcileEntry = {
  key: ShowKey;
  title: string;
  status: ShowStatus;
  ids: ShowIds;
  item: SimklItem;
  action: ReconcileAction;
  /** Set when `action` is "needs-episodes" - the id to fetch episodes for. */
  simklId?: number | undefined;
};

export type ReconcilePlan = {
  entries: ReconcileEntry[];
  /**
   * Shows the mirror has that no SIMKL list mentions. In this mode SIMKL is the
   * source of truth, so they were removed elsewhere and go.
   */
  removed: ShowKey[];
  /** Shows with no id at all in any namespace; reported rather than dropped. */
  unkeyed: string[];
};

/** Non-special watched episodes the mirror holds for a show. */
function mirrorWatchedCount(show: LibraryShow | undefined): number {
  return show ? countWatched(show.watched) : 0;
}

function hasSeasonData(item: SimklItem): boolean {
  return (item.seasons ?? []).some((s) => (s?.episodes ?? []).length > 0);
}

/**
 * Decides, from the five list responses alone, what each show needs.
 *
 * The cheap check that carries the whole design: SIMKL reports
 * `watched_episodes_count` for every show in every list. When it equals what
 * the mirror already holds and the status matches, nothing about that show has
 * changed and its history needs neither a fetch nor a rebuild - the mirror's
 * own per-episode map is kept, which is richer than the count it was checked
 * against.
 */
export function planReconcile(
  mirror: Library,
  lists: Partial<Record<ShowStatus, readonly SimklItem[]>>,
): ReconcilePlan {
  const entries: ReconcileEntry[] = [];
  const unkeyed: string[] = [];
  const seen = new Set<ShowKey>();

  for (const [listStatus, items] of Object.entries(lists) as [ShowStatus, SimklItem[]][]) {
    for (const item of items ?? []) {
      const title = item.show?.title ?? "(untitled)";
      const ids = extractShowIds(item);
      const key = showKey(ids);
      if (!key) {
        unkeyed.push(title);
        continue;
      }
      // A show can appear in only one list, but a malformed response could
      // repeat it; the first wins, same rule as the import.
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = mirror.shows[key];
      const simklCount = item.watched_episodes_count ?? 0;

      let action: ReconcileAction;
      if (existing && existing.status === listStatus && mirrorWatchedCount(existing) === simklCount) {
        action = "unchanged";
      } else if (hasSeasonData(item)) {
        action = "from-seasons";
      } else if (simklCount > 0) {
        action = "needs-episodes";
      } else {
        action = "empty";
      }

      const entry: ReconcileEntry = { key, title, status: listStatus, ids, item, action };
      if (action === "needs-episodes" && ids.simkl != null) entry.simklId = ids.simkl;
      entries.push(entry);
    }
  }

  return {
    entries,
    removed: Object.keys(mirror.shows).filter((key) => !seen.has(key)),
    unkeyed,
  };
}

/** The ids the mirror keys and identifies a show by. Mirrors `extractIds`. */
function extractShowIds(item: SimklItem): ShowIds {
  const ids = item.show?.ids ?? {};
  const num = (v: number | string | null | undefined): number | undefined => {
    if (v == null || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    tmdb: num(ids.tmdb),
    imdb: ids.imdb ?? undefined,
    tvdb: num(ids.tvdb),
    simkl: num(ids.simkl),
  };
}

export type ReconcileResult = {
  library: Library;
  /** Per-action counts, so a load can report what it actually had to do. */
  counts: Record<ReconcileAction, number>;
  removed: number;
};

/**
 * Folds the plan into a new library.
 *
 * @param episodesBySimklId Episode lists fetched for the "needs-episodes"
 *   entries. A missing one is not fatal: the count is kept and the history it
 *   could not be placed on is left empty rather than guessed at.
 * @param now Injectable clock, so a reconcile is reproducible in tests.
 */
export function applyReconcile(
  mirror: Library,
  plan: ReconcilePlan,
  episodesBySimklId: Readonly<Record<number, readonly SimklApiEpisode[] | null>> = {},
  now: string = new Date().toISOString(),
): ReconcileResult {
  const shows: Record<ShowKey, LibraryShow> = {};
  const counts: Record<ReconcileAction, number> = {
    unchanged: 0,
    "from-seasons": 0,
    "needs-episodes": 0,
    empty: 0,
  };

  for (const entry of plan.entries) {
    counts[entry.action] += 1;
    const existing = mirror.shows[entry.key];

    if (entry.action === "unchanged" && existing) {
      shows[entry.key] = existing;
      continue;
    }

    const watched = resolveWatched(entry, episodesBySimklId, now);

    // Everything the user chose about a show is carried across untouched.
    // Reconciling with SIMKL is about the list and the history, and must never
    // be the reason a hand-picked poster or a manual episode disappears.
    shows[entry.key] = {
      key: entry.key,
      ids: { ...existing?.ids, ...entry.ids },
      title: entry.title,
      ...(entry.item.show?.year != null ? { year: entry.item.show.year } : {}),
      status: entry.status,
      watched,
      ...(existing?.manualEpisodes ? { manualEpisodes: existing.manualEpisodes } : {}),
      ...(existing?.images ? { images: existing.images } : {}),
      addedAt: existing?.addedAt ?? entry.item.added_to_watchlist_at ?? now,
      updatedAt: now,
    };
  }

  return {
    library: { ...mirror, shows },
    counts,
    removed: plan.removed.length,
  };
}

function resolveWatched(
  entry: ReconcileEntry,
  episodesBySimklId: Readonly<Record<number, readonly SimklApiEpisode[] | null>>,
  now: string,
): LibraryShow["watched"] {
  if (entry.action === "empty") return {};

  if (entry.action === "from-seasons") return extractWatched(entry.item, now);

  const episodes = entry.simklId != null ? normalizeSimklEpisodes(episodesBySimklId[entry.simklId]) : [];
  return reconstructWatched(entry.item, episodes, now).watched;
}

/** The shows a caller has to fetch episode lists for before applying the plan. */
export function episodeFetchList(plan: ReconcilePlan): number[] {
  return [
    ...new Set(
      plan.entries
        .filter((e) => e.action === "needs-episodes" && e.simklId != null)
        .map((e) => e.simklId as number),
    ),
  ];
}
