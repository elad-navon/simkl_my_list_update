/**
 * Editing watch history by hand.
 *
 * Independence needs this. While SIMKL owns the list it also owns what counts
 * as watched, and the old app could only ever add to that - there was no way to
 * un-mark an episode at all. Once the local library is the truth, the history
 * is yours to correct, and it will need correcting: the migration rebuilt 581
 * shows' history from a count rather than reading it episode by episode, which
 * is exact for 708 of 709 but leaves the boundary episode wrong where an
 * episode was skipped mid-run.
 *
 * Three operations, because one is not enough in practice:
 *
 *  - un-mark one episode: "this one I have not actually seen"
 *  - un-mark from an episode onward: "I stopped here" - the one that corrects a
 *    reconstructed boundary, and the reason a single-episode toggle alone would
 *    mean twenty clicks
 *  - mark up to an episode: "I have seen everything to here" - which is also
 *    what settles the 24 finished shows that read as having episodes left
 *    because the metadata source numbers them differently from SIMKL
 *
 * All pure, and all expressed as a patch rather than applied directly, so the
 * store turns any of them into exactly one durable write and one timestamp -
 * and so the SIMKL backend can send one bulk request instead of two hundred.
 */

import { encodeSE, type Episode, type WatchedMap } from "./types";

export type EpisodeRef = { season: number; episode: number };

export type WatchedPatch = {
  /** Episodes to record as watched, with the timestamp to record them under. */
  add: Array<EpisodeRef & { watchedAt: string }>;
  /** Episodes to un-record. */
  remove: EpisodeRef[];
};

export const EMPTY_PATCH: WatchedPatch = { add: [], remove: [] };

export function isEmptyPatch(patch: WatchedPatch): boolean {
  return patch.add.length === 0 && patch.remove.length === 0;
}

/** Every non-special episode currently recorded as watched, in broadcast order. */
export function watchedRefs(watched: WatchedMap): EpisodeRef[] {
  const refs: EpisodeRef[] = [];
  for (const [seasonKey, episodes] of Object.entries(watched)) {
    const season = Number(seasonKey);
    if (season === 0) continue;
    for (const episodeKey of Object.keys(episodes)) {
      refs.push({ season, episode: Number(episodeKey) });
    }
  }
  return refs.sort((a, b) => encodeSE(a.season, a.episode) - encodeSE(b.season, b.episode));
}

const isWatched = (watched: WatchedMap, ref: EpisodeRef): boolean =>
  watched[ref.season]?.[ref.episode] != null;

/**
 * Un-marks one episode.
 *
 * Returns an empty patch when it was not marked to begin with, so the caller
 * can skip the write entirely rather than bumping a timestamp - and, in SIMKL
 * mode, rather than sending a request for something that was never there.
 */
export function unmarkOne(watched: WatchedMap, ref: EpisodeRef): WatchedPatch {
  return isWatched(watched, ref) ? { add: [], remove: [ref] } : EMPTY_PATCH;
}

export function markOne(
  watched: WatchedMap,
  ref: EpisodeRef,
  watchedAt: string = new Date().toISOString(),
): WatchedPatch {
  return isWatched(watched, ref) ? EMPTY_PATCH : { add: [{ ...ref, watchedAt }], remove: [] };
}

/**
 * Un-marks the given episode and everything after it in broadcast order.
 *
 * Works from the watch MAP rather than from the episode list, deliberately: it
 * has to be able to remove a mark on an episode no source lists any more, which
 * is exactly the situation a reconstructed history can leave behind. Specials
 * are untouched - they have no place in the running order.
 */
export function unmarkFrom(watched: WatchedMap, from: EpisodeRef): WatchedPatch {
  const cutoff = encodeSE(from.season, from.episode);
  const remove = watchedRefs(watched).filter((ref) => encodeSE(ref.season, ref.episode) >= cutoff);
  return remove.length ? { add: [], remove } : EMPTY_PATCH;
}

/**
 * Marks the given episode and everything before it as watched.
 *
 * This one needs the episode list, because it is claiming episodes that are not
 * in the watch map yet and it must not invent ones that do not exist. Episodes
 * already marked are left alone rather than re-stamped: a watch is a fact that
 * happened at a time, and re-dating it would lose when it actually did.
 */
export function markUpTo(
  watched: WatchedMap,
  episodes: readonly Episode[],
  through: EpisodeRef,
  watchedAt: string = new Date().toISOString(),
): WatchedPatch {
  const cutoff = encodeSE(through.season, through.episode);
  const add = episodes
    .filter((ep) => ep.season !== 0)
    .filter((ep) => encodeSE(ep.season, ep.episode) <= cutoff)
    .filter((ep) => !isWatched(watched, ep))
    .map((ep) => ({ season: ep.season, episode: ep.episode, watchedAt }))
    .sort((a, b) => encodeSE(a.season, a.episode) - encodeSE(b.season, b.episode));

  return add.length ? { add, remove: [] } : EMPTY_PATCH;
}

/**
 * Marks every aired episode as watched.
 *
 * The one-click fix for a finished show that reads as having episodes left
 * because the metadata source numbers it differently from the history SIMKL
 * recorded. Unaired episodes are excluded - `remaining` is what the user is
 * clearing, and it never counted those.
 */
export function markAllAired(
  watched: WatchedMap,
  airedEpisodes: readonly Episode[],
  watchedAt: string = new Date().toISOString(),
): WatchedPatch {
  const add = airedEpisodes
    .filter((ep) => ep.season !== 0 && !isWatched(watched, ep))
    .map((ep) => ({ season: ep.season, episode: ep.episode, watchedAt }))
    .sort((a, b) => encodeSE(a.season, a.episode) - encodeSE(b.season, b.episode));

  return add.length ? { add, remove: [] } : EMPTY_PATCH;
}

/**
 * Applies a patch to a watch map.
 *
 * A season left with no episodes is dropped rather than kept as an empty
 * object. That is not cosmetic: the map is what gets written to IndexedDB and
 * uploaded to the backup, and `{"5":{}}` is a claim that season 5 exists in the
 * history when nothing in it does.
 */
export function applyPatch(watched: WatchedMap, patch: WatchedPatch): WatchedMap {
  const next: Record<number, Record<number, string>> = {};
  for (const [seasonKey, episodes] of Object.entries(watched)) {
    next[Number(seasonKey)] = { ...episodes };
  }

  for (const ref of patch.remove) {
    const season = next[ref.season];
    if (!season) continue;
    delete season[ref.episode];
    if (Object.keys(season).length === 0) delete next[ref.season];
  }

  for (const entry of patch.add) {
    (next[entry.season] ??= {})[entry.episode] = entry.watchedAt;
  }

  return next;
}
