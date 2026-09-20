/**
 * SIMKL. Ported from app.js:161-305, 547-594, 1551-1571, 1638.
 *
 * The original plan had this file deleted at the end of the rewrite. It is a
 * permanent part of the app instead: SIMKL stays the source of truth for
 * day-to-day use, with the local library kept as a live mirror, so
 * independence is a setting to flip rather than a migration to perform.
 *
 * Two things are deliberately different from the old implementation:
 *
 * - Nothing here touches localStorage. The old `simklGet` deleted the token
 *   itself on a 401 (app.js:240), which welded the request layer to the
 *   storage layer and made it untestable. A 401 raises `SimklAuthError` and
 *   whoever owns the token decides what to do about it.
 * - The PIN poll takes its sleep as a parameter, so the flow can be tested
 *   without waiting through real five-second intervals.
 *
 * What has NOT changed is the set of endpoints and their parameters. Each one
 * is there for a reason the old app found the hard way, and the notes on the
 * read methods say which.
 */

import { getJson, HttpError, NetworkError } from "./http";
import type { Episode, ShowStatus } from "../domain/types";
import { SHOW_STATUSES } from "../domain/types";
import type { SimklItem } from "../library/migrate/simkl";

export const SIMKL_BASE = "https://api.simkl.com";
const SERVICE = "SIMKL";

/** Identifies the app to SIMKL. Unchanged from app.js:27-28. */
const APP_NAME = "my-list-summary-web";
const APP_VERSION = "1.0";

/**
 * A 401 from SIMKL.
 *
 * There is no refresh token in the PIN flow, so this is terminal: the only
 * recovery is authorizing again. Raised as its own type precisely so the UI can
 * say that, rather than showing a generic request failure.
 */
export class SimklAuthError extends Error {
  constructor(message = "SIMKL authorization expired or was revoked.") {
    super(message);
    this.name = "SimklAuthError";
  }
}

export type SimklEpisodePayload = {
  season?: number | null;
  episode?: number | null;
  title?: string | null;
  /** Full ISO datetime with the broadcast timezone's offset. */
  date?: string | null;
  type?: string | null;
};

export type SimklShowDetail = {
  ratings?: { imdb?: { rating?: number | null; votes?: number | null } | null } | null;
  network?: string | null;
};

export type SimklSearchResult = {
  title?: string | null;
  year?: number | null;
  poster?: string | null;
  ids?: { simkl?: number | null; tmdb?: number | string | null; imdb?: string | null } | null;
};

export type SimklPinStart = {
  userCode: string;
  verificationUrl: string;
  /** Seconds between polls, as SIMKL asks. */
  intervalSec: number;
  /** Seconds until the code stops being accepted. */
  expiresIn: number;
};

export type SimklClient = {
  /** The five lists, in one call each. */
  getList: (status: ShowStatus, signal?: AbortSignal) => Promise<SimklItem[]>;
  getAllLists: (signal?: AbortSignal) => Promise<Record<ShowStatus, SimklItem[]>>;
  getEpisodes: (simklId: number, signal?: AbortSignal) => Promise<SimklEpisodePayload[] | null>;
  getShowDetail: (simklId: number, signal?: AbortSignal) => Promise<SimklShowDetail | null>;
  searchShows: (query: string, signal?: AbortSignal) => Promise<SimklSearchResult[]>;

  addToList: (ids: SimklWriteIds, status: ShowStatus) => Promise<void>;
  removeFromList: (ids: SimklWriteIds) => Promise<void>;
  markEpisodeWatched: (simklId: number, season: number, episode: number) => Promise<void>;
  removeEpisodeFromHistory: (simklId: number, season: number, episode: number) => Promise<void>;
  /** Several episodes of one show in a single request. */
  addEpisodesToHistory: (simklId: number, episodes: readonly EpisodeRef[]) => Promise<void>;
  removeEpisodesFromHistory: (simklId: number, episodes: readonly EpisodeRef[]) => Promise<void>;
};

/** A season/episode pair, as SIMKL's history endpoints group them. */
export type EpisodeRef = { season: number; episode: number };

/**
 * SIMKL's nested shape: one entry per season, each listing its episodes. Sending
 * two hundred episodes as two hundred requests would be the obvious way to get
 * rate-limited for no reason.
 */
function groupBySeason(episodes: readonly EpisodeRef[]) {
  const bySeason = new Map<number, number[]>();
  for (const ref of episodes) {
    const list = bySeason.get(ref.season) ?? [];
    list.push(ref.episode);
    bySeason.set(ref.season, list);
  }
  return [...bySeason.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, eps]) => ({ number, episodes: eps.sort((a, b) => a - b).map((n) => ({ number: n })) }));
}

/** SIMKL accepts any subset of these when identifying a show for a write. */
export type SimklWriteIds = {
  simkl?: number | undefined;
  tmdb?: number | undefined;
  imdb?: string | undefined;
};

export function createSimklClient(options: {
  clientId: string;
  token: string;
  fetchImpl?: typeof fetch | undefined;
}): SimklClient {
  const baseParams = {
    client_id: options.clientId,
    "app-name": APP_NAME,
    "app-version": APP_VERSION,
  };

  /** Converts a 401 into the one error the UI needs to handle specially. */
  const rethrow = (error: unknown): never => {
    if (error instanceof HttpError && error.status === 401) throw new SimklAuthError();
    throw error;
  };

  const get = async <T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
    signal?: AbortSignal,
  ): Promise<T | null> => {
    try {
      return await getJson<T>(`${SIMKL_BASE}${path}`, {
        service: SERVICE,
        params: { ...baseParams, ...params },
        headers: { Authorization: `Bearer ${options.token}` },
        ...(signal ? { signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    } catch (error) {
      return rethrow(error);
    }
  };

  const post = async (path: string, body: unknown): Promise<void> => {
    const url = new URL(`${SIMKL_BASE}${path}`);
    for (const [key, value] of Object.entries(baseParams)) url.searchParams.set(key, value);

    const fetchImpl = options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new NetworkError(SERVICE, cause);
    }

    if (response.status === 401) throw new SimklAuthError();
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError(SERVICE, response.status, url.toString(), text);
    }
  };

  /** SIMKL answers a list either as a bare array or wrapped in `{ shows }`. */
  const asItems = (data: unknown): SimklItem[] => {
    if (Array.isArray(data)) return data as SimklItem[];
    const shows = (data as { shows?: unknown })?.shows;
    return Array.isArray(shows) ? (shows as SimklItem[]) : [];
  };

  const getList = async (status: ShowStatus, signal?: AbortSignal): Promise<SimklItem[]> =>
    asItems(
      await get(
        `/sync/all-items/shows/${status}`,
        { extended: "full", episode_watched_at: "yes" },
        signal,
      ),
    );

  return {
    /**
     * `extended=full` brings the aggregate counts and the show's ids;
     * `episode_watched_at=yes` is what makes per-episode `watched_at`
     * timestamps appear at all.
     *
     * Worth knowing before relying on it: SIMKL returns that per-episode data
     * for `watching` and `hold` ONLY. For `completed` and `dropped` the
     * `seasons` array is absent however these parameters are set, which on this
     * library is 584 of 709 shows. `reconstructWatched` rebuilds those from
     * `watched_episodes_count`, live exactly as it does for the import.
     */
    getList,

    /**
     * All five lists at once.
     *
     * The old app fetched three of them for the main view and then, to answer
     * "is this show already on my list?", fetched all five again per query
     * (`findShowLibraryStatus`, app.js:1638). With a local mirror that question
     * is an O(1) lookup, so this exists only to fill the mirror.
     */
    async getAllLists(signal) {
      const results = await Promise.all(
        SHOW_STATUSES.map(async (status) => [status, await getList(status, signal)] as const),
      );
      return Object.fromEntries(results) as Record<ShowStatus, SimklItem[]>;
    },

    /**
     * SIMKL's own episode list, via TheTVDB. Its `date` is a full ISO datetime
     * WITH the broadcast timezone's offset - the one field TMDB has no
     * equivalent for, and the reason the old app kept SIMKL for air dates.
     */
    getEpisodes(simklId, signal) {
      return get<SimklEpisodePayload[]>(`/tv/episodes/${simklId}`, { extended: "full" }, signal);
    },

    /** IMDb rating and network name. OMDb covers the rating when SIMKL is off. */
    getShowDetail(simklId, signal) {
      return get<SimklShowDetail>(`/tv/${simklId}`, { extended: "full" }, signal);
    },

    /**
     * SIMKL's search handles Hebrew queries poorly, which is why the old app
     * ran TMDB's search alongside it rather than instead of it (app.js:1581).
     * That still holds: use both and merge.
     */
    async searchShows(query, signal) {
      const data = await get<SimklSearchResult[]>("/search/tv", { q: query }, signal);
      return Array.isArray(data) ? data : [];
    },

    addToList(ids, status) {
      return post("/sync/add-to-list", { shows: [{ ids, to: status }] });
    },

    removeFromList(ids) {
      return post("/sync/history/remove", { shows: [{ ids }] });
    },

    markEpisodeWatched(simklId, season, episode) {
      return post("/sync/history", {
        shows: [{ ids: { simkl: simklId }, seasons: [{ number: season, episodes: [{ number: episode }] }] }],
      });
    },

    /**
     * The one call here with no precedent in the old app, which had no way to
     * un-mark an episode at all. `/sync/history/remove` takes the same nested
     * shape as `/sync/history` - the old code used the same endpoint to remove a
     * whole show (app.js:1558) - so this is the documented form rather than a
     * behaviour observed in production. A non-2xx throws, so a wrong guess
     * surfaces as a visible failure rather than as silent divergence.
     */
    removeEpisodeFromHistory(simklId, season, episode) {
      return post("/sync/history/remove", {
        shows: [{ ids: { simkl: simklId }, seasons: [{ number: season, episodes: [{ number: episode }] }] }],
      });
    },

    async addEpisodesToHistory(simklId, episodes) {
      if (episodes.length === 0) return;
      await post("/sync/history", {
        shows: [{ ids: { simkl: simklId }, seasons: groupBySeason(episodes) }],
      });
    },

    async removeEpisodesFromHistory(simklId, episodes) {
      if (episodes.length === 0) return;
      await post("/sync/history/remove", {
        shows: [{ ids: { simkl: simklId }, seasons: groupBySeason(episodes) }],
      });
    },
  };
}

// --- the PIN flow -----------------------------------------------------------

/**
 * Starts the PIN authorization and returns the code to show the user.
 *
 * No client credentials are involved beyond the client id, and no token is
 * stored here - `pollForToken` returns it and the caller decides where it goes.
 */
export async function startPinAuth(
  clientId: string,
  fetchImpl?: typeof fetch,
): Promise<SimklPinStart> {
  const data = await getJson<{
    user_code?: string;
    verification_url?: string;
    interval?: number;
    expires_in?: number;
  }>(`${SIMKL_BASE}/oauth/pin`, {
    service: SERVICE,
    params: { client_id: clientId, "app-name": APP_NAME, "app-version": APP_VERSION },
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  if (!data?.user_code) throw new Error("SIMKL did not return a PIN code.");

  return {
    userCode: data.user_code,
    verificationUrl: data.verification_url ?? "https://simkl.com/pin",
    intervalSec: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  };
}

export type PollOptions = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
};

/**
 * Polls until the user approves the code, then returns the access token.
 *
 * Transient failures are swallowed and the poll continues, because the window
 * in which the user is off approving the code in another tab is exactly when a
 * flaky response is least worth giving up over - same behaviour as the old loop
 * (app.js:212-217). An expired code returns null rather than throwing, since
 * it is an ordinary outcome the UI has to offer a retry for either way.
 */
export async function pollForToken(
  clientId: string,
  start: SimklPinStart,
  options: PollOptions = {},
): Promise<string | null> {
  const {
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    signal,
    fetchImpl,
  } = options;

  const deadline = now() + start.expiresIn * 1000;

  while (now() < deadline) {
    await sleep(start.intervalSec * 1000);
    if (signal?.aborted) return null;

    try {
      const poll = await getJson<{ result?: string; access_token?: string }>(
        `${SIMKL_BASE}/oauth/pin/${start.userCode}`,
        {
          service: SERVICE,
          params: { client_id: clientId, "app-name": APP_NAME, "app-version": APP_VERSION },
          ...(signal ? { signal } : {}),
          ...(fetchImpl ? { fetchImpl } : {}),
        },
      );
      if (poll?.result === "OK" && poll.access_token) return poll.access_token;
    } catch {
      // Keep polling. The user is mid-approval in another tab; a single bad
      // response is not a reason to make them start over.
    }
  }
  return null;
}

// --- normalization ----------------------------------------------------------

/**
 * SIMKL's episode list in the domain shape.
 *
 * Shares every rule with the import path's normalizer - unnumbered specials
 * dropped, dateless episodes kept - because it is the same data arriving
 * through a different door. See `migrate/simklEpisodes.ts` for why each rule is
 * what it is.
 */
export function normalizeSimklApiEpisodes(
  payload: readonly SimklEpisodePayload[] | null | undefined,
): Episode[] {
  if (!Array.isArray(payload)) return [];

  const out: Episode[] = [];
  for (const ep of payload) {
    if (ep.season == null || ep.episode == null) continue;
    out.push({
      season: ep.season,
      episode: ep.episode,
      airDate: ep.date ?? null,
      title: ep.title?.trim() || null,
      // SIMKL has no per-episode runtime on this endpoint; only a show-level one.
      runtime: null,
    });
  }
  return out;
}

/** Search results in the shape the search UI uses, matching TMDB's. */
export function simklSearchResultToSummary(result: SimklSearchResult): {
  title: string;
  year: string;
  posterUrl: string | null;
  ids: { simkl?: number; tmdb?: number; imdb?: string };
} {
  const ids: { simkl?: number; tmdb?: number; imdb?: string } = {};
  if (result.ids?.simkl != null) ids.simkl = result.ids.simkl;
  const tmdb = result.ids?.tmdb;
  if (tmdb != null && tmdb !== "") {
    const n = Number(tmdb);
    if (Number.isFinite(n)) ids.tmdb = n;
  }
  if (result.ids?.imdb) ids.imdb = result.ids.imdb;

  return {
    title: result.title || "Unknown",
    year: result.year != null ? String(result.year) : "",
    posterUrl: result.poster ? `https://simkl.in/posters/${result.poster}_m.jpg` : null,
    ids,
  };
}
