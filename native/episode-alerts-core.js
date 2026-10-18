// Episode alerts on the phone - the pure part. Only three kinds of episode
// get one, each in the morning of the day it comes out:
//   - a series premiere (S01E01 of a show in the list - a Plan to Watch show
//     moving up to Ready to Watch);
//   - a season premiere;
//   - a season finale.
// The rows are the Airing Next rows (getAiringNextRows in app.js), which
// already carry that badge. No DOM, no plugin and no clock of its own, so it
// runs in Node for tests; inside the Android app, native/episode-alerts.js
// hands it the rows and the plugin's pending notifications.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EpisodeAlerts = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KIND = "episode-alert";
  const CHANNEL = "episode-alerts";
  const HOUR = 9;
  const HORIZON_DAYS = 30;
  const DAY_MS = 86400000;

  const LABELS = {
    "SERIES PREMIERE": () => "Series premiere",
    "SEASON PREMIERE": season => (season != null ? `Season ${season} premiere` : "Season premiere"),
    "SEASON FINALE": season => (season != null ? `Season ${season} finale` : "Season finale"),
  };

  const pad = n => String(n).padStart(2, "0");

  // "YYYY-MM-DD" (a date only) or a full ISO moment, as on Airing Next rows.
  function hasTime(airDate) {
    return typeof airDate === "string" && airDate.length > 10;
  }

  // The local day the episode comes out, as [year, month, day].
  function localDay(airDate) {
    if (typeof airDate !== "string" || airDate.length < 10) return null;
    if (hasTime(airDate)) {
      const d = new Date(airDate);
      if (isNaN(d)) return null;
      return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(airDate);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  // When the alert goes off: `hour` o'clock, local time, on that day.
  function alertAt(airDate, hour = HOUR) {
    const day = localDay(airDate);
    return day ? new Date(day[0], day[1] - 1, day[2], hour, 0, 0).getTime() : null;
  }

  // One id per show and episode, the same on every run (FNV-1a, 31 bits).
  // 1 stays free for a test notification.
  function alertId(row) {
    const key = `${row.tmdbId || row.imdbId || row.title}|${row.nextLabel || ""}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    const id = h & 0x7fffffff;
    return id > 1 ? id : id + 2;
  }

  function alertText(row, hour = HOUR) {
    const label = LABELS[row.badge](row.nextSeason);
    let when = " today";
    if (hasTime(row.airDate)) {
      const d = new Date(row.airDate);
      when = d.getHours() < hour ? " is out" : ` today at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    const parts = [`${label}${when}`];
    if (row.nextLabel) parts.push(row.nextLabel);
    if (row.network) parts.push(row.network);
    return { title: row.title || "My Watch List", body: parts.join(" · ") };
  }

  // The notification for one row, or null when it gets none: no premiere or
  // finale badge, no date, the morning already gone, or more than
  // `horizonDays` away (the next run schedules it).
  function alertFor(row, { now, hour = HOUR, horizonDays = HORIZON_DAYS }) {
    if (!row || !LABELS[row.badge]) return null;
    const at = alertAt(row.airDate, hour);
    if (at == null || at <= now || at > now + horizonDays * DAY_MS) return null;
    const { title, body } = alertText(row, hour);
    return {
      id: alertId(row),
      title,
      body,
      channelId: CHANNEL,
      schedule: { at: new Date(at), allowWhileIdle: true },
      isExactNotification: false,
      extra: { kind: KIND, at, show: row.title, episode: row.nextLabel || null },
    };
  }

  // What to change so the scheduled alerts match the rows: schedule what's
  // missing or different, cancel what no row asks for any more (watched,
  // moved, dropped from the list). `pending` is the plugin's getPending()
  // list; notifications of other kinds are left alone.
  function planAlerts({ rows, pending = [], now, hour = HOUR, horizonDays = HORIZON_DAYS }) {
    const wanted = new Map();
    for (const row of rows || []) {
      const n = alertFor(row, { now, hour, horizonDays });
      if (n && !wanted.has(n.id)) wanted.set(n.id, n);
    }
    const ours = (pending || []).filter(p => p && p.extra && p.extra.kind === KIND);
    const same = (p, n) => p.extra.at === n.extra.at && p.title === n.title && p.body === n.body;
    const cancel = [];
    const kept = new Set();
    for (const p of ours) {
      const n = wanted.get(p.id);
      if (n && same(p, n)) kept.add(p.id);
      else cancel.push(p.id);
    }
    const schedule = [...wanted.values()].filter(n => !kept.has(n.id));
    return { schedule, cancel };
  }

  return { KIND, CHANNEL, HOUR, HORIZON_DAYS, localDay, alertAt, alertId, alertText, alertFor, planAlerts };
});
