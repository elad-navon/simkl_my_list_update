/**
 * Artwork selection. Ported from app.js:891-949.
 *
 * Kept pure: the old version read the saved override out of localStorage
 * itself, which is what made it untestable. The override is a parameter now.
 *
 * Language rule: prefer English or language-less artwork so cards never show
 * foreign-text posters - except for a show that has NEITHER, where Hebrew is
 * better than a blank card (several Israeli shows only have Hebrew artwork on
 * TMDB). Decided independently for posters and backdrops, since a show can
 * have an English poster but only a Hebrew backdrop.
 */

export type TmdbImage = { file_path?: string | null; iso_639_1?: string | null };

export type TmdbImageSource = {
  images?: { posters?: TmdbImage[]; backdrops?: TmdbImage[] } | undefined;
  poster_path?: string | null | undefined;
  backdrop_path?: string | null | undefined;
};

/** A poster/banner the user picked by hand, which outranks TMDB's default. */
export type ImageOverride = {
  posterPath?: string | null | undefined;
  bannerPath?: string | null | undefined;
};

export type ImageBases = { poster: string; backdrop: string };

export type ComputedImages = {
  posterUrl: string | null;
  bannerUrl: string | null;
  posterPaths: string[];
  backdropPaths: string[];
  posterIndex: number;
  bannerIndex: number;
};

const isEnglishOrNoLang = (p: TmdbImage) => p.iso_639_1 === "en" || p.iso_639_1 == null;
const isHebrew = (p: TmdbImage) => p.iso_639_1 === "he";

function pickPaths(all: TmdbImage[]): string[] {
  const preferred = all.filter(isEnglishOrNoLang);
  const chosen = preferred.length ? preferred : all.filter(isHebrew);
  return chosen.map((p) => p.file_path).filter((p): p is string => Boolean(p));
}

export function computeImages(
  showDetail: TmdbImageSource | null | undefined,
  bases: ImageBases,
  override?: ImageOverride | null,
): ComputedImages {
  const out: ComputedImages = {
    posterUrl: null,
    bannerUrl: null,
    posterPaths: [],
    backdropPaths: [],
    posterIndex: 0,
    bannerIndex: 0,
  };
  if (!showDetail) return out;

  out.posterPaths = pickPaths(showDetail.images?.posters ?? []);
  out.backdropPaths = pickPaths(showDetail.images?.backdrops ?? []);

  // Start from TMDB's own primary pick, but only if it survived the language
  // filter above; otherwise start at the front of the filtered list.
  if (showDetail.poster_path && out.posterPaths.includes(showDetail.poster_path)) {
    out.posterIndex = out.posterPaths.indexOf(showDetail.poster_path);
  }
  if (showDetail.backdrop_path && out.backdropPaths.includes(showDetail.backdrop_path)) {
    out.bannerIndex = out.backdropPaths.indexOf(showDetail.backdrop_path);
  }

  // A hand-picked image from a previous session wins, as long as that path is
  // still among the show's current artwork.
  if (override?.posterPath && out.posterPaths.includes(override.posterPath)) {
    out.posterIndex = out.posterPaths.indexOf(override.posterPath);
  }
  if (override?.bannerPath && out.backdropPaths.includes(override.bannerPath)) {
    out.bannerIndex = out.backdropPaths.indexOf(override.bannerPath);
  }

  const poster = out.posterPaths[out.posterIndex];
  if (poster) out.posterUrl = bases.poster + poster;
  const backdrop = out.backdropPaths[out.bannerIndex];
  if (backdrop) out.bannerUrl = bases.backdrop + backdrop;

  return out;
}
