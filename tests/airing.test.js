const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAppFunctions } = require("./app-helpers.js");

const app = loadAppFunctions(["episodeAirWindow", "airCountdown"]);
const MIN = 60000, HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-12T19:00:00Z");

test("episodeAirWindow: exact times only; length from the episode, the show, else 30 minutes", () => {
  const start = "2026-10-12T19:00:00+00:00";
  assert.deepEqual({ ...app.episodeAirWindow({ date: start, runtime: 45 }, 60) }, { start: NOW, end: NOW + 45 * MIN });
  assert.equal(app.episodeAirWindow({ date: start }, 60).end, NOW + 60 * MIN, "the show's average");
  assert.equal(app.episodeAirWindow({ date: start }, null).end, NOW + 30 * MIN, "default");
  assert.equal(app.episodeAirWindow({ date: "2026-10-12" }, 60), null, "date only: time unknown");
  assert.equal(app.episodeAirWindow({ date: null }, 60), null);
});

test("airCountdown: NOW while on the air, minutes under an hour, whole hours, nothing past 24 hours", () => {
  const c = (startOffset, endOffset) => {
    const r = app.airCountdown(NOW + startOffset, endOffset == null ? null : NOW + endOffset, NOW);
    return r && { ...r };
  };
  assert.deepEqual(c(-20 * MIN, 25 * MIN), { live: true });
  assert.equal(c(-50 * MIN, -5 * MIN), null, "already over");
  assert.equal(c(-5 * MIN, null), null, "started, end unknown");
  assert.deepEqual(c(12 * MIN), { n: 12, unit: "MIN" });
  assert.deepEqual(c(30 * 1000), { n: 1, unit: "MIN" }, "under a minute rounds up");
  assert.deepEqual(c(59 * MIN + 30 * 1000), { n: 1, unit: "HOUR" });
  assert.deepEqual(c(HOUR + 40 * MIN), { n: 1, unit: "HOUR" });
  assert.deepEqual(c(5 * HOUR + 20 * MIN), { n: 5, unit: "HOURS" });
  assert.deepEqual(c(23 * HOUR + 59 * MIN), { n: 23, unit: "HOURS" });
  assert.equal(c(25 * HOUR), null, "outside the 24-hour window: the date as before");
  assert.equal(app.airCountdown(null, null, NOW), null, "date-only episode: no time, no counter");
});
