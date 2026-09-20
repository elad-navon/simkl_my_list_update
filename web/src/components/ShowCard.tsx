/**
 * One show's card. Ported from the markup app.js:2861-2960 built as a string.
 *
 * Class names are the old ones, so the ported stylesheet applies unchanged. What
 * is different is that this takes finished values: the counts, the priced time
 * and the labels are all computed by `domain/`, so there is nothing to work out
 * here beyond which elements to show.
 *
 * Three things the old version needed and this does not. It had no HTML escaping
 * at all - titles went raw into `onclick="…'${source}'…"` strings (app.js:2900),
 * which JSX removes by construction. It kept five separate copies of every show
 * across five arrays and needed `syncImageAcrossCards` to keep their artwork in
 * step (app.js:2560). And it restored scroll positions by hand after every
 * re-render, because rendering meant replacing all of `#app`.
 */

import { formatAirDate } from "../domain/airdates";
import { formatDuration } from "../domain/time";
import type { Progress } from "../domain/progress";
import type { RemainingTime } from "../domain/runtime";
import styles from "./ShowCard.module.css";

export type ShowCardProps = {
  title: string;
  /** 1-based position, shown in the corner badge as the old card did. */
  index: number;
  posterUrl: string | null;
  bannerUrl: string | null;
  imageMode: "poster" | "banner";
  progress: Progress;
  remainingTime: RemainingTime;
  imdbRating: number | null;
  imdbId: string | null;
  networkName: string | null;
  networkLogoUrl: string | null;
  yearRangeLabel: string | null;
  contentRating: string | null;
  genreLabel: string | null;
  onOpenEpisodes: () => void;
  onOpenSeasons: () => void;
  onMarkNextWatched: () => void;
  /** Cycles to the next available poster or banner. */
  onCycleImage: () => void;
  busy?: boolean;
};

function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function ShowCard({
  title,
  index,
  posterUrl,
  bannerUrl,
  imageMode,
  progress,
  remainingTime,
  imdbRating,
  imdbId,
  networkName,
  networkLogoUrl,
  yearRangeLabel,
  contentRating,
  genreLabel,
  onOpenEpisodes,
  onOpenSeasons,
  onMarkNextWatched,
  onCycleImage,
  busy = false,
}: ShowCardProps): React.JSX.Element {
  const banner = imageMode === "banner";
  const imageUrl = banner ? bannerUrl : posterUrl;
  const next = progress.nextToWatch;

  // Watched out of aired, not out of total: a show still airing is not "40%
  // done" because six unaired episodes exist. This is the bar the old card drew
  // from SIMKL's aggregates; it now comes from the episode list.
  const percent = progress.aired > 0 ? Math.round((progress.watched / progress.aired) * 100) : 0;

  return (
    <article className="card carousel-card">
      <div className={`poster-wrap${imageUrl ? " cycleable" : ""}`}>
        {imageUrl ? (
          <button
            type="button"
            className={styles.imageButton}
            onClick={onCycleImage}
            aria-label={`Show a different ${banner ? "banner" : "poster"} for ${title}`}
          >
            <img
              className={banner ? "poster banner-img" : "poster"}
              src={imageUrl}
              alt=""
              loading="lazy"
            />
          </button>
        ) : (
          <div className={banner ? "poster banner-img placeholder" : "poster placeholder"} />
        )}

        <span className="badge year-corner-badge">#{index}</span>

        {progress.remaining > 0 ? (
          <button
            type="button"
            className="remaining-badge"
            onClick={onOpenEpisodes}
            title="Episodes left to watch"
          >
            {progress.remaining}
          </button>
        ) : null}

        {networkLogoUrl ? (
          <span className="badge network-badge">
            <img className="network-badge-logo" src={networkLogoUrl} alt={networkName ?? ""} />
          </span>
        ) : networkName ? (
          <span className="badge network-badge">{networkName}</span>
        ) : null}
      </div>

      <div className="card-body">
        <h3>
          <button type="button" className={styles.titleButton} onClick={onOpenSeasons}>
            {title}
          </button>
        </h3>

        {yearRangeLabel ? <span className="premiere-badge year-badge">{yearRangeLabel}</span> : null}

        {imdbRating != null ? (
          <div className="list-imdb">
            {imdbId ? (
              <a
                className="imdb-pill-btn"
                href={`https://www.imdb.com/title/${imdbId}/`}
                target="_blank"
                rel="noreferrer"
              >
                <span className="imdb-pill">
                  <span className="imdb-pill-rating">{imdbRating.toFixed(1)}</span>
                </span>
              </a>
            ) : (
              <span className="imdb-pill">
                <span className="imdb-pill-rating">{imdbRating.toFixed(1)}</span>
              </span>
            )}
          </div>
        ) : null}

        {contentRating || genreLabel ? (
          <div className="content-meta-row">
            {contentRating ? <span className="content-rating-badge">{contentRating}</span> : null}
            {genreLabel ? <span className="genre-label">{genreLabel}</span> : null}
          </div>
        ) : null}

        <div className="watch-progress">
          <div className="watch-progress-track">
            <div className="watch-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="watch-progress-text">
            {progress.watched} / {progress.aired} watched
          </div>
        </div>

        {next ? (
          <>
            <div className="next-up-row">
              <p className="next-up">
                <button type="button" className={styles.nextButton} onClick={onOpenSeasons}>
                  {episodeCode(next.season, next.episode)}
                </button>
                {next.title ? <span className="episode-title">{next.title}</span> : null}
              </p>
            </div>

            {next.airDate ? <div className="air-date">{formatAirDate(next.airDate)}</div> : null}

            <div className="card-fill-spacer" />

            <button type="button" className="time-left" onClick={onOpenEpisodes}>
              <span className="time-icon" aria-hidden="true">
                &#9201;
              </span>
              {formatDuration(remainingTime.totalMinutes)} left
            </button>

            <button
              type="button"
              className="my-list-next"
              onClick={onMarkNextWatched}
              disabled={busy}
            >
              Mark {episodeCode(next.season, next.episode)} watched
            </button>
          </>
        ) : (
          <>
            <div className="card-fill-spacer" />
            {/* Caught up. The next airing episode is the useful thing to say,
                and when there is none the show has simply run out. */}
            {progress.nextAiring?.airDate ? (
              <div className="air-date">Next: {formatAirDate(progress.nextAiring.airDate)}</div>
            ) : (
              <p className="section-note">Nothing left to watch.</p>
            )}
          </>
        )}
      </div>
    </article>
  );
}
