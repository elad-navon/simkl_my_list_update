/**
 * The parity harness: does the locally derived progress match what SIMKL said?
 *
 * The plan makes zero differences the gate for cutting SIMKL loose, so this has
 * to be an honest comparison rather than a reassuring one. It feeds SIMKL's OWN
 * episode list into the new `computeProgress` and compares the result against
 * SIMKL's pre-computed fields for the same show. Both sides therefore see
 * identical episode data, and any difference is a difference in the logic -
 * which is the only thing worth checking here.
 *
 * Differences are attributed one by one rather than row by row, and a cause is
 * attached to a single field, never to a show. A show whose `notAired` is
 * explicable and whose `watched` is not comes out as a failure, because the
 * second difference is the one that matters and an explanation must not launder
 * it.
 *
 * Pure, and the clock is injected, so a run is reproducible: the same export
 * and the same `now` always produce the same report.
 */

import { computeProgress, type Progress } from "../../domain/progress";
import type { Episode, WatchedMap } from "../../domain/types";
import { normalizeSimklEpisodes, type SimklApiEpisode } from "./simklEpisodes";
import {
  formatSE,
  reconstructWatched,
  simklRemaining,
  type SimklItem,
  type WatchProvenance,
} from "./simkl";

/** The five numbers the plan names, as SIMKL reported them. */
export type SimklFigures = {
  total: number;
  notAired: number;
  watched: number;
  remaining: number;
  nextToWatch: string | null;
};

export type LocalFigures = SimklFigures & {
  aired: number;
  nextAirDate: string | null;
};

export type ParityField = "total" | "notAired" | "watched" | "remaining" | "nextToWatch";

/**
 * Why one difference is not a defect.
 *
 * The first three are SIMKL disagreeing with ITSELF, where the locally derived
 * figure is the more trustworthy of the two and treating it as a failure would
 * mean holding the new code to a standard the old data does not meet. The
 * fourth is the opposite - a real limit of the migration - and is kept as its
 * own cause precisely so it never hides inside the others.
 */
export type ParityCause =
  /**
   * SIMKL's aggregate `total_episodes_count` disagrees with the length of the
   * episode list SIMKL itself served. The aggregate is the stale one; the
   * episode list is what the new model derives from. The episodes it has not
   * caught up with then move `notAired` or `remaining` by exactly their own
   * number, depending on whether they have aired, and those knock-on gaps are
   * attributed here too - but only when the arithmetic closes exactly.
   */
  | "simkl-aggregate-stale"
  /**
   * An undated episode with nothing aired after it, which the broadcast-order
   * rule cannot place, so it counts as not-aired. TMDB's show status resolves
   * these once phase 3 supplies `seriesEnded`. Only excused on a show with
   * nothing left to watch, where it cannot move a number you see.
   */
  | "undated-unplaceable"
  /**
   * SIMKL names a `next_to_watch` episode while its own three counts leave
   * nothing remaining. Both sides agree the show is finished, so the field is
   * simply stale - on this library it reads `S02E99` and `S00E15` on shows
   * whose history is complete.
   */
  | "simkl-next-to-watch-stale"
  /**
   * The genuine cost of reconstruction: this show's watch history was rebuilt
   * from a count rather than read episode by episode, the count is right, and
   * the boundary episode landed one off because an episode was skipped mid-run.
   * Not a logic difference and not SIMKL's fault - a known inaccuracy, reported
   * as one.
   */
  | "reconstruction-approximate";

export type ParityDifference = {
  field: ParityField;
  simkl: string | number | null;
  local: string | number | null;
  /** Null means unexplained - the only kind that fails the gate. */
  cause: ParityCause | null;
};

export type ParityRow = {
  key: string;
  title: string;
  status: string;
  simkl: SimklFigures;
  local: LocalFigures;
  differences: ParityDifference[];
  /** How this show's watch map was obtained - see `reconstructWatched`. */
  provenance: WatchProvenance;
  /** True when SIMKL gave no episode list, so there was nothing to derive from. */
  noEpisodeData: boolean;
};

export type ParityReport = {
  now: string;
  rows: ParityRow[];
  /** Rows where all five figures match exactly. */
  identical: number;
  /** Rows that differ, every difference attributed to a known cause. */
  explained: number;
  /** Rows with at least one unattributed difference. Must be 0 to pass. */
  unexplained: number;
  byField: Record<ParityField, number>;
  byCause: Record<ParityCause, number>;
  byProvenance: Record<WatchProvenance, number>;
};

export const PARITY_FIELDS: readonly ParityField[] = [
  "total",
  "notAired",
  "watched",
  "remaining",
  "nextToWatch",
] as const;

export const PARITY_CAUSES: readonly ParityCause[] = [
  "simkl-aggregate-stale",
  "undated-unplaceable",
  "simkl-next-to-watch-stale",
  "reconstruction-approximate",
] as const;

function simklFiguresOf(item: SimklItem): SimklFigures {
  return {
    total: item.total_episodes_count ?? 0,
    notAired: item.not_aired_episodes_count ?? 0,
    watched: item.watched_episodes_count ?? 0,
    remaining: simklRemaining(item),
    nextToWatch: item.next_to_watch ?? null,
  };
}

function localFiguresOf(progress: Progress): LocalFigures {
  return {
    total: progress.total,
    aired: progress.aired,
    notAired: progress.notAired,
    watched: progress.watched,
    remaining: progress.remaining,
    nextToWatch: formatSE(progress.nextToWatch),
    nextAirDate: progress.nextAiring?.airDate ?? null,
  };
}

/**
 * Compares one show.
 *
 * `nextToWatch` is compared in SIMKL's own `SxxEyy` spelling so the two sides
 * read directly against each other. A show with nothing left to watch is null
 * locally, which SIMKL spells as an absent field.
 */
export function compareShow(
  item: SimklItem,
  episodePayload: readonly SimklApiEpisode[] | null | undefined,
  options: {
    title: string;
    key: string;
    now: number;
    exportedAt: string;
    /** From TMDB's show status; absent during the migration itself. */
    seriesEnded?: boolean;
  },
): ParityRow {
  const episodes: Episode[] = normalizeSimklEpisodes(episodePayload);
  const reconstructed = reconstructWatched(item, episodes, options.exportedAt);
  const watched: WatchedMap = reconstructed.watched;
  const progress = computeProgress(episodes, watched, {
    now: options.now,
    ...(options.seriesEnded === undefined ? {} : { seriesEnded: options.seriesEnded }),
  });

  const simkl = simklFiguresOf(item);
  const local = localFiguresOf(progress);

  const raw: Array<Omit<ParityDifference, "cause">> = [];
  const compare = (field: ParityField, a: string | number | null, b: string | number | null) => {
    if (a !== b) raw.push({ field, simkl: a, local: b });
  };

  compare("total", simkl.total, local.total);
  compare("notAired", simkl.notAired, local.notAired);
  compare("watched", simkl.watched, local.watched);
  compare("remaining", simkl.remaining, local.remaining);
  compare("nextToWatch", simkl.nextToWatch, local.nextToWatch);

  const undatedCount = episodes.filter((ep) => ep.season !== 0 && !ep.airDate).length;
  const differences: ParityDifference[] = raw.map((diff) => ({
    ...diff,
    cause: attribute(diff, {
      all: raw,
      simkl,
      local,
      undatedCount,
      provenance: reconstructed.provenance,
    }),
  }));

  return {
    key: options.key,
    title: options.title,
    status: item.status ?? "",
    simkl,
    local,
    differences,
    provenance: reconstructed.provenance,
    noEpisodeData: episodes.length === 0,
  };
}

/** Attributes one difference to a cause, or null when there is no honest one. */
function attribute(
  diff: Omit<ParityDifference, "cause">,
  context: {
    all: readonly Omit<ParityDifference, "cause">[];
    simkl: SimklFigures;
    local: LocalFigures;
    undatedCount: number;
    provenance: WatchProvenance;
  },
): ParityCause | null {
  const { all, simkl, local, undatedCount, provenance } = context;
  const totalDiff = all.find((d) => d.field === "total");

  switch (diff.field) {
    // The episode list IS the local total, so a disagreement can only mean
    // SIMKL's aggregate no longer matches the list SIMKL served alongside it.
    case "total":
      return "simkl-aggregate-stale";

    case "notAired": {
      // A stale aggregate carries its gap straight into notAired; the sizes
      // have to match, or something else is going on as well.
      if (totalDiff) {
        const totalGap = Number(totalDiff.local) - Number(totalDiff.simkl);
        const notAiredGap = Number(diff.local) - Number(diff.simkl);
        return totalGap === notAiredGap ? "simkl-aggregate-stale" : null;
      }
      // Otherwise both sides agree how many episodes exist and have merely
      // split them differently, which is the undated-episode case - excused
      // only where it cannot change what the user sees.
      if (undatedCount > 0 && local.remaining === 0) return "undated-unplaceable";
      return null;
    }

    // Never excused. This is the user's own history, reconstructed or not, and
    // a difference here means episodes were lost or invented.
    case "watched":
      return null;

    case "remaining": {
      // Episodes SIMKL's aggregate has not caught up with land in `remaining`
      // unless they are unaired, so a stale aggregate moves this field too -
      // but only by exactly that many. The arithmetic has to close, which is
      // what stops this from excusing a difference of any other origin.
      if (!totalDiff) return null;
      const appeared = Number(totalDiff.local) - Number(totalDiff.simkl);
      const notAiredDiff = all.find((d) => d.field === "notAired");
      const stillUnaired = notAiredDiff
        ? Number(notAiredDiff.local) - Number(notAiredDiff.simkl)
        : 0;
      const expected = appeared - stillUnaired;
      return Number(diff.local) - Number(diff.simkl) === expected
        ? "simkl-aggregate-stale"
        : null;
    }

    case "nextToWatch": {
      // SIMKL naming an episode while its own counts say the show is finished.
      if (local.nextToWatch === null && simkl.remaining === 0 && local.remaining === 0) {
        return "simkl-next-to-watch-stale";
      }
      // Both name an episode and both agree on how many are left, so the count
      // survived reconstruction and only the boundary episode's identity moved.
      if (
        provenance === "reconstructed" &&
        simkl.nextToWatch !== null &&
        local.nextToWatch !== null &&
        simkl.remaining === local.remaining
      ) {
        return "reconstruction-approximate";
      }
      return null;
    }
  }
}

export function summarize(rows: readonly ParityRow[], now: number): ParityReport {
  const byField: Record<ParityField, number> = {
    total: 0,
    notAired: 0,
    watched: 0,
    remaining: 0,
    nextToWatch: 0,
  };
  const byCause: Record<ParityCause, number> = {
    "simkl-aggregate-stale": 0,
    "undated-unplaceable": 0,
    "simkl-next-to-watch-stale": 0,
    "reconstruction-approximate": 0,
  };
  const byProvenance: Record<WatchProvenance, number> = {
    "episode-level": 0,
    reconstructed: 0,
    empty: 0,
  };

  let identical = 0;
  let explained = 0;
  let unexplained = 0;

  for (const row of rows) {
    byProvenance[row.provenance] += 1;

    for (const diff of row.differences) {
      byField[diff.field] += 1;
      if (diff.cause) byCause[diff.cause] += 1;
    }

    if (row.differences.length === 0) identical += 1;
    else if (row.differences.every((d) => d.cause !== null)) explained += 1;
    else unexplained += 1;
  }

  return {
    now: new Date(now).toISOString(),
    rows: [...rows],
    identical,
    explained,
    unexplained,
    byField,
    byCause,
    byProvenance,
  };
}

/** True when a row has at least one difference nothing accounts for. */
export function isUnexplained(row: ParityRow): boolean {
  return row.differences.some((d) => d.cause === null);
}
