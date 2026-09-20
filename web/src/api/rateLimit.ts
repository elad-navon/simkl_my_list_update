/**
 * A sliding-window rate limiter, for TVmaze.
 *
 * TVmaze is the one source here with no API key, which is also why it has a
 * published per-IP rate limit rather than a per-key quota: roughly 20 calls
 * every 10 seconds, answered with HTTP 429 once exceeded. A library this size
 * asks for a lot of episode lists, so hitting that is the default outcome
 * unless requests are paced, and a 429 storm looks exactly like the service
 * being down.
 *
 * Sliding window rather than a fixed one, because a fixed window lets 20 calls
 * land at 09:59.9 and 20 more at 10:00.1 - 40 calls inside a real second, which
 * is precisely what the limit exists to stop.
 *
 * The clock and the sleep are injected so the tests are instant and
 * deterministic rather than actually waiting ten seconds.
 */

export type RateLimiterOptions = {
  /** Calls permitted inside any `windowMs`-long span. */
  maxRequests: number;
  windowMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type Scheduler = <T>(task: () => Promise<T>) => Promise<T>;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Returns a `schedule(task)` that runs tasks in call order, never letting more
 * than `maxRequests` of them start inside any `windowMs` window.
 *
 * A task's own failure is the caller's to handle - it rejects out of `schedule`
 * untouched, and it never stalls the queue behind it. A slot is spent when a
 * task STARTS, not when it finishes, because that is what the service counts.
 */
export function createRateLimiter(options: RateLimiterOptions): Scheduler {
  const { maxRequests, windowMs, now = Date.now, sleep = defaultSleep } = options;

  if (maxRequests < 1) throw new Error("maxRequests must be at least 1");

  /** Start times inside the current window, oldest first. */
  const starts: number[] = [];

  // Admissions are serialized through this chain so two callers cannot both
  // read a free slot and then both take it.
  let queue: Promise<void> = Promise.resolve();

  async function admit(): Promise<void> {
    for (;;) {
      const t = now();
      while (starts.length > 0 && (starts[0] as number) <= t - windowMs) starts.shift();
      if (starts.length < maxRequests) {
        starts.push(t);
        return;
      }
      const oldest = starts[0] as number;
      await sleep(Math.max(oldest + windowMs - t, 0));
    }
  }

  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    const admitted = queue.then(admit);
    // The chain must survive a rejected task, or one failure would block
    // everything queued behind it forever.
    queue = admitted.then(
      () => undefined,
      () => undefined,
    );
    return admitted.then(task);
  };
}

/** TVmaze's published limit, with a call of headroom. */
export const TVMAZE_RATE_LIMIT = { maxRequests: 18, windowMs: 10_000 } as const;
