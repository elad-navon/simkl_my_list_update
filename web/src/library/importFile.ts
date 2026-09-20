/**
 * Reading a library back from a file.
 *
 * The manual half of the safety net the plan asks for: export and import buttons
 * that work whether or not the Gist token is in order. It is also the path back
 * from a mistake - a library JSON is the same shape the backup carries, so
 * yesterday's download restores yesterday's history.
 *
 * Validated rather than trusted. A file that came off disk has been through a
 * text editor, a sync client and a drag-and-drop, and a half-parsed library
 * silently replacing a good one is the worst outcome available here - so this
 * refuses anything it cannot fully account for and says what was wrong.
 */

import { LIBRARY_VERSION, showKey, type Library, type LibraryShow } from "./schema";
import { SHOW_STATUSES, type ShowStatus } from "../domain/types";

export type ImportResult =
  | { ok: true; library: Library; shows: number; watchedEpisodes: number; warnings: string[] }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a watch map, dropping anything that is not a season/episode/timestamp.
 *
 * Returns the count it discarded rather than throwing: one unreadable entry
 * should not cost you the other nine hundred, but it should be reported.
 */
function parseWatched(raw: unknown): {
  watched: Record<number, Record<number, string>>;
  dropped: number;
} {
  const watched: Record<number, Record<number, string>> = {};
  let dropped = 0;
  if (!isObject(raw)) return { watched, dropped };

  for (const [seasonKey, episodes] of Object.entries(raw)) {
    const season = Number(seasonKey);
    if (!Number.isInteger(season) || !isObject(episodes)) {
      dropped += 1;
      continue;
    }
    for (const [episodeKey, watchedAt] of Object.entries(episodes)) {
      const episode = Number(episodeKey);
      if (!Number.isInteger(episode) || typeof watchedAt !== "string") {
        dropped += 1;
        continue;
      }
      (watched[season] ??= {})[episode] = watchedAt;
    }
  }
  return { watched, dropped };
}

/**
 * The cached progress summary, kept only if it is well-formed.
 *
 * Carried across because My List is DEFINED by it: a watching show with no summary
 * is included (its answer is unknown, and hiding it would make a fresh library look
 * empty), so a validator that silently drops the field puts every watching show
 * back on the list. That is exactly what happened - all 709 seeded summaries were
 * discarded on the way in and the list came back as 107 shows instead of nine.
 *
 * A malformed one is dropped rather than repaired, since it is only a cache and the
 * background pass will simply derive it again.
 */
function parseSummary(raw: unknown): LibraryShow["summary"] {
  if (!isObject(raw)) return undefined;
  const { remaining, nextAirDate, checkedAt } = raw;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) return undefined;
  if (typeof checkedAt !== "string") return undefined;
  return {
    remaining,
    nextAirDate: typeof nextAirDate === "string" ? nextAirDate : null,
    checkedAt,
  };
}

function parseIds(raw: unknown): LibraryShow["ids"] {
  if (!isObject(raw)) return {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    tmdb: num(raw["tmdb"]),
    imdb: typeof raw["imdb"] === "string" ? raw["imdb"] : undefined,
    tvdb: num(raw["tvdb"]),
    tvmaze: num(raw["tvmaze"]),
    simkl: num(raw["simkl"]),
  };
}

export function parseLibraryFile(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }

  if (!isObject(parsed) || !isObject(parsed["shows"])) {
    return { ok: false, error: "That does not look like a library file - it has no shows." };
  }

  const warnings: string[] = [];
  const version = parsed["version"];
  if (typeof version === "number" && version > LIBRARY_VERSION) {
    // Forward compatibility is not something this can promise, so it says so
    // rather than importing a newer shape and losing whatever it did not know
    // to carry across.
    return {
      ok: false,
      error: `That file was written by a newer version (${version}); this app understands up to ${LIBRARY_VERSION}.`,
    };
  }

  const shows: Record<string, LibraryShow> = {};
  let watchedEpisodes = 0;
  let droppedEntries = 0;
  let skipped = 0;

  for (const raw of Object.values(parsed["shows"])) {
    if (!isObject(raw)) {
      skipped += 1;
      continue;
    }

    const title = typeof raw["title"] === "string" ? raw["title"] : null;
    const status = SHOW_STATUSES.includes(raw["status"] as ShowStatus)
      ? (raw["status"] as ShowStatus)
      : null;
    const ids = parseIds(raw["ids"]);
    const key = typeof raw["key"] === "string" ? raw["key"] : showKey(ids);

    if (!title || !status || !key) {
      skipped += 1;
      continue;
    }

    const { watched, dropped } = parseWatched(raw["watched"]);
    droppedEntries += dropped;
    for (const episodes of Object.values(watched)) watchedEpisodes += Object.keys(episodes).length;

    const now = new Date().toISOString();
    shows[key] = {
      key,
      ids,
      title,
      ...(typeof raw["year"] === "number" ? { year: raw["year"] } : {}),
      status,
      watched,
      ...(Array.isArray(raw["manualEpisodes"])
        ? { manualEpisodes: raw["manualEpisodes"] as LibraryShow["manualEpisodes"] }
        : {}),
      ...(isObject(raw["images"]) ? { images: raw["images"] as LibraryShow["images"] } : {}),
      ...(parseSummary(raw["summary"]) ? { summary: parseSummary(raw["summary"]) } : {}),
      addedAt: typeof raw["addedAt"] === "string" ? raw["addedAt"] : now,
      updatedAt: typeof raw["updatedAt"] === "string" ? raw["updatedAt"] : now,
    };
  }

  if (Object.keys(shows).length === 0) {
    return { ok: false, error: "No usable shows in that file - nothing was changed." };
  }

  if (skipped > 0) warnings.push(`${skipped} shows could not be read and were left out.`);
  if (droppedEntries > 0) warnings.push(`${droppedEntries} watch entries were unreadable.`);

  return {
    ok: true,
    library: {
      version: LIBRARY_VERSION,
      syncedAt: typeof parsed["syncedAt"] === "string" ? parsed["syncedAt"] : null,
      shows,
    },
    shows: Object.keys(shows).length,
    watchedEpisodes,
    warnings,
  };
}
