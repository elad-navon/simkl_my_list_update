/**
 * Merging a backup back into the local library.
 *
 * The plan asks for a Gist so that a dead computer and a ruined afternoon are
 * both survivable, and since the pull happens on every load it doubles as sync
 * between the phone and the desktop. That second job is what makes this file
 * hard: two devices that were both used offline have to come back together
 * without either one losing something.
 *
 * Three rules, each for a different kind of field:
 *
 * 1. Watch history unions, keeping the EARLIEST timestamp per episode. A watch
 *    is a fact that happened; two devices disagreeing about when must never
 *    un-watch anything. See `mergeWatched`.
 * 2. Everything else about a show - status, title, artwork choice - is
 *    last-writer-wins on `updatedAt`. These are settings, and the most recent
 *    intent is the right one.
 * 3. A show present on only one side is decided by `syncedAt`, not by taking
 *    the union. Union is the tempting answer and it is wrong: it makes deletion
 *    impossible, so a show you removed returns on the next sync, forever. See
 *    `resolveMissing`.
 */

import { mergeWatched, type Library, type LibraryShow, type ShowIds, type ShowKey } from "./schema";

export type MergeStats = {
  /** Shows that existed on both sides and were combined. */
  merged: number;
  /** Shows taken from the backup that the local library did not have. */
  added: number;
  /** Shows the backup had that were deleted locally since the last sync. */
  keptDeleted: number;
  /** Shows only the local library has, which the next push will carry up. */
  localOnly: number;
  /** Episodes the backup contributed that the local history was missing. */
  episodesGained: number;
};

export type MergeResult = {
  library: Library;
  stats: MergeStats;
};

/** Fills blank ids from the other side without overwriting anything set. */
function mergeIds(primary: ShowIds, secondary: ShowIds): ShowIds {
  const out: ShowIds = { ...primary };
  for (const [field, value] of Object.entries(secondary) as [keyof ShowIds, unknown][]) {
    if (out[field] == null && value != null) Object.assign(out, { [field]: value });
  }
  return out;
}

function watchedCount(show: LibraryShow): number {
  let n = 0;
  for (const episodes of Object.values(show.watched)) n += Object.keys(episodes).length;
  return n;
}

/**
 * Whether a show that exists only in the backup should come back.
 *
 * The question this answers is "was it added there, or deleted here?", and
 * without tombstones the only evidence is time. A show whose backup entry was
 * last touched BEFORE the local library last synced was already known about and
 * has since gone, so it was deleted locally and stays gone. One touched after
 * that is news, and comes across.
 *
 * With no `syncedAt` - a first pull, or a library restored from a file - there is
 * no deletion to infer, so everything comes across. That is the safe direction
 * for the case where this genuinely cannot know.
 */
function resolveMissing(remote: LibraryShow, syncedAt: string | null): "add" | "keep-deleted" {
  if (!syncedAt) return "add";
  return remote.updatedAt > syncedAt ? "add" : "keep-deleted";
}

/**
 * Combines one show from both sides.
 *
 * `addedAt` takes the earlier of the two, because it is when the show entered
 * your list and that does not change by being synced.
 */
function mergeShow(local: LibraryShow, remote: LibraryShow): LibraryShow {
  const localIsNewer = local.updatedAt >= remote.updatedAt;
  const winner = localIsNewer ? local : remote;
  const loser = localIsNewer ? remote : local;

  const merged: LibraryShow = {
    key: local.key,
    ids: mergeIds(winner.ids, loser.ids),
    title: winner.title,
    ...(winner.year !== undefined ? { year: winner.year } : loser.year !== undefined ? { year: loser.year } : {}),
    status: winner.status,
    watched: mergeWatched(local.watched, remote.watched),
    addedAt: local.addedAt < remote.addedAt ? local.addedAt : remote.addedAt,
    updatedAt: winner.updatedAt,
  };

  // A hand-typed episode and a chosen poster are both things the user did, so
  // they survive from whichever side has them rather than being dropped because
  // the other side's row happened to be newer.
  const manualEpisodes = winner.manualEpisodes ?? loser.manualEpisodes;
  if (manualEpisodes) merged.manualEpisodes = manualEpisodes;

  const images = winner.images ?? loser.images;
  if (images) merged.images = images;

  return merged;
}

/**
 * @param local  The library as it is on this device.
 * @param remote The library from the backup.
 * @param now    Stamped as the new `syncedAt`, so the next merge can tell
 *               deletions from additions.
 */
export function mergeLibraries(
  local: Library,
  remote: Library,
  now: string = new Date().toISOString(),
): MergeResult {
  const shows: Record<ShowKey, LibraryShow> = {};
  const stats: MergeStats = {
    merged: 0,
    added: 0,
    keptDeleted: 0,
    localOnly: 0,
    episodesGained: 0,
  };

  for (const [key, localShow] of Object.entries(local.shows)) {
    const remoteShow = remote.shows[key];
    if (!remoteShow) {
      shows[key] = localShow;
      stats.localOnly += 1;
      continue;
    }
    const before = watchedCount(localShow);
    const combined = mergeShow(localShow, remoteShow);
    stats.episodesGained += watchedCount(combined) - before;
    shows[key] = combined;
    stats.merged += 1;
  }

  for (const [key, remoteShow] of Object.entries(remote.shows)) {
    if (local.shows[key]) continue;
    if (resolveMissing(remoteShow, local.syncedAt) === "add") {
      shows[key] = remoteShow;
      stats.added += 1;
      stats.episodesGained += watchedCount(remoteShow);
    } else {
      stats.keptDeleted += 1;
    }
  }

  return {
    library: { version: Math.max(local.version, remote.version), syncedAt: now, shows },
    stats,
  };
}
