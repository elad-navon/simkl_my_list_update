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

test("airCountdown: NOW, minutes, hours up to 48, then calendar days; date-only: days alone", () => {
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
  assert.deepEqual(c(5 * HOUR + 20 * MIN), { n: 5, unit: "HOURS" });
  assert.deepEqual(c(31 * HOUR), { n: 31, unit: "HOURS" });
  assert.deepEqual(c(47 * HOUR + 59 * MIN), { n: 47, unit: "HOURS" });
  const local = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const calendarDays = ms => Math.round((local(ms) - local(NOW)) / 86400000);
  assert.deepEqual(c(49 * HOUR), { n: calendarDays(NOW + 49 * HOUR), unit: "DAYS" }, "past 48 hours: calendar days");
  assert.deepEqual(c(17 * 24 * HOUR), { n: 17, unit: "DAYS" });

  const day = offsetDays => { const d = new Date(NOW + offsetDays * 24 * HOUR); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayOnly = offsetDays => { const r = app.airCountdown(null, null, NOW, day(offsetDays)); return r && { ...r }; };
  assert.deepEqual(dayOnly(0), { n: "TODAY", unit: "", dateOnly: true });
  assert.deepEqual(dayOnly(1), { n: 1, unit: "DAY", dateOnly: true });
  assert.deepEqual(dayOnly(2), { n: 2, unit: "DAYS", dateOnly: true });
  assert.equal(dayOnly(-1), null, "yesterday: aired");
  assert.equal(app.airCountdown(null, null, NOW, null), null, "no date at all: no chip");
});
