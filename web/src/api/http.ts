/**
 * The one place a network request is made.
 *
 * Three rules the old app arrived at the hard way and that every caller here
 * inherits instead of re-implementing:
 *
 * - 404 is data, not a failure. A show TMDB has never heard of, an episode list
 *   TVmaze does not carry - those are answers, and the old `tmdbGet` returned
 *   null for them (app.js:319) so a single unknown show could not take a whole
 *   render down. `getJson` returns null; everything else throws.
 * - A request that never answers is worse than one that fails, because nothing
 *   downstream can distinguish it from slow. Every request carries a timeout.
 * - The error says which service and which status, because "Failed to fetch"
 *   with no origin is what made the old CORS problems so hard to place
 *   (app.js:316).
 *
 * Caching deliberately lives nowhere near here. The old app hand-rolled two
 * layers of it - an in-memory promise map per endpoint plus a localStorage
 * mirror with its own TTLs and a pruning sweep (app.js:349-399) - and that is
 * exactly what TanStack Query and its IndexedDB persister replace.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly service: string;
  readonly body: string;

  constructor(service: string, status: number, url: string, body: string) {
    super(`${service} request failed (${status}): ${body.slice(0, 300) || url}`);
    this.name = "HttpError";
    this.service = service;
    this.status = status;
    this.body = body;
  }
}

export class NetworkError extends Error {
  readonly service: string;

  constructor(service: string, cause: unknown) {
    super(`Cannot reach ${service}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "NetworkError";
    this.service = service;
    this.cause = cause;
  }
}

export type GetJsonOptions = {
  /** Named in the error so a failure says which service it came from. */
  service: string;
  params?: Record<string, string | number | undefined> | undefined;
  signal?: AbortSignal | undefined;
  /** Default 15s. A request that hangs is indistinguishable from slow. */
  timeoutMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  fetchImpl?: typeof fetch | undefined;
};

export const DEFAULT_TIMEOUT_MS = 15_000;

export function buildUrl(
  base: string,
  params?: Record<string, string | number | undefined>,
): string {
  if (!params) return base;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  if (!query) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

/**
 * GETs JSON. Returns null for 404, throws `HttpError` for any other bad status
 * and `NetworkError` when the request never reached the service at all.
 *
 * An empty 200 body also returns null - TVmaze answers that way for a show with
 * no episodes yet, and `JSON.parse("")` would otherwise throw as if the service
 * were broken.
 */
export async function getJson<T>(url: string, options: GetJsonOptions): Promise<T | null> {
  const {
    service,
    params,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    headers,
    fetchImpl = fetch,
  } = options;

  const target = buildUrl(url, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);

  // The caller's own signal still has to work, so abort when either fires.
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetchImpl(target, {
        signal: controller.signal,
        ...(headers ? { headers } : {}),
      });
    } catch (cause) {
      // A caller-initiated abort is not a service problem, so it propagates as
      // itself rather than being dressed up as one.
      if (signal?.aborted) throw cause;
      throw new NetworkError(service, cause);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(service, response.status, target, body);
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
