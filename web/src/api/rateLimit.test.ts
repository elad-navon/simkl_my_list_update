import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

/** A controllable clock: sleeping advances it instead of waiting. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    get time() {
      return t;
    },
  };
}

describe("createRateLimiter", () => {
  it("lets the first burst through without waiting", async () => {
    const clock = fakeClock();
    const schedule = createRateLimiter({ maxRequests: 3, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await Promise.all([1, 2, 3].map((n) => schedule(async () => n)));
    expect(clock.time).toBe(0);
  });

  it("delays the request that would exceed the window", async () => {
    const clock = fakeClock();
    const schedule = createRateLimiter({ maxRequests: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await Promise.all([1, 2, 3].map((n) => schedule(async () => n)));
    // The third can only start once the first has aged out of the window.
    expect(clock.time).toBe(1000);
  });

  it("slides the window instead of resetting it on a boundary", async () => {
    // A fixed window would let 2 through at t=999 and 2 more at t=1001.
    const clock = fakeClock();
    const schedule = createRateLimiter({ maxRequests: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await schedule(async () => "a");
    clock.advance(999);
    await schedule(async () => "b");
    await schedule(async () => "c");
    expect(clock.time).toBe(1000); // waited for "a" to age out, not for a reset
  });

  it("reuses a slot freed by the passage of time", async () => {
    const clock = fakeClock();
    const schedule = createRateLimiter({ maxRequests: 1, windowMs: 100, now: clock.now, sleep: clock.sleep });

    await schedule(async () => 1);
    clock.advance(100);
    await schedule(async () => 2);
    expect(clock.time).toBe(100); // no sleep needed the second time
  });

  it("runs tasks in the order they were scheduled", async () => {
    const clock = fakeClock();
    const schedule = createRateLimiter({ maxRequests: 1, windowMs: 10, now: clock.now, sleep: clock.sleep });
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((n) =>
        schedule(async () => {
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("passes a task's own rejection straight through", async () => {
    const schedule = createRateLimiter({ maxRequests: 5, windowMs: 1000 });
    await expect(schedule(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("keeps serving after a task fails", async () => {
    // One rejection must not wedge everything queued behind it.
    const clock = fakeClock();
    const schedule = createRateLimiter({ maxRequests: 1, windowMs: 10, now: clock.now, sleep: clock.sleep });

    const failed = schedule(async () => Promise.reject(new Error("boom")));
    const after = schedule(async () => "ok");

    await expect(failed).rejects.toThrow("boom");
    await expect(after).resolves.toBe("ok");
  });

  it("counts a slot from when a task starts, not when it finishes", async () => {
    // The service counts requests as they arrive, so a slow task must not hold
    // its slot for its whole duration.
    const clock = fakeClock();
    const schedule = createRateLimiter({ maxRequests: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await Promise.all([
      schedule(async () => {
        clock.advance(5000); // a very slow request
      }),
      schedule(async () => "fast"),
    ]);
    expect(clock.time).toBe(5000); // no extra wait was inserted
  });

  it("refuses a limit that would never admit anything", () => {
    expect(() => createRateLimiter({ maxRequests: 0, windowMs: 1000 })).toThrow(/at least 1/);
  });
});
