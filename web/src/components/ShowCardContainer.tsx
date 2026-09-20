/**
 * One card, with its own metadata query.
 *
 * A query per show rather than one for the whole list, which is what lets a slow
 * or failing source affect exactly one card. The old app gathered every show's
 * data into one `Promise.all` and then rendered the lot (app.js:1150-1260), so a
 * single hanging request delayed the entire page.
 *
 * Also where the artwork and the rating are resolved, because both depend on the
 * TMDB show detail that `useShowData` already fetched - asking for it again here
 * would be a second request for something already in hand.
 */

import { useQuery } from "@tanstack/react-query";
import { computeImages } from "../domain/images";
import { extractContentRating, extractGenreLabel, yearRangeLabel } from "../domain/metadata";
import { latestNetwork, resolveNetworkLogoUrl } from "../domain/networks";
import { TMDB_IMAGE_BASES } from "../api/tmdb";
import { queryKeys, STALE_TIME } from "../query/client";
import type { ApiClients } from "../api/clients";
import type { LibraryShow } from "../library/schema";
import { useShowData } from "../hooks/useShowData";
import { useInView } from "../hooks/useInView";
import { ShowCard } from "./ShowCard";
import type { WatchedPatch } from "../domain/watchEdits";

export type ShowCardContainerProps = {
  show: LibraryShow;
  index: number;
  clients: ApiClients;
  mode: string;
  imageMode: "poster" | "banner";
  onOpenSeasons: (show: LibraryShow) => void;
  onOpenEpisodes: (show: LibraryShow) => void;
  onApplyPatch: (show: LibraryShow, patch: WatchedPatch) => void;
  onCycleImage: (show: LibraryShow, mode: "poster" | "banner", nextPath: string) => void;
  busy?: boolean;
  /**
   * True for the handful of cards that should load without waiting to be seen, so
   * the first screen is not a row of skeletons while an observer decides.
   */
  eager?: boolean;
};

export function ShowCardContainer({
  show,
  index,
  clients,
  mode,
  imageMode,
  onOpenSeasons,
  onOpenEpisodes,
  onApplyPatch,
  onCycleImage,
  busy = false,
  eager = false,
}: ShowCardContainerProps): React.JSX.Element | null {
  const { ref, inView } = useInView<HTMLElement>({ skip: eager });
  const { data, error } = useShowData(show, clients, mode, inView);
  const tmdbShow = data?.loaded.tmdbShow ?? null;
  const imdbId = tmdbShow?.external_ids?.imdb_id ?? show.ids.imdb ?? null;

  // The IMDb rating is its own query: OMDb is optional, slower than the rest and
  // purely cosmetic, so it must not hold a card back.
  const rating = useQuery({
    queryKey: queryKeys.omdb.rating(imdbId ?? "none"),
    enabled: imdbId !== null && clients.omdb !== null,
    staleTime: STALE_TIME.omdbRating,
    queryFn: ({ signal }) => clients.omdb?.getRating(imdbId, signal) ?? null,
  });

  const images = computeImages(
    tmdbShow,
    { poster: TMDB_IMAGE_BASES.poster, backdrop: TMDB_IMAGE_BASES.backdrop },
    show.images ?? null,
  );

  const network = latestNetwork(tmdbShow?.networks);

  /** Steps to the next artwork, wrapping - the old cycle behaviour. */
  const cycle = () => {
    const paths = imageMode === "banner" ? images.backdropPaths : images.posterPaths;
    if (paths.length < 2) return;
    const current = imageMode === "banner" ? images.bannerIndex : images.posterIndex;
    const next = paths[(current + 1) % paths.length];
    if (next) onCycleImage(show, imageMode, next);
  };

  if (!data) {
    // A skeleton rather than nothing, so the carousel does not reflow as each card
    // resolves (`.poster` already carries the loading pulse, style.css:321) - but a
    // FAILED card says so. An eternal skeleton is indistinguishable from a slow
    // one, which is exactly the confusion that cost an afternoon.
    return (
      // The ref lives on the placeholder, which is what has to be observed: the
      // card cannot report that it is visible once it exists, because it only
      // exists after the data it was waiting for arrives.
      <article className="card carousel-card" ref={ref}>
        <div className="poster-wrap">
          <div className={imageMode === "banner" ? "poster banner-img" : "poster"} />
        </div>
        <div className="card-body">
          <h3>{show.title}</h3>
          {error ? <p className="section-note">Could not load: {error.message}</p> : null}
        </div>
      </article>
    );
  }

  return (
    <ShowCard
      title={show.title}
      index={index}
      posterUrl={images.posterUrl}
      bannerUrl={images.bannerUrl}
      imageMode={imageMode}
      progress={data.progress}
      remainingTime={data.remainingTime}
      imdbRating={rating.data?.rating ?? null}
      imdbId={imdbId}
      networkName={network?.name ?? null}
      networkLogoUrl={resolveNetworkLogoUrl(
        network?.name,
        network?.logo_path,
        TMDB_IMAGE_BASES.logo,
        import.meta.env.BASE_URL,
      )}
      yearRangeLabel={yearRangeLabel(
        tmdbShow?.first_air_date,
        tmdbShow?.last_air_date,
        data.loaded.seriesEnded,
      )}
      contentRating={extractContentRating(tmdbShow?.content_ratings)}
      genreLabel={extractGenreLabel(tmdbShow?.genres)}
      onOpenEpisodes={() => onOpenEpisodes(show)}
      onOpenSeasons={() => onOpenSeasons(show)}
      onMarkNextWatched={() => {
        const next = data.progress.nextToWatch;
        if (!next) return;
        onApplyPatch(show, {
          add: [{ season: next.season, episode: next.episode, watchedAt: new Date().toISOString() }],
          remove: [],
        });
      }}
      onCycleImage={cycle}
      busy={busy}
    />
  );
}
