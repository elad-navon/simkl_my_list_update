import { describe, expect, it } from "vitest";
import { formatDuration, formatEpisodeRuntime, formatTime } from "./time";

describe("formatTime", () => {
  it("splits minutes into hours and minutes", () => {
    expect(formatTime(203)).toEqual([3, 23]);
  });

  it("rounds fractional minutes first", () => {
    expect(formatTime(59.6)).toEqual([1, 0]);
  });
});

describe("formatEpisodeRuntime", () => {
  it("stays in plain minutes under an hour", () => {
    expect(formatEpisodeRuntime(45)).toBe("45m");
  });

  it("zero-pads the minutes above an hour", () => {
    expect(formatEpisodeRuntime(62)).toBe("1h 02m");
  });

  it("handles exactly one hour", () => {
    expect(formatEpisodeRuntime(60)).toBe("1h 00m");
  });
});

describe("formatDuration", () => {
  it("renders the carousel's time-left style", () => {
    expect(formatDuration(203)).toBe("3h 23m");
  });

  it("does not pad, matching the old output", () => {
    expect(formatDuration(65)).toBe("1h 5m");
  });
});
