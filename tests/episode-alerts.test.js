const test = require("node:test");
const assert = require("node:assert/strict");
const alerts = require("../native/episode-alerts-core.js");

const DAY = 86400000;
// Noon local time, so local dates around it are unambiguous in any timezone.
const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime();
const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const day = n => localDate(NOW + n * DAY);
const localIso = (n, h, m = 0) => { const d = new Date(NOW + n * DAY); d.setHours(h, m, 0, 0); return d.toISOString(); };
const nineOn = n => { const d = new Date(NOW + n * DAY); d.setHours(9, 0, 0, 0); return d.getTime(); };

const row = over => ({ title: "Slow Horses", tmdbId: 95480, nextLabel: "S05E01", nextSeason: 5, badge: "SEASON PREMIERE", airDate: day(2), network: "Apple TV+", ...over });

test("only premieres and finales get an alert", () => {
  const rows = [
    row({ tmdbId: 1, badge: "SERIES PREMIERE", nextLabel: "S01E01", nextSeason: 1 }),
    row({ tmdbId: 2 }),
    row({ tmdbId: 3, badge: "SEASON FINALE", nextLabel: "S05E06" }),
    row({ tmdbId: 4, badge: null, nextLabel: "S05E03" }),
  ];
  const { schedule, cancel } = alerts.planAlerts({ rows, now: NOW });
  assert.deepEqual(schedule.map(n => n.extra.show + n.extra.episode), ["Slow HorsesS01E01", "Slow HorsesS05E01", "Slow HorsesS05E06"]);
  assert.deepEqual(cancel, []);
});

test("the alert goes off at 9:00 local on the day the episode comes out", () => {
  assert.equal(alerts.alertAt(day(2)), nineOn(2));
  assert.equal(alerts.alertAt(localIso(3, 21, 30)), nineOn(3));
  assert.equal(alerts.alertAt(localIso(3, 4)), nineOn(3));
  assert.equal(alerts.alertAt("garbage"), null);
  assert.equal(alerts.alertAt(null), null);
});

test("the text names the kind, the time when known, the episode and the network", () => {
  assert.deepEqual(alerts.alertText(row()), { title: "Slow Horses", body: "Season 5 premiere today · S05E01 · Apple TV+" });
  assert.equal(alerts.alertText(row({ airDate: localIso(2, 21, 5) })).body, "Season 5 premiere today at 21:05 · S05E01 · Apple TV+");
  assert.equal(alerts.alertText(row({ airDate: localIso(2, 4) })).body, "Season 5 premiere is out · S05E01 · Apple TV+");
  assert.equal(alerts.alertText(row({ badge: "SEASON FINALE", nextLabel: "S05E06", network: null })).body, "Season 5 finale today · S05E06");
  assert.equal(alerts.alertText(row({ badge: "SERIES PREMIERE", nextLabel: "S01E01", nextSeason: 1 })).body, "Series premiere today · S01E01 · Apple TV+");
});

test("a morning already gone, or one more than 30 days away, gets nothing", () => {
  const rows = [row({ tmdbId: 1, airDate: day(0) }), row({ tmdbId: 2, airDate: day(31) }), row({ tmdbId: 3, airDate: day(29) })];
  assert.deepEqual(alerts.planAlerts({ rows, now: NOW }).schedule.map(n => n.extra.at), [nineOn(29)]);
});

test("ids are stable per show and episode, and never 1 (the test notification)", () => {
  assert.equal(alerts.alertId(row()), alerts.alertId(row({ airDate: day(5) })));
  assert.notEqual(alerts.alertId(row()), alerts.alertId(row({ nextLabel: "S05E06" })));
  assert.notEqual(alerts.alertId(row()), alerts.alertId(row({ tmdbId: 7 })));
  for (let i = 0; i < 500; i++) {
    const id = alerts.alertId(row({ tmdbId: i }));
    assert.ok(Number.isInteger(id) && id > 1 && id <= 0x7fffffff);
  }
});

test("a second run changes nothing; a moved or gone episode is cancelled and rescheduled", () => {
  const first = alerts.planAlerts({ rows: [row(), row({ tmdbId: 9, badge: "SEASON FINALE" })], now: NOW });
  const pending = [
    ...first.schedule.map(n => ({ id: n.id, title: n.title, body: n.body, extra: n.extra })),
    { id: 1, title: "test", body: "", extra: { kind: "test" } },
  ];
  assert.deepEqual(alerts.planAlerts({ rows: [row(), row({ tmdbId: 9, badge: "SEASON FINALE" })], pending, now: NOW }), { schedule: [], cancel: [] });

  // The premiere moved a day; the finale's show left the list.
  const next = alerts.planAlerts({ rows: [row({ airDate: day(3) })], pending, now: NOW });
  assert.deepEqual(next.cancel.sort(), first.schedule.map(n => n.id).sort());
  assert.deepEqual(next.schedule.map(n => n.extra.at), [nineOn(3)]);
});

test("notifications are inexact, allowed while idle, on the alerts channel", () => {
  const [n] = alerts.planAlerts({ rows: [row()], now: NOW }).schedule;
  assert.equal(n.channelId, alerts.CHANNEL);
  assert.equal(n.isExactNotification, false);
  assert.equal(n.schedule.allowWhileIdle, true);
  assert.equal(n.schedule.at.getTime(), nineOn(2));
});
