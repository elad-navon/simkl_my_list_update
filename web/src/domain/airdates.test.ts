import { describe, expect, it } from "vitest";
import {
  airDateToTimestamp,
  formatAirDate,
  hasTimeComponent,
  safeAirDateToTimestamp,
  todayLocalDateStr,
} from "./airdates";

describe("hasTimeComponent", () => {
  it("rejects a bare YYYY-MM-DD", () => {
    expect(hasTimeComponent("2026-09-20")).toBe(false);
  });

  it("accepts a full ISO datetime with an offset", () => {
    expect(hasTimeComponent("2026-09-20T21:00:00+03:00")).toBe(true);
  });

  it("rejects null and undefined", () => {
    expect(hasTimeComponent(null)).toBe(false);
    expect(hasTimeComponent(undefined)).toBe(false);
  });
});

describe("airDateToTimestamp", () => {
  it("anchors a bare date to local midnight, not UTC midnight", () => {
    const ts = airDateToTimestamp("2026-09-20");
    const d = new Date(ts);
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(20);
  });

  it("honours an explicit offset", () => {
    expect(airDateToTimestamp("2026-09-20T21:00:00+03:00")).toBe(
      Date.parse("2026-09-20T18:00:00Z"),
    );
  });
});

describe("safeAirDateToTimestamp", () => {
  it("returns null rather than NaN for junk", () => {
    expect(safeAirDateToTimestamp("nonsense")).toBeNull();
    expect(safeAirDateToTimestamp(null)).toBeNull();
    expect(safeAirDateToTimestamp("")).toBeNull();
  });
});

describe("formatAirDate", () => {
  const now = new Date("2026-09-20T12:00:00");

  it("says Today for a timed episode later the same day", () => {
    expect(formatAirDate("2026-09-20T21:00:00", now)).toMatch(/^Today, /);
  });

  it("says Tomorrow for a timed episode the next day", () => {
    expect(formatAirDate("2026-09-21T21:00:00", now)).toMatch(/^Tomorrow, /);
  });

  it("uses a weekday name inside the coming week", () => {
    expect(formatAirDate("2026-09-23T21:00:00", now)).toMatch(/^Wednesday, /);
  });

  it("falls back to an absolute date beyond a week", () => {
    const out = formatAirDate("2026-10-15T21:00:00", now);
    expect(out).toContain("Oct");
    expect(out).not.toMatch(/^(Today|Tomorrow)/);
  });

  it("includes the year only when it differs from the current one", () => {
    expect(formatAirDate("2027-10-15T21:00:00", now)).toContain("2027");
    expect(formatAirDate("2026-10-15T21:00:00", now)).not.toContain("2026");
  });

  it("never claims Today/Tomorrow for a bare date, however close", () => {
    expect(formatAirDate("2026-09-20", now)).not.toMatch(/Today|Tomorrow/);
    expect(formatAirDate("2026-09-21", now)).not.toMatch(/Today|Tomorrow/);
  });

  it("omits the time entirely for a bare date", () => {
    expect(formatAirDate("2026-09-21", now)).not.toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("todayLocalDateStr", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // 00:30 local on the 20th is still the 19th in UTC east of Greenwich.
    expect(todayLocalDateStr(new Date(2026, 8, 20, 0, 30))).toBe("2026-09-20");
  });

  it("zero-pads month and day", () => {
    expect(todayLocalDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
