// Air times from yes's TV guide for Israeli shows: the episode lists know
// only the date of most Israeli episodes, and SIMKL rarely has their hour.
// yes's broadcast schedule (the one its own site and Prime Time read) lists
// what each channel airs on a day, in Israel time. For a show from Israel
// with a date-only episode coming up soon, the schedules of Kan 11, Keshet 12
// and Reshet 13 for that day are read, and the episode takes the start time
// of the show's broadcast there:
//   - the broadcast's title must hold the show's name (English or Hebrew,
//     "Israel"/"ישראל" left out): "The Voice All Stars - פרק 9" is The Voice
//     Israel's;
//   - Israeli shows air again and again (the same day, late at night, the
//     next afternoon), so: a broadcast marked as a rerun ("שידור חוזר",
//     "ש.ח") never counts; a broadcast whose "פרק N" is the episode's number
//     wins, the earliest that day; without a number, the day's broadcast is
//     taken only when there is exactly one, in the evening (18:00-23:59) -
//     anything less sure leaves the episode as it was.
// For an Israeli show yes is the surest source of the hour, so an episode
// that already has a time (TVMaze's, SIMKL's) takes yes's instead when yes
// has a broadcast for it that day; SIMKL only fills in what yes left.
// Nothing else changes. Runs in the browser (window.YesTimes) and in Node for
// tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YesTimes = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAY_MS = 86400000;
  const API = "https://svc.yes.co.il/api/content/broadcast-schedule/channels/";
  // Kan 11, Keshet 12, Reshet 13 - yes's ids, as in Prime Time.
  const CHANNELS = ["CH30", "CH34", "CH36"];
  const TZ = "Asia/Jerusalem";
  // Which date-only episodes are looked up: from yesterday to 3 days ahead
  // (yes's guide goes about a week ahead).
  const WINDOW_BEFORE_DAYS = 1;
  const WINDOW_AFTER_DAYS = 3;
  // A day's schedule is read again after this long...
  const FRESH_MS = 3 * 3600 * 1000;
  // ...and kept this long, so an episode keeps its time after it airs.
  const KEEP_MS = 30 * DAY_MS;
  const TIMEOUT_MS = 8000;

  const isDateOnly = ep => !!ep.date && ep.date.length === 10 && !ep.hasTime;

  // The day an episode airs in Israel: its date, or the Israel day of its
  // time; null when unreadable.
  function episodeDay(ep) {
    if (!ep || !ep.date) return null;
    if (isDateOnly(ep)) return ep.date;
    const ts = Date.parse(ep.date);
    return isNaN(ts) ? null : israelDate(ts);
  }

  // "2026-11-01" for a moment, in Israel.
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  function israelDate(ms) {
    return dayFmt.format(new Date(ms));
  }

  // Lower case, punctuation as spaces, single spaces.
  function normalize(s) {
    return String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  // The names a broadcast may carry for a show: each name normalized, with
  // "Israel" and a trailing year left out; too short to tell apart: none.
  function nameKeys(names) {
    const keys = new Set();
    for (const name of names || []) {
      const key = normalize(name).replace(/\b(israel)\b|(^| )ישראל( |$)/g, " ").replace(/ (19|20)\d\d$/, "").replace(/\s+/g, " ").trim();
      if (key.length >= 3) keys.add(key);
    }
    return [...keys];
  }

  // A broadcast's title without its episode and season parts.
  function titleBase(title) {
    return normalize(String(title || "").replace(/(פרק|עונה)\s*\d+/g, " "));
  }

  // The "פרק N" in a broadcast's title or description, else null.
  function episodeNumber(item) {
    const m = /פרק\s*(\d+)/.exec(item.title || "") || /פרק\s*(\d+)/.exec(item.description || "");
    return m ? Number(m[1]) : null;
  }

  // Whether a broadcast says it's a rerun.
  const RERUN_RX = /שידור חוזר|ש\.ח\.?|\(ח\)/;
  function isRerun(item) {
    return RERUN_RX.test(item.title || "") || RERUN_RX.test(item.description || "");
  }

  // The hour a broadcast starts, in Israel.
  const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });
  const EVENING_FROM_HOUR = 18;

  // Whether a broadcast's title holds one of the show's names, word for word.
  function matchesShow(item, keys) {
    const base = ` ${titleBase(item.title)} `;
    return keys.some(key => base.includes(` ${key} `));
  }

  // The episodes, each with its broadcast's start time where the rules above
  // find one (replacing a time it had). `schedules`: { "2026-11-01": [items] }.
  function applyYesTimes(episodes, schedules, names) {
    const keys = nameKeys(names);
    if (!keys.length || !schedules) return episodes;
    let changed = 0;
    const out = episodes.map(ep => {
      const day = episodeDay(ep);
      if (!day || !schedules[day]) return ep;
      const mine = schedules[day]
        .filter(item => matchesShow(item, keys) && !isRerun(item) && israelDate(Date.parse(item.starts)) === day)
        .sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts));
      const numbered = mine.filter(item => episodeNumber(item) === ep.episode);
      const evening = item => Number(hourFmt.format(new Date(Date.parse(item.starts)))) >= EVENING_FROM_HOUR;
      const pick = numbered.length ? numbered[0]
        : mine.length === 1 && episodeNumber(mine[0]) == null && evening(mine[0]) ? mine[0] : null;
      const ts = pick ? Date.parse(pick.starts) : NaN;
      if (isNaN(ts)) return ep;
      const iso = new Date(ts).toISOString();
      if (ep.hasTime && ep.timeFrom === "yes" && ep.date === iso) return ep;
      changed++;
      return { ...ep, date: iso, hasTime: true, timeFrom: "yes" };
    });
    return changed ? out : episodes;
  }

  // createYesAirTimes({ fetch, cache, showInfo, now })
  // - fetch: the browser's fetch
  // - cache: { get(key, ttlMs), set(key, value) }, either may be async
  // - showInfo(ids): { israeli, names } for a show (may be async), or null
  // Returns enrich(ids, episodes) -> Promise<episodes>; it never throws and
  // never holds the list up for more than a few seconds.
  function createYesAirTimes({ fetch, cache, showInfo, now = () => Date.now(), timeoutMs = TIMEOUT_MS }) {
    const inFlight = new Map();

    // One channel's schedule for a day, as [{ title, description, starts }];
    // null if yes couldn't answer (not cached - the next load asks again).
    async function channelDay(channel, date) {
      const key = `yes-schedule:${channel}:${date}`;
      const fresh = await cache.get(key, FRESH_MS);
      if (fresh !== undefined) return fresh;
      if (!inFlight.has(key)) {
        inFlight.set(key, (async () => {
          const [y, m, d] = date.split("-").map(Number);
          const res = await fetch(`${API}${channel}?date=${y}-${m}-${d}&ignorePastItems=false`, { headers: { "accept-language": "he-IL" } });
          if (!res.ok) throw new Error(`yes ${channel}: HTTP ${res.status}`);
          const body = await res.json();
          const items = ((body && body.items) || [])
            .filter(it => it && it.title && it.starts)
            .map(it => ({ title: it.title, description: it.description || "", starts: it.starts }));
          await cache.set(key, items);
          return items;
        })().finally(() => inFlight.delete(key)));
      }
      try {
        return await inFlight.get(key);
      } catch (e) {
        const kept = await cache.get(key, KEEP_MS);
        return kept === undefined ? null : kept;
      }
    }

    // Every channel's schedule for a day, one list.
    async function daySchedule(date) {
      const lists = await Promise.all(CHANNELS.map(ch => channelDay(ch, date).catch(() => null)));
      return lists.flatMap(list => list || []);
    }

    return async function enrich(ids, episodes) {
      if (!episodes || !episodes.length) return episodes;
      const t = now();
      const from = israelDate(t - WINDOW_BEFORE_DAYS * DAY_MS);
      const to = israelDate(t + WINDOW_AFTER_DAYS * DAY_MS);
      const dates = [...new Set(episodes.map(episodeDay).filter(day => day && day >= from && day <= to))];
      if (!dates.length) return episodes;
      const work = (async () => {
        const info = await showInfo(ids);
        if (!info || !info.israeli) return episodes;
        const schedules = {};
        for (const date of dates) schedules[date] = await daySchedule(date);
        return applyYesTimes(episodes, schedules, info.names);
      })();
      let timer;
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(episodes), timeoutMs); });
      try {
        return await Promise.race([work.catch(() => episodes), timeout]);
      } finally {
        clearTimeout(timer);
      }
    };
  }

  return { createYesAirTimes, applyYesTimes, nameKeys, episodeNumber, israelDate };
});
