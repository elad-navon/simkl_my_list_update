/**
 * The dashboard: the stats header, the My List carousel, and the modals.
 *
 * The structural difference from the old page is that there is no render
 * function. `renderRows` emptied all of `#app` and rebuilt it from template
 * strings, then restored panel scroll positions by hand and re-attached
 * listeners (app.js:3067-3085) - all of which existed because rendering meant
 * destroying the DOM. Here a state change re-renders the parts that changed and
 * scroll position is simply never lost.
 *
 * The other difference is that a show exists once. The old page kept five
 * separate copies across five arrays with independent state, which is why
 * `syncImageAcrossCards` and `patchImagesForTmdbId` had to exist (app.js:2560,
 * 2595). The library is keyed, so there is one row and nothing to keep in step.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiClients } from "../api/clients";
import { buildSeasonView, defaultOpenSeason } from "../domain/seasonView";
import { myListSortKey, recentlyWatched, sortByKeyDescending } from "../domain/lists";
import { mostRecentWatchedAt } from "../domain/progress";
import type { WatchedPatch } from "../domain/watchEdits";
import type { LibraryBackend } from "../library/backend";
import type { Library, LibraryShow } from "../library/schema";
import type { Episode } from "../domain/types";
import { queryKeys } from "../query/client";
import { EpisodeBrowser } from "./EpisodeBrowser";
import { ShowCardContainer } from "./ShowCardContainer";
import { useShowData } from "../hooks/useShowData";
import { useNewEpisodeCheck } from "../hooks/useNewEpisodeCheck";
import { describeNewEpisode } from "../domain/newEpisodes";
import { useQueryClient as useClient } from "@tanstack/react-query";

/**
 * How many cards load without waiting to be seen.
 *
 * Six is a little more than fits across a desktop carousel, so the first screen
 * is populated and the seventh is already on its way.
 */
const EAGER_CARDS = 6;

export type DashboardProps = {
  library: Library;
  backend: LibraryBackend;
  clients: ApiClients;
  imageMode: "poster" | "banner";
  onSetImage: (show: LibraryShow, mode: "poster" | "banner", path: string) => void;
};

/**
 * The episode browser, with its own data query.
 *
 * Separate component because it needs the same `useShowData` the card used - and
 * therefore hits the same cache entry, so opening a show costs nothing.
 */
function SeasonsModal({
  show,
  clients,
  mode,
  onApply,
  onClose,
  busy,
}: {
  show: LibraryShow;
  clients: ApiClients;
  mode: string;
  onApply: (patch: WatchedPatch) => void;
  onClose: () => void;
  busy: boolean;
}): React.JSX.Element {
  const { data } = useShowData(show, clients, mode);

  const view = useMemo(
    () => data?.seasonView ?? buildSeasonView([], show.watched),
    [data, show.watched],
  );

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-box" onClick={(e) => e.stopPropagation()} role="presentation">
        <EpisodeBrowser
          title={show.title}
          view={view}
          episodes={data?.episodes ?? []}
          airedEpisodes={data ? airedOf(data.episodes, data.progress.aired) : []}
          watched={show.watched}
          initialSeason={defaultOpenSeason(view)}
          onApply={onApply}
          onClose={onClose}
          busy={busy}
        />
      </div>
    </div>
  );
}

/**
 * The aired slice of an episode list.
 *
 * Taken as a prefix of the sorted list using the count `computeProgress` already
 * worked out, rather than re-deciding what "aired" means here. Re-deriving it
 * would risk the two disagreeing, which is the class of bug this rewrite exists
 * to remove.
 */
function airedOf(episodes: readonly { season: number; episode: number; airDate: string | null; title: string | null; runtime: number | null }[], airedCount: number) {
  return episodes.filter((ep) => ep.season !== 0).slice(0, airedCount);
}

export function Dashboard({
  library,
  backend,
  clients,
  imageMode,
  onSetImage,
}: DashboardProps): React.JSX.Element {
  const [seasonsFor, setSeasonsFor] = useState<LibraryShow | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const shows = useMemo(() => Object.values(library.shows), [library]);

  /**
   * My List: shows you are watching, most recently relevant first.
   *
   * Ordering needs each show's progress, which lives in a per-show query, so the
   * rows are sorted by the signal the library itself holds - the last watch -
   * and the air-date half of the key is applied once a card's data arrives. The
   * old page could sort on both because it had already awaited every show before
   * rendering anything, which is exactly the wait this avoids.
   */
  const myList = useMemo(
    () =>
      sortByKeyDescending(
        shows.filter((s) => s.status === "watching"),
        (s) => myListSortKey({ nextToWatch: null, lastWatchedAt: mostRecentWatchedAt(s.watched) }),
      ),
    [shows],
  );

  const recent = useMemo(() => recentlyWatched(shows), [shows]);
  const newEpisodes = useNewEpisodeCheck();

  /**
   * Checks for new episodes once every card's data has arrived.
   *
   * Driven off the query cache rather than off its own fetch, because the cards
   * have already worked out each show's latest aired episode - asking again would
   * be a second round of requests for an answer already in hand. The old version
   * did fetch separately, which is why it needed its own SIMKL episode cache
   * (app.js:3369-3372).
   */
  const cache = useClient();
  const checkForNew = newEpisodes.check;
  useEffect(() => {
    const inputs = myList.map((show) => {
      const data = cache.getQueryData<{ progress: { latestAired: Episode | null } } | null>(
        queryKeys.showData(show.key, backend.mode),
      );
      return {
        key: show.key,
        title: show.title,
        latestAired: data?.progress.latestAired ?? null,
      };
    });

    // Nothing is checked until every show has resolved. A partial pass would seed
    // the snapshot for the shows that had loaded and then announce the rest on the
    // next run as though they were new.
    if (inputs.length > 0 && inputs.every((input) => input.latestAired !== null)) {
      checkForNew(inputs);
    }
  }, [myList, cache, backend.mode, checkForNew]);
  const planToWatch = useMemo(() => shows.filter((s) => s.status === "plantowatch"), [shows]);

  const apply = async (show: LibraryShow, patch: WatchedPatch) => {
    setBusyKey(show.key);
    setError(null);
    try {
      await backend.applyWatchedPatch(show.key, patch);
      // The metadata is unchanged; only the derived progress moved, so just the
      // one show's derived entry is invalidated rather than the whole cache.
      await queryClient.invalidateQueries({ queryKey: queryKeys.showData(show.key, backend.mode) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <section className="series-panel">
        <div className="series-panel-header">
          <div className="series-panel-header-left">
            <div className="series-panel-stat-group">
              <span className="series-panel-stat">
                <span className="num">{myList.length}</span>
                <span className="label">Shows</span>
              </span>
              <span className="stats-divider" />
              <span className="series-panel-stat">
                <span className="num">{shows.length}</span>
                <span className="label">In Library</span>
              </span>
              <span className="stats-divider" />
              <span className="series-panel-stat">
                <span className="num">{planToWatch.length}</span>
                <span className="label">Planned</span>
              </span>
            </div>
          </div>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {newEpisodes.fresh.length > 0 ? (
          <aside className="new-episode-banner">
            <div className="new-episode-banner-header">
              <strong>
                {newEpisodes.fresh.length === 1
                  ? "A new episode aired"
                  : `${newEpisodes.fresh.length} shows have new episodes`}
              </strong>
              <button
                type="button"
                className="new-episode-banner-close"
                aria-label="Dismiss"
                onClick={newEpisodes.dismiss}
              >
                &times;
              </button>
            </div>
            <ul className="new-episode-banner-list">
              {newEpisodes.fresh.map((entry) => (
                <li className="list-row" key={entry.key}>
                  <div className="list-row-title-wrap">
                    <span className="list-row-title">{entry.title}</span>
                    <div className="list-row-sub episode-code-sub">{describeNewEpisode(entry)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        <div className="carousel-wrap">
          <div className={`grid${imageMode === "banner" ? " banner-mode" : ""} carousel-track`}>
            {myList.map((show, i) => (
              <ShowCardContainer
                key={show.key}
                show={show}
                index={i + 1}
                clients={clients}
                mode={backend.mode}
                imageMode={imageMode}
                onOpenSeasons={setSeasonsFor}
                onOpenEpisodes={setSeasonsFor}
                onApplyPatch={(target, patch) => void apply(target, patch)}
                onCycleImage={onSetImage}
                busy={busyKey === show.key}
                // About what fits on screen. These load immediately so the first
                // view is real; the rest wait until they are scrolled towards.
                eager={i < EAGER_CARDS}
              />
            ))}
          </div>
          {myList.length === 0 ? (
            <p className="section-note">
              Nothing on your watching list yet. Use Search Show to add one.
            </p>
          ) : null}
        </div>
      </section>

      <div className="bottom-panels-row">
        <section className="list-panel">
          <div className="list-panel-header">
            <div className="list-panel-header-row">
              <h2>Recently Watched</h2>
              <span className="list-panel-count">{recent.length}</span>
            </div>
          </div>
          <div className="list-rows-scroll">
            {recent.map((row) => (
              <div className="list-row" key={row.key}>
                <div className="list-row-title-wrap">
                  <div className="title-with-year">
                    <span className="list-row-title">{row.title}</span>
                    {row.dropped ? <span className="premiere-badge dropped">DROPPED</span> : null}
                  </div>
                  <div className="list-row-sub episode-code-sub">
                    S{String(row.season).padStart(2, "0")}E{String(row.episode).padStart(2, "0")}
                  </div>
                  <div className="list-row-sub">
                    {new Date(row.watchedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
            {recent.length === 0 ? (
              <p className="section-note">Nothing watched yet.</p>
            ) : null}
          </div>
        </section>

        <section className="list-panel list-panel--plan">
          <div className="list-panel-header">
            <div className="list-panel-header-row">
              <h2>Plan to Watch</h2>
              <span className="list-panel-count">{planToWatch.length}</span>
            </div>
          </div>
          <div className="list-rows-scroll">
            {planToWatch.map((show) => (
              <div className="list-row" key={show.key}>
                <div className="list-row-title-wrap">
                  <span className="list-row-title">{show.title}</span>
                  {show.year ? <div className="list-row-sub">{show.year}</div> : null}
                </div>
              </div>
            ))}
            {planToWatch.length === 0 ? (
              <p className="section-note">Nothing planned.</p>
            ) : null}
          </div>
        </section>
      </div>

      {seasonsFor ? (
        <SeasonsModal
          show={library.shows[seasonsFor.key] ?? seasonsFor}
          clients={clients}
          mode={backend.mode}
          busy={busyKey === seasonsFor.key}
          onApply={(patch) => void apply(seasonsFor, patch)}
          onClose={() => setSeasonsFor(null)}
        />
      ) : null}
    </>
  );
}

