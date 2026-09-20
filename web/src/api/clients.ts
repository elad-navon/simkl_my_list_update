/**
 * Building the API clients from settings.
 *
 * One place decides which services are available, so nothing above has to ask
 * whether a key exists before using a source. A missing key means a null client,
 * and every consumer already treats a null source as "this source has nothing",
 * which is the same path a network failure takes.
 *
 * The TVmaze rate limiter is created once per client set rather than per
 * request, because a limiter that is recreated is a limiter that does not
 * limit - each new one would start with an empty window and let another burst
 * straight through.
 */

import { createOmdbClient, type OmdbClient } from "./omdb";
import { createRateLimiter, TVMAZE_RATE_LIMIT } from "./rateLimit";
import { createSimklClient, type SimklClient } from "./simkl";
import { createTmdbClient, type TmdbClient } from "./tmdb";
import { createTvmazeClient, type TvmazeClient } from "./tvmaze";
import type { Settings } from "../settings/schema";

export type ApiClients = {
  /** Null until a TMDB key is set, which is the one thing the app insists on. */
  tmdb: TmdbClient | null;
  /** Always available: TVmaze needs no key. */
  tvmaze: TvmazeClient;
  /** Null without an OMDb key; the IMDb rating badge is then simply absent. */
  omdb: OmdbClient | null;
  /** Null unless SIMKL mode is configured and authorized. */
  simkl: SimklClient | null;
};

export type SimklCredentials = {
  clientId: string;
  token: string;
};

export function createClients(
  settings: Settings,
  simklCredentials: SimklCredentials | null,
): ApiClients {
  return {
    tmdb: settings.tmdbApiKey ? createTmdbClient({ apiKey: settings.tmdbApiKey }) : null,
    tvmaze: createTvmazeClient({ schedule: createRateLimiter(TVMAZE_RATE_LIMIT) }),
    omdb: settings.omdbApiKey ? createOmdbClient({ apiKey: settings.omdbApiKey }) : null,
    simkl:
      simklCredentials?.clientId && simklCredentials.token
        ? createSimklClient(simklCredentials)
        : null,
  };
}
