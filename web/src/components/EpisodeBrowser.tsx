/**
 * The episode browser: every season, every episode, each one markable.
 *
 * The capability the old app never had. There, the only thing you could do was
 * mark the NEXT episode watched (app.js:2401) - no way to reach a specific
 * episode, and no way to un-mark anything at all. That is survivable while SIMKL
 * owns the history and simkl.com is there to correct it on, and it is the first
 * thing that has to exist before this app can be the only place the history
 * lives.
 *
 * It carries the three bulk actions as well as the per-episode toggle, because
 * the corrections this has to support are usually ranges: the migration rebuilt
 * 581 shows' history from a watched count, so a boundary can be an episode off,
 * and 24 finished shows read as having episodes left purely because the metadata
 * source numbers them differently from SIMKL. Fixing those one click at a time
 * would not be a real answer.
 *
 * Presentational: it takes a built `SeasonView` and emits patches. No fetching,
 * no store access, no decisions about what "watched" means - all of that is
 * `domain/seasonView` and `domain/watchEdits`, which are tested without a DOM.
 */

import { useState } from "react";
import { formatAirDate, hasTimeComponent } from "../domain/airdates";
import { formatEpisodeRuntime } from "../domain/time";
import type { EpisodeRow, SeasonView } from "../domain/seasonView";
import {
  markAllAired,
  markOne,
  markUpTo,
  unmarkFrom,
  unmarkOne,
  type WatchedPatch,
} from "../domain/watchEdits";
import type { Episode, WatchedMap } from "../domain/types";
import styles from "./EpisodeBrowser.module.css";

export type EpisodeBrowserProps = {
  title: string;
  view: SeasonView;
  /** The same list the view was built from, needed by the mark-forward actions. */
  episodes: readonly Episode[];
  /** Aired episodes, for "mark everything aired as watched". */
  airedEpisodes: readonly Episode[];
  watched: WatchedMap;
  /** Which season to open on; `defaultOpenSeason` supplies the sensible one. */
  initialSeason: number | null;
  onApply: (patch: WatchedPatch) => void;
  onClose: () => void;
  /** Disables every control while a write is in flight. */
  busy?: boolean;
};

function episodeLabel(row: EpisodeRow): string {
  return `S${String(row.season).padStart(2, "0")}E${String(row.episode).padStart(2, "0")}`;
}

/**
 * The row reduced to what a patch needs.
 *
 * A patch gets stored, compared and - in SIMKL mode - serialized into a request,
 * so it must not carry the rendered row's title, runtime, badge and air date
 * along with it.
 */
function refOf(row: EpisodeRow): { season: number; episode: number } {
  return { season: row.season, episode: row.episode };
}

/**
 * The right-hand column of a row: when it aired, or when you watched it.
 *
 * A bare date gets no relative label. Only a source that gave a real broadcast
 * time earns "Today" or "Tomorrow", because a relative label computed from a
 * date alone drifts by a day across timezones - see `domain/airdates`.
 */
function EpisodeMeta({ row }: { row: EpisodeRow }): React.JSX.Element {
  if (row.watchedAt) {
    const watched = new Date(row.watchedAt);
    return (
      <span className={styles.meta} title={row.watchedAt}>
        Watched {Number.isNaN(watched.getTime()) ? "" : watched.toLocaleDateString()}
      </span>
    );
  }
  if (!row.airDate) return <span className={styles.meta}>No date yet</span>;
  return (
    <span className={styles.meta} title={hasTimeComponent(row.airDate) ? row.airDate : undefined}>
      {formatAirDate(row.airDate)}
    </span>
  );
}

export function EpisodeBrowser({
  title,
  view,
  episodes,
  airedEpisodes,
  watched,
  initialSeason,
  onApply,
  onClose,
  busy = false,
}: EpisodeBrowserProps): React.JSX.Element {
  const [openSeason, setOpenSeason] = useState<number | null>(initialSeason);
  const season = view.seasons.find((s) => s.season === openSeason) ?? view.seasons[0] ?? null;

  const apply = (patch: WatchedPatch) => {
    if (!busy) onApply(patch);
  };

  return (
    <div className={styles.browser} role="dialog" aria-label={`Episodes of ${title}`}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.summary}>
          {view.watched} of {view.total} episodes watched
        </p>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          &times;
        </button>
      </header>

      <div className={styles.bulk}>
        <button
          type="button"
          onClick={() => apply(markAllAired(watched, airedEpisodes))}
          disabled={busy}
        >
          Mark everything aired as watched
        </button>
      </div>

      <nav className={styles.seasons} aria-label="Seasons">
        {view.seasons.map((s) => (
          <button
            type="button"
            key={s.season}
            className={s.season === season?.season ? styles.seasonTabActive : styles.seasonTab}
            aria-current={s.season === season?.season}
            onClick={() => setOpenSeason(s.season)}
          >
            Season {s.season}
            <span className={styles.seasonCount}>
              {s.watched}/{s.total}
            </span>
          </button>
        ))}
      </nav>

      {season === null ? (
        <p className={styles.empty}>No episode data for this show yet.</p>
      ) : (
        <ul className={styles.episodes}>
          {season.episodes.map((row) => (
            <li key={`${row.season}x${row.episode}`} className={styles.episode}>
              <button
                type="button"
                className={styles.toggle}
                aria-pressed={row.watched}
                // An unaired episode is not watchable, so the toggle is off -
                // but an episode already marked stays clickable whatever its
                // date says, or a wrongly marked future episode could never be
                // undone.
                disabled={busy || (!row.aired && !row.watched)}
                onClick={() =>
                  apply(
                    row.watched
                      ? unmarkOne(watched, refOf(row))
                      : markOne(watched, refOf(row)),
                  )
                }
                aria-label={`${row.watched ? "Un-mark" : "Mark"} ${episodeLabel(row)} as watched`}
              >
                <span className={styles.tick} aria-hidden="true">
                  {row.watched ? "✓" : ""}
                </span>
              </button>

              <span className={styles.number}>{episodeLabel(row)}</span>
              <span className={styles.name}>
                {row.title ?? <em className={styles.untitled}>Untitled</em>}
                {row.badge ? <span className={styles.badge}>{row.badge}</span> : null}
              </span>
              {row.runtime ? (
                <span className={styles.runtime}>{formatEpisodeRuntime(row.runtime)}</span>
              ) : null}
              <EpisodeMeta row={row} />

              <span className={styles.rowActions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => apply(markUpTo(watched, episodes, refOf(row)))}
                  title={`Mark everything up to ${episodeLabel(row)} as watched`}
                >
                  Seen to here
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => apply(unmarkFrom(watched, refOf(row)))}
                  title={`Un-mark ${episodeLabel(row)} and everything after it`}
                >
                  Stopped here
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {view.specials.length > 0 ? (
        <p className={styles.specialsNote}>
          {view.specials.length} special{view.specials.length === 1 ? "" : "s"} are listed
          separately and are not counted in any total.
        </p>
      ) : null}
    </div>
  );
}
