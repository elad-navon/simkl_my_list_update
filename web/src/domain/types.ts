/**
 * Shared vocabulary for the pure domain layer.
 *
 * Nothing in `src/domain` may import from `src/api`, `src/library` or React.
 * These are plain functions over plain data so they can be unit-tested
 * without a network, a browser or a store.
 */

export const SHOW_STATUSES = [
  "watching",
  "plantowatch",
  "hold",
  "completed",
  "dropped",
] as const;

export type ShowStatus = (typeof SHOW_STATUSES)[number];

/**
 * One episode as the metadata layer knows it, normalized across sources.
 *
 * `airDate` carries its own precision: TVmaze's `airstamp` is a full ISO
 * datetime with a UTC offset, TMDB's `air_date` is a bare `YYYY-MM-DD`.
 * Consumers must not assume a time-of-day is present - ask
 * `hasTimeComponent` first (see `./airdates`). That distinction is what
 * decides whether a "Today"/"Tomorrow" label is trustworthy.
 */
export type Episode = {
  season: number;
  episode: number;
  airDate: string | null;
  title: string | null;
  /** Minutes, when the source knows it. */
  runtime: number | null;
};

/** season number -> episode number -> ISO timestamp of when it was watched. */
export type WatchedMap = Readonly<Record<number, Readonly<Record<number, string>>>>;

/** Season 0 is specials everywhere; the old app skipped them at every site. */
export function isSpecial(episode: Pick<Episode, "season">): boolean {
  return episode.season === 0;
}

/** Sort key that keeps a season/episode pair orderable as a single number. */
export function encodeSE(season: number, episode: number): number {
  return season * 1000 + episode;
}
