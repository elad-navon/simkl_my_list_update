/** Content rating and genre label extraction. Ported from app.js:610-632. */

export type TmdbContentRatings = {
  results?: Array<{ iso_3166_1?: string; rating?: string }> | undefined;
};

/**
 * TMDB returns one entry per country. US is what US-style age badges show,
 * so prefer it and fall back to any country with a non-empty rating rather
 * than rendering nothing.
 */
export function extractContentRating(
  contentRatings: TmdbContentRatings | null | undefined,
): string | null {
  const results = contentRatings?.results;
  if (!results || !results.length) return null;
  const us = results.find((r) => r.iso_3166_1 === "US" && r.rating);
  if (us?.rating) return us.rating;
  return results.find((r) => r.rating)?.rating ?? null;
}

/** "Action & Adventure, Drama and Crime" - TMDB's own list style. */
export function joinGenreNames(names: readonly string[]): string | null {
  if (!names.length) return null;
  if (names.length === 1) return names[0] ?? null;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function extractGenreLabel(
  genres: ReadonlyArray<{ name?: string | null }> | null | undefined,
): string | null {
  if (!genres || !genres.length) return null;
  return joinGenreNames(genres.map((g) => g.name).filter((n): n is string => Boolean(n)));
}

/**
 * "2016-2019" once a show has ended, "2016-" while it is still running.
 * Ported from app.js:1119-1120.
 *
 * The trailing dash is deliberate in both cases: an ended show whose final year
 * the source never recorded still reads as finished-but-unknown rather than
 * silently as ongoing.
 */
export function yearRangeLabel(
  firstAirDate: string | null | undefined,
  lastAirDate: string | null | undefined,
  ended: boolean,
): string | null {
  const start = firstAirDate?.slice(0, 4);
  if (!start) return null;
  const end = ended ? (lastAirDate?.slice(0, 4) ?? "") : "";
  return `${start}-${end}`;
}
