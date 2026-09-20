/**
 * Air-date handling. Ported from app.js:1356-1402.
 *
 * The one rule that matters: a bare `YYYY-MM-DD` has no time-of-day, so a
 * relative "Today"/"Tomorrow" label computed from it is a guess that drifts
 * across timezones. Only a full ISO datetime (TVmaze `airstamp`) earns one.
 */

/** "YYYY-MM-DD" is exactly 10 chars; a full ISO datetime with offset is longer. */
export function hasTimeComponent(dateStr: string | null | undefined): dateStr is string {
  return typeof dateStr === "string" && dateStr.length > 10;
}

export function airDateToTimestamp(dateStr: string): number {
  const d = hasTimeComponent(dateStr) ? new Date(dateStr) : new Date(`${dateStr}T00:00:00`);
  return d.getTime();
}

/** Same as `airDateToTimestamp` but tolerates junk, returning null instead of NaN. */
export function safeAirDateToTimestamp(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const ts = airDateToTimestamp(dateStr);
  return Number.isNaN(ts) ? null : ts;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function absoluteDayLabel(target: Date, now: Date): string {
  const sameYear = target.getFullYear() === now.getFullYear();
  return target.toLocaleDateString(
    undefined,
    sameYear
      ? { weekday: "long", month: "short", day: "numeric" }
      : { weekday: "long", month: "short", day: "numeric", year: "numeric" },
  );
}

/**
 * `now` is injectable so tests don't depend on the wall clock.
 */
export function formatAirDate(dateStr: string, now: Date = new Date()): string {
  const withTime = hasTimeComponent(dateStr);
  const target = withTime ? new Date(dateStr) : new Date(`${dateStr}T00:00:00`);

  if (!withTime) {
    // Bare date only. Deliberately no "Today"/"Tomorrow" here - that guess is
    // exactly what used to disagree with the real broadcast calendar.
    return absoluteDayLabel(target, now);
  }

  const diffDays = Math.round(
    (startOfDay(target).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  const timeStr = target.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  let dayLabel: string;
  if (diffDays === 0) dayLabel = "Today";
  else if (diffDays === 1) dayLabel = "Tomorrow";
  else if (diffDays > 1 && diffDays < 7) {
    dayLabel = target.toLocaleDateString(undefined, { weekday: "long" });
  } else {
    dayLabel = absoluteDayLabel(target, now);
  }

  return `${dayLabel}, ${timeStr}`;
}

/**
 * Today as `YYYY-MM-DD` on the browser's LOCAL calendar - not
 * `toISOString()`, which yields the UTC date and reads as "yesterday" for
 * the first hours after local midnight east of UTC (Israel included).
 */
export function todayLocalDateStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
