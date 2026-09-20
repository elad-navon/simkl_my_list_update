/**
 * Noticing that a new episode has aired. Ported from app.js:3340-3420.
 *
 * Three rules from the original, each of which is there because the obvious
 * version is wrong:
 *
 * 1. It watches the latest AIRED episode, not "next to watch". SIMKL only set
 *    `next_to_watch` once something was unwatched, so a show you are fully caught
 *    up on had none - and that is exactly the show where a new episode matters
 *    most. Here the aired episode comes from `computeProgress`, which knows it
 *    for every show.
 * 2. The snapshot persists, so a tab that was closed for a week still notices
 *    what happened while it was gone.
 * 3. A show seen for the FIRST time seeds the snapshot without notifying.
 *    Otherwise the first run after installing announces the entire library.
 *
 * Pure, so all three are testable without a clock, a network or a notification
 * permission - none of which the old version could be tested without.
 */

import { encodeSE, type Episode } from "./types";

/** show key -> the `encodeSE` of its latest aired episode when last checked. */
export type EpisodeSnapshot = Readonly<Record<string, number>>;

export type NewEpisode = {
  key: string;
  title: string;
  season: number;
  episode: number;
  episodeTitle: string | null;
  /** How far the show moved, so "3 new episodes" can be said rather than one. */
  advancedBy: number;
};

export type NewEpisodeCheck = {
  /** Shows whose latest aired episode moved forward since the last check. */
  fresh: NewEpisode[];
  /** The snapshot to persist. Always returned, even when nothing is new. */
  snapshot: EpisodeSnapshot;
  /** Shows recorded for the first time, which deliberately do not notify. */
  seeded: number;
};

export type CheckInput = {
  key: string;
  title: string;
  /**
   * The show's latest aired episode, from `computeProgress().latestAired`.
   * Null for a show with nothing aired yet, which is skipped.
   */
  latestAired: Episode | null;
};

/**
 * Compares each show against the snapshot.
 *
 * `advancedBy` counts episode numbers rather than episodes, so a show that
 * jumped from S02E04 to S02E07 reports 3. That is a count of what the source
 * moved by, not of what it necessarily aired - a renumbering would inflate it -
 * which is why it is only ever used to phrase the message and never as data.
 */
export function checkForNewEpisodes(
  shows: readonly CheckInput[],
  snapshot: EpisodeSnapshot,
): NewEpisodeCheck {
  const next: Record<string, number> = { ...snapshot };
  const fresh: NewEpisode[] = [];
  let seeded = 0;

  for (const show of shows) {
    if (!show.latestAired) continue;

    const key = encodeSE(show.latestAired.season, show.latestAired.episode);
    const previous = snapshot[show.key];

    if (previous === undefined) {
      // First sight. Recorded, not announced.
      next[show.key] = key;
      seeded += 1;
      continue;
    }

    if (key > previous) {
      fresh.push({
        key: show.key,
        title: show.title,
        season: show.latestAired.season,
        episode: show.latestAired.episode,
        episodeTitle: show.latestAired.title,
        advancedBy: key - previous,
      });
    }

    // Written whether it moved forward or not, so a show whose latest aired
    // episode went BACKWARDS - a source correcting a wrong date, or renumbering a
    // season - resets rather than announcing the same episode again forever.
    next[show.key] = key;
  }

  return { fresh, snapshot: next, seeded };
}

/** "S02E07" for a notification body. */
export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/**
 * One line for a notification.
 *
 * The count is mentioned only when it is more than one, because "1 new episode"
 * reads worse than naming it.
 */
export function describeNewEpisode(entry: NewEpisode): string {
  const code = episodeCode(entry.season, entry.episode);
  const named = entry.episodeTitle ? `${code} - ${entry.episodeTitle}` : code;
  return entry.advancedBy > 1 ? `${named} (and ${entry.advancedBy - 1} more)` : named;
}
