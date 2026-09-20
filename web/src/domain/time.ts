/** Duration formatting. Ported from app.js:820-833. */

/** Rounds to whole minutes and splits into [hours, minutes]. */
export function formatTime(minutes: number): [number, number] {
  const total = Math.round(minutes);
  return [Math.floor(total / 60), total % 60];
}

/** "45m" under an hour, "1h 02m" (zero-padded) above it. */
export function formatEpisodeRuntime(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  const [h, m] = formatTime(total);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** "3h 23m" - the carousel's "time left" line. */
export function formatDuration(minutes: number): string {
  const [h, m] = formatTime(minutes);
  return `${h}h ${m}m`;
}
