// My Stats: a window of five tabs (Summary, Time, Shows, Taste, Queue) on
// everything watched - computed here from the library (every watched record
// carries its time) and one light TMDB lookup per show (runtime, genres,
// countries, networks, release year, poster), kept for 30 days. Three
// layers: the data (statsGather), metrics as plain objects (stats*Metrics),
// and the tabs that lay them out. Uses app.js's globals: library, tmdbGet,
// readPersistedCache / writePersistedCache, the modal history helpers.

const STATS_INFO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STATS_DEFAULT_RUNTIME = 45; // a show TMDB has no runtime for
const STATS_BINGE_EPS = 4;        // a binge day: 4+ episodes of one show
const STATS_MARATHON_MIN = 6 * 60;
const STATS_DAY_MS = 24 * 60 * 60 * 1000;
const STATS_IMG = "https://image.tmdb.org/t/p/";
const STATS_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATS_WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const STATS_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Genres: seven fixed hues in order, then "Other" (never a generated 9th hue).
const STATS_GENRE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9", "#e66767"];
const STATS_OTHER_COLOR = "#5b6878";

// ---------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------
// The few TMDB facts the page needs, from /tv/{id} without the images
// (small), trimmed and kept 30 days. A show TMDB doesn't know is kept as {}.
async function statsShowInfo(tmdbId) {
  const key = `showinfo:${tmdbId}`;
  const cached = await readPersistedCache(key, STATS_INFO_TTL_MS);
  if (cached !== undefined && cached !== null) return cached;
  let d;
  try {
    d = await tmdbGet(`/tv/${tmdbId}`, { language: "en-US" });
  } catch (e) {
    return null; // not kept - asked again next time
  }
  const runtimes = ((d && d.episode_run_time) || []).filter(x => x > 0);
  const info = d ? {
    r: runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length)
      : ((d.last_episode_to_air || {}).runtime || (d.next_episode_to_air || {}).runtime || null),
    g: (d.genres || []).map(x => x.name),
    c: d.origin_country || [],
    n: (d.networks || []).map(x => ({ id: x.id, name: x.name, logo: x.logo_path || null })),
    y: d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null,
    p: d.poster_path || null,
    b: d.backdrop_path || null,
  } : {};
  writePersistedCache(key, info);
  return info;
}

// Runs fn over items, `limit` at a time, reporting progress.
async function statsPool(items, limit, fn, onProgress) {
  let next = 0, done = 0;
  const out = new Array(items.length);
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => null);
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function statsDayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function statsDayStart(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function statsKeyToTime(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

// Everything the sections read, from the library and the shows' TMDB facts.
async function statsGather(onProgress) {
  const entries = [...library.store.view()];
  const withTmdb = entries.filter(([, s]) => s.ids && s.ids.tmdb != null);
  const infos = await statsPool(withTmdb, 8, ([, s]) => statsShowInfo(s.ids.tmdb), onProgress);
  const infoByDoc = new Map(withTmdb.map(([docId], i) => [docId, infos[i] || {}]));

  // Episodes still to watch (Watching, Plan to Watch, On Hold) - the
  // episode lists Watching and Plan to Watch already loaded for the panels.
  const remainingByKey = new Map();
  for (const status of ["watching", "plantowatch", "hold"]) {
    const items = await library.adapter.items(status).catch(() => []);
    for (const it of items) {
      const left = Math.max(0, (it.total_episodes_count || 0) - (it.watched_episodes_count || 0) - (it.not_aired_episodes_count || 0));
      const ids = (it.show && it.show.ids) || {};
      remainingByKey.set(ids.tmdb != null ? `t${ids.tmdb}` : `n${it.show.title}`, { left, total: it.total_episodes_count || 0 });
    }
  }

  const shows = [];
  const records = [];
  for (const [docId, s] of entries) {
    const info = infoByDoc.get(docId) || {};
    const runtime = info.r > 0 ? info.r : STATS_DEFAULT_RUNTIME;
    const rem = remainingByKey.get(s.ids && s.ids.tmdb != null ? `t${s.ids.tmdb}` : `n${s.title}`) || null;
    const sh = {
      docId, title: s.title, status: s.status, year: info.y || s.year || null, runtime, runtimeKnown: info.r > 0,
      genres: info.g || [], countries: info.c || [], network: (info.n || [])[0] || null,
      poster: info.p ? `${STATS_IMG}w185${info.p}` : null,
      backdrop: info.b ? `${STATS_IMG}w1280${info.b}` : null,
      eps: 0, min: 0, remaining: rem ? rem.left : 0, totalEps: rem ? rem.total : 0, lastAt: 0,
    };
    for (const rec of Object.values(s.watched || {})) {
      const t = rec.at ? Date.parse(rec.at) : NaN;
      sh.eps++;
      sh.min += runtime;
      if (!isNaN(t)) {
        records.push({ sh, t, s: rec.s, e: rec.e, min: runtime, day: statsDayKey(t) });
        if (t > sh.lastAt) sh.lastAt = t;
      }
    }
    shows.push(sh);
  }
  records.sort((a, b) => a.t - b.t);
  // Per day: minutes (shown at most 24h - a season marked at once can add
  // up to more), episodes, and per show.
  const days = new Map();
  for (const r of records) {
    let d = days.get(r.day);
    if (!d) days.set(r.day, d = { min: 0, shown: 0, eps: 0, shows: new Map() });
    d.min += r.min;
    d.eps++;
    d.shown = Math.min(d.min, 24 * 60);
    let x = d.shows.get(r.sh);
    if (!x) d.shows.set(r.sh, x = { eps: 0, min: 0 });
    x.eps++;
    x.min += r.min;
  }
  return { shows, records, days, now: Date.now() };
}

// ---------------------------------------------------------------------
// Numbers and words
// ---------------------------------------------------------------------
const statsNum = n => Math.round(n).toLocaleString("en-US");
function statsHM(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${statsNum(h)}h ${m}m` : `${m}m`;
}
// "9d 7h" from a day up, else "23h 50m".
function statsDur(min) {
  if (min < 24 * 60) return statsHM(min);
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
}
const statsDays = min => `${statsNum(min / 1440)}d`;
const statsPct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const statsEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function statsDateShort(t) {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
let statsRegionNames = null;
function statsCountryName(code) {
  try {
    statsRegionNames = statsRegionNames || new Intl.DisplayNames(["en"], { type: "region" });
    return statsRegionNames.of(code);
  } catch (e) {
    return code;
  }
}

// Records in [from, to).
const statsBetween = (data, from, to) => data.records.filter(r => r.t >= from && r.t < to);

// Longest run of consecutive active days among `keys` (sorted day keys).
function statsLongestRun(keys) {
  let best = { len: 0, from: null, to: null }, cur = 0, start = null, prev = null;
  for (const k of keys) {
    const t = statsKeyToTime(k);
    if (prev != null && Math.round((t - prev) / STATS_DAY_MS) === 1) cur++;
    else { cur = 1; start = t; }
    if (cur > best.len) best = { len: cur, from: start, to: t };
    prev = t;
  }
  return best;
}

// ---------------------------------------------------------------------
// Metrics: plain objects, no HTML - the tabs below only lay them out.
// ---------------------------------------------------------------------
const STATS_STATUSES = [
  ["completed", "Completed"], ["watching", "Watching"], ["plantowatch", "Plan to watch"], ["hold", "On hold"], ["dropped", "Dropped"],
];
const STATS_QUEUE_STATUSES = ["watching", "plantowatch", "hold"];
const statsOf = (data, st) => data.shows.filter(s => s.status === st);
const statsEpsOf = list => list.reduce((a, s) => a + s.eps, 0);
const statsSum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const statsYearAgo = data => data.now - 365 * STATS_DAY_MS;

function statsSummaryMetrics(data) {
  const { shows, records, days, now } = data;
  const tracked = shows.length;
  const completed = statsOf(data, "completed").length;
  const totalMin = statsSum(shows, s => s.min);
  const totalEps = statsSum(shows, s => s.eps);
  const finished = statsEpsOf(statsOf(data, "completed"));
  const inProgress = statsEpsOf(statsOf(data, "watching"));
  const years = new Map();
  for (const r of records) { const y = new Date(r.t).getFullYear(); years.set(y, (years.get(y) || 0) + r.min); }
  const thisYear = new Date(now).getFullYear();
  const peak = [...years].sort((a, b) => b[1] - a[1])[0] || null;
  const yearAgo = statsYearAgo(data);
  const wd = new Array(7).fill(0);
  for (const r of records) if (r.t >= yearAgo) wd[new Date(r.t).getDay()] += r.min;
  const topWd = wd.some(v => v > 0) ? wd.indexOf(Math.max(...wd)) : null;
  const activeKeys = [...days.keys()].filter(k => statsKeyToTime(k) >= statsDayStart(yearAgo)).sort();
  const last30 = statsBetween(data, now - 30 * STATS_DAY_MS, now + 1);
  const jan1 = new Date(thisYear, 0, 1).getTime();
  const sinceJan1 = records.filter(r => r.t >= jan1);
  const backlog = shows.filter(s => STATS_QUEUE_STATUSES.includes(s.status) && s.remaining > 0);
  return {
    tracked, completed, completionOfTracked: statsPct(completed, tracked),
    totalMin, totalEps, finished, inProgress, otherEps: totalEps - finished - inProgress,
    years, thisYear, peakYear: peak ? peak[0] : null, peakYearMin: peak ? peak[1] : 0, thisYearMin: years.get(thisYear) || 0,
    epsThisYear: sinceJan1.length,
    topWeekday: topWd, topWeekdayAvg: topWd == null ? 0 : wd[topWd] / 52,
    longestStreak: statsLongestRun(activeKeys),
    last30Min: statsSum(last30, r => r.min), last30Days: new Set(last30.map(r => r.day)).size,
    daysThisYear: new Set(sinceJan1.map(r => r.day)).size,
    dayOfYear: Math.floor((statsDayStart(now) - jan1) / STATS_DAY_MS) + 1,
    backlogMin: statsSum(backlog, s => s.remaining * s.runtime), backlogTitles: backlog.length,
    firstT: records.length ? records[0].t : null,
    datedEps: records.length, undatedEps: totalEps - records.length,
    unknownRuntime: shows.filter(s => s.eps && !s.runtimeKnown).length,
  };
}

function statsListMetrics(data) {
  const lists = STATS_STATUSES.map(([key, label]) => {
    const list = statsOf(data, key);
    return {
      key, label, count: list.length, eps: statsEpsOf(list),
      left: statsSum(list, s => s.remaining), leftMin: statsSum(list, s => s.remaining * s.runtime),
    };
  });
  const watching = lists.find(l => l.key === "watching");
  return { lists, watchingPct: statsPct(watching.eps, watching.eps + watching.left) };
}

// Watch time per calendar month, the last 12 (oldest first).
function statsMonthRows(data) {
  const n = new Date(data.now);
  const rows = [];
  for (let i = 11; i >= 0; i--) {
    const from = new Date(n.getFullYear(), n.getMonth() - i, 1).getTime();
    const to = new Date(n.getFullYear(), n.getMonth() - i + 1, 1).getTime();
    const d = new Date(from);
    rows.push({ label: STATS_MONTHS[d.getMonth()], sub: String(d.getFullYear()), from, min: statsSum(statsBetween(data, from, to), r => r.min) });
  }
  return rows;
}

// Watch time per year, from the first year anything was logged.
function statsYearRows(data) {
  const years = new Map();
  for (const r of data.records) { const y = new Date(r.t).getFullYear(); years.set(y, (years.get(y) || 0) + r.min); }
  if (!years.size) return [];
  const rows = [];
  for (let y = Math.min(...years.keys()); y <= new Date(data.now).getFullYear(); y++) rows.push({ label: String(y), min: years.get(y) || 0 });
  return rows;
}

// The past 365 days: each day's minutes (shown at most 24h), and the streaks.
function statsCalendarMetrics(data) {
  const { days, now } = data;
  const today = statsDayStart(now);
  const start = statsDayStart(today - 364 * STATS_DAY_MS);
  let active = 0, peak = null;
  for (let t = start; t <= today; t = statsDayStart(t + 26 * 3600000)) {
    const d = days.get(statsDayKey(t));
    if (d) { active++; if (!peak || d.shown > peak.min) peak = { t, min: d.shown }; }
  }
  const keys = [...days.keys()].filter(k => statsKeyToTime(k) >= start).sort();
  let current = 0;
  for (let t = days.has(statsDayKey(today)) ? today : today - STATS_DAY_MS; days.has(statsDayKey(t)); t -= STATS_DAY_MS) current++;
  const monday = today - ((new Date(today).getDay() + 6) % 7) * STATS_DAY_MS;
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const t = monday + i * STATS_DAY_MS + 2 * 3600000;
    return { label: STATS_WEEKDAYS[(i + 1) % 7], on: days.has(statsDayKey(t)), future: statsDayStart(t) > today };
  });
  return { start, today, active, dark: 365 - active, peak, longest: statsLongestRun(keys), current, week };
}

// One period: what the month/week recaps showed.
function statsPeriodMetrics(data, from, to) {
  const recs = statsBetween(data, from, to);
  const shows = new Map();
  const dayMin = new Map();
  for (const r of recs) {
    const s = shows.get(r.sh) || { eps: 0, min: 0 };
    s.eps++; s.min += r.min; shows.set(r.sh, s);
    dayMin.set(r.day, (dayMin.get(r.day) || 0) + r.min);
  }
  let topDay = null;
  for (const [k, v] of dayMin) if (!topDay || Math.min(v, 1440) > topDay[1]) topDay = [k, Math.min(v, 1440)];
  let binge = 0;
  for (const k of dayMin.keys()) for (const v of data.days.get(k).shows.values()) if (v.min <= 24 * 60) binge = Math.max(binge, v.min);
  const min = statsSum(recs, r => r.min);
  return {
    from, to, min, eps: recs.length, showCount: shows.size, activeDays: dayMin.size, dayMin,
    avgPerActiveDay: dayMin.size ? min / dayMin.size : null,
    topDay: topDay ? { t: statsKeyToTime(topDay[0]), min: topDay[1] } : null,
    longestShowDay: binge || null,
    top: [...shows].sort((a, b) => b[1].eps - a[1].eps || b[1].min - a[1].min).slice(0, 3).map(([sh, v]) => ({ sh, ...v })),
  };
}
// This week / month so far, the last full one, and the like-for-like
// comparison: so far vs the same stretch of the one before (stopping at
// its end when that one was shorter).
function statsCompareMetrics(data, unit) {
  const now = data.now;
  const today = statsDayStart(now);
  let curFrom, prevFrom, prevEnd;
  if (unit === "week") {
    curFrom = today - ((new Date(today).getDay() + 6) % 7) * STATS_DAY_MS;
    prevFrom = statsDayStart(curFrom - 7 * STATS_DAY_MS + 2 * 3600000);
    prevEnd = curFrom;
  } else {
    const n = new Date(now);
    curFrom = new Date(n.getFullYear(), n.getMonth(), 1).getTime();
    prevFrom = new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime();
    prevEnd = curFrom;
  }
  const current = statsPeriodMetrics(data, curFrom, now + 1);
  const previous = statsPeriodMetrics(data, prevFrom, prevEnd);
  const sameSpanEnd = Math.min(prevFrom + (now - curFrom), prevEnd);
  const prevSoFar = statsSum(statsBetween(data, prevFrom, sameSpanEnd), r => r.min);
  return {
    unit, current, previous, prevSoFar,
    change: prevSoFar > 0 ? Math.round(((current.min - prevSoFar) / prevSoFar) * 100) : null,
  };
}

// Day of the week over the past year, and the habits beside it.
function statsWeekdayMetrics(data) {
  const { records, days, now } = data;
  const yearAgo = statsYearAgo(data);
  const recs = records.filter(r => r.t >= yearAgo);
  const wd = new Array(7).fill(0);
  for (const r of recs) wd[new Date(r.t).getDay()] += r.min;
  const perDay = wd.map(v => v / 52);
  const all = statsSum(wd, v => v);
  const weekend = wd[5] + wd[6]; // Friday and Saturday - the weekend in Israel
  const activeKeys = [...days.keys()].filter(k => statsKeyToTime(k) >= statsDayStart(yearAgo)).sort();
  const months = new Array(12).fill(0);
  for (const r of recs) months[new Date(r.t).getMonth()] += r.min;
  const busiest = all ? months.indexOf(Math.max(...months)) : null;
  return {
    perDay, peak: all ? perDay.indexOf(Math.max(...perDay)) : null,
    weekdayPct: all ? statsPct(all - weekend, all) : null,
    weekendHeavy: weekend / Math.max(1, all) > (2 / 7) * 1.15,
    marathonDays: activeKeys.filter(k => days.get(k).min >= STATS_MARATHON_MIN).length,
    busiestMonth: busiest, busiestMonthMin: busiest == null ? 0 : months[busiest],
  };
}

// When in the day (and week) episodes get marked watched, over the past
// year - a show-day adding up to more than a day of runtime was marked at
// once, so it's left out (the marathon rule).
function statsHourMetrics(data) {
  const yearAgo = statsYearAgo(data);
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let count = 0;
  for (const r of data.records) {
    if (r.t < yearAgo) continue;
    const d = data.days.get(r.day);
    const v = d && d.shows.get(r.sh);
    if (v && v.min > 24 * 60) continue;
    const dt = new Date(r.t);
    grid[dt.getDay()][dt.getHours()]++;
    count++;
  }
  return { grid, count, max: Math.max(0, ...grid.flat()) };
}

// Binge (marathon) days: 4+ episodes of one show on one calendar day - one
// that adds up to more than a day of runtime was marked at once, not binged.
function statsBingeMetrics(data, range) {
  const { days, now } = data;
  const yearAgo = statsDayStart(now - 365 * STATS_DAY_MS);
  const inRange = k => range === "all" || statsKeyToTime(k) >= yearAgo;
  const binges = [];
  let bingeEps = 0, allEps = 0;
  for (const [k, d] of days) {
    if (!inRange(k)) continue;
    allEps += d.eps;
    for (const [sh, v] of d.shows) if (v.eps >= STATS_BINGE_EPS && v.min <= 24 * 60) { binges.push({ day: k, t: statsKeyToTime(k), sh, eps: v.eps, min: v.min }); bingeEps += v.eps; }
  }
  const bingeDays = [...new Set(binges.map(b => b.day))].sort();
  let prevCount = null;
  if (range === "year") {
    const twoAgo = statsDayStart(now - 730 * STATS_DAY_MS);
    const prev = new Set();
    for (const [k, d] of days) {
      const t = statsKeyToTime(k);
      if (t >= twoAgo && t < yearAgo) for (const v of d.shows.values()) if (v.eps >= STATS_BINGE_EPS && v.min <= 24 * 60) prev.add(k);
    }
    prevCount = prev.size;
  }
  const wd = new Array(7).fill(0);
  bingeDays.forEach(k => wd[new Date(statsKeyToTime(k)).getDay()]++);
  const months = new Array(12).fill(0);
  bingeDays.forEach(k => months[new Date(statsKeyToTime(k)).getMonth()]++);
  const span = range === "all" && bingeDays.length ? Math.max(1, (now - statsKeyToTime(bingeDays[0])) / STATS_DAY_MS) : 365;
  const perShow = new Map();
  for (const b of binges) {
    const x = perShow.get(b.sh) || { n: 0, last: b };
    x.n++; if (b.t > x.last.t) x.last = b; perShow.set(b.sh, x);
  }
  return {
    range, days: bingeDays.length, prevCount,
    topWeekday: bingeDays.length ? wd.indexOf(Math.max(...wd)) : null,
    peakMonth: bingeDays.length ? months.indexOf(Math.max(...months)) : null,
    everyNDays: bingeDays.length ? Math.max(1, Math.round(span / bingeDays.length)) : null,
    longestRun: statsLongestRun(bingeDays),
    avgSize: binges.length ? statsSum(binges, b => b.eps) / binges.length : null,
    bingeMin: statsSum(binges, b => b.min),
    share: statsPct(bingeEps, allEps),
    biggest: binges.slice().sort((a, b) => b.eps - a.eps || b.t - a.t).slice(0, 5),
    mostBinged: [...perShow].sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([sh, x]) => ({ sh, n: x.n })),
    latest: [...perShow].map(([, x]) => x.last).sort((a, b) => b.t - a.t).slice(0, 5),
  };
}

// The shows with the most watch time - in the past year, or ever.
function statsTopShows(data, range, n = 15) {
  let list;
  if (range === "year") {
    const by = new Map();
    for (const r of statsBetween(data, statsYearAgo(data), data.now + 1)) {
      const x = by.get(r.sh) || { eps: 0, min: 0 };
      x.eps++; x.min += r.min; by.set(r.sh, x);
    }
    list = [...by].map(([sh, x]) => ({ sh, ...x }));
  } else {
    list = data.shows.filter(s => s.eps).map(sh => ({ sh, eps: sh.eps, min: sh.min }));
  }
  return list.sort((a, b) => b.min - a.min).slice(0, n);
}

// Genres, top seven and the rest as Other - by shows, or by hours (a
// show's time split evenly across its genres).
function statsGenreMetrics(data, by) {
  const counts = new Map();
  let noGenre = 0;
  for (const sh of data.shows) {
    if (!sh.eps) continue;
    if (!sh.genres.length) { noGenre++; continue; }
    for (const g of sh.genres) counts.set(g, (counts.get(g) || 0) + (by === "shows" ? 1 : sh.min / sh.genres.length));
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 7);
  const rest = statsSum(sorted.slice(7), ([, v]) => v);
  const rows = rest ? [...top, ["Other", rest]] : top;
  return { rows, total: statsSum(rows, ([, v]) => v), noGenre };
}

// Countries of origin (a show's first), by watch time.
function statsCountryMetrics(data) {
  const by = new Map();
  let unknown = 0;
  for (const sh of data.shows) {
    if (!sh.eps) continue;
    if (!sh.countries.length) { unknown++; continue; }
    const x = by.get(sh.countries[0]) || { min: 0, titles: 0 };
    x.min += sh.min; x.titles++; by.set(sh.countries[0], x);
  }
  const rows = [...by].sort((a, b) => b[1].min - a[1].min);
  return { rows, total: statsSum(rows, ([, x]) => x.min), unknown };
}

// Networks: where each show first aired (its first TMDB network).
function statsNetworkMetrics(data, by) {
  const map = new Map();
  for (const sh of data.shows) {
    if (!sh.eps || !sh.network) continue;
    const x = map.get(sh.network.id) || { net: sh.network, shows: 0, min: 0 };
    x.shows++; x.min += sh.min; map.set(sh.network.id, x);
  }
  const key = by === "shows" ? "shows" : "min";
  const rows = [...map.values()].sort((a, b) => b[key] - a[key]);
  return { rows, key, total: statsSum(rows, x => x[key]), shows: statsSum(rows, x => x.shows), min: statsSum(rows, x => x.min) };
}

// Watch time by each show's release decade and year.
function statsReleaseMetrics(data) {
  const watched = data.shows.filter(s => s.eps && s.year);
  const total = statsSum(watched, s => s.min);
  const decades = new Map(), years = new Map();
  for (const s of watched) {
    const d = s.year < 1970 ? "Older" : `${Math.floor(s.year / 10) * 10}s`;
    decades.set(d, (decades.get(d) || 0) + s.min);
    years.set(s.year, (years.get(s.year) || 0) + s.min);
  }
  const y = new Date(data.now).getFullYear();
  const decadeRows = [{ label: "Older", min: decades.get("Older") || 0 }];
  for (let d = 1970; d <= Math.floor(y / 10) * 10; d += 10) decadeRows.push({ label: `${d}s`, min: decades.get(`${d}s`) || 0 });
  const yearRows = [];
  for (let yy = y - 9; yy <= y; yy++) yearRows.push({ label: String(yy), min: years.get(yy) || 0 });
  const top = decadeRows.slice().sort((a, b) => b.min - a.min)[0];
  // New shows started per year, the last 5 full years.
  const firstSeen = new Map();
  for (const r of data.records) if (!firstSeen.has(r.sh)) firstSeen.set(r.sh, r.t);
  let started = 0;
  for (const t of firstSeen.values()) { const yy = new Date(t).getFullYear(); if (yy >= y - 5 && yy < y) started++; }
  return {
    total, decadeRows, yearRows, decadesUsed: decadeRows.filter(r => r.min > 0).length,
    topDecade: total ? top.label : null, newPerYear: Math.round(started / 5), noYear: data.shows.filter(s => s.eps && !s.year).length,
  };
}

// A short read of the whole profile.
function statsProfileMetrics(data) {
  const watched = data.shows.filter(s => s.eps);
  const total = statsSum(watched, s => s.min);
  const genre = new Map();
  for (const s of watched) for (const g of s.genres) genre.set(g, (genre.get(g) || 0) + s.min / s.genres.length);
  const topGenre = [...genre].sort((a, b) => b[1] - a[1])[0] || null;
  const started = data.shows.filter(s => s.status !== "plantowatch").length;
  const dated = watched.filter(s => s.year);
  const yearMin = statsSum(dated, s => s.min);
  const first = data.records.length ? data.records[0].t : null;
  return {
    topGenre: topGenre ? topGenre[0] : null, topGenrePct: topGenre ? statsPct(topGenre[1], total) : null,
    completionOfStarted: statsPct(statsOf(data, "completed").length, started),
    avgReleaseYear: yearMin ? Math.round(statsSum(dated, s => s.year * s.min) / yearMin) : null,
    inProgress: statsOf(data, "watching").length,
    hoursPerDay: first ? total / 60 / Math.max(1, (data.now - first) / STATS_DAY_MS) : null,
    since: first ? new Date(first).getFullYear() : null,
    activeYears: new Set(data.records.map(r => new Date(r.t).getFullYear())).size,
  };
}

// What's left in Watching / Plan to Watch / On Hold, and when it clears at a
// pace (hours a day; yours is the last 90 days' average).
const STATS_PACE_DAYS = 90;
function statsMyPace(data) {
  const recent = statsSum(statsBetween(data, data.now - STATS_PACE_DAYS * STATS_DAY_MS, data.now + 1), r => r.min);
  return Math.max(0.1, Math.round((recent / STATS_PACE_DAYS / 60) * 10) / 10);
}
function statsQueueMetrics(data, pace) {
  const queued = data.shows.filter(s => STATS_QUEUE_STATUSES.includes(s.status) && s.remaining > 0);
  const left = statsSum(queued, s => s.remaining * s.runtime);
  const byStatus = STATS_QUEUE_STATUSES.map(k => {
    const list = queued.filter(s => s.status === k);
    return { key: k, label: STATS_STATUSES.find(([s]) => s === k)[1], min: statsSum(list, s => s.remaining * s.runtime), titles: list.length };
  });
  const days = pace > 0 ? left / (pace * 60) : Infinity;
  const lifetime = statsSum(data.shows, s => s.min);
  return {
    queued, left, byStatus, days,
    clear: isFinite(days) && days <= 3650 ? data.now + days * STATS_DAY_MS : null,
    months: isFinite(days) ? Math.round(days / 30.4) : null,
    lifetime, timesLifetime: left ? lifetime / left : null,
    biggest: queued.slice().sort((a, b) => b.remaining * b.runtime - a.remaining * a.runtime).slice(0, 8),
  };
}
// The last 90 days, a day each (minutes).
function statsLast90(data) {
  const out = [];
  for (let i = STATS_PACE_DAYS - 1; i >= 0; i--) {
    const t = data.now - i * STATS_DAY_MS;
    const d = data.days.get(statsDayKey(t));
    out.push({ t, min: d ? d.min : 0 });
  }
  return out;
}

function statsRecentMetrics(data, n = 12) {
  const seen = new Set();
  const list = [];
  for (let i = data.records.length - 1; i >= 0 && list.length < n; i--) {
    const r = data.records[i];
    if (seen.has(r.sh)) continue;
    seen.add(r.sh);
    list.push(r);
  }
  return list;
}

// ---------------------------------------------------------------------
// Pieces of layout
// ---------------------------------------------------------------------
const STATS_NO_DATA = `<span class="sx-na">no data</span>`;
const statsOr = (v, f) => (v == null || (typeof v === "number" && !isFinite(v)) ? STATS_NO_DATA : f(v));
const statsCode = r => `S${String(r.s).padStart(2, "0")}E${String(r.e).padStart(2, "0")}`;

function statsThumb(sh, cls = "") {
  return sh.poster
    ? `<img class="sx-thumb ${cls}" loading="lazy" src="${sh.poster}" alt="">`
    : `<span class="sx-thumb sx-thumb-none ${cls}" aria-hidden="true">${statsEsc((sh.title || "?")[0])}</span>`;
}
function statsSection(title, body, { note = "", controls = "", cls = "" } = {}) {
  return `
    <section class="sx-section ${cls}">
      <div class="sx-section-head"><h3 class="sx-h">${title}</h3>${controls ? `<div class="sx-seg" role="group">${controls}</div>` : ""}</div>
      ${body}
      ${note ? `<p class="sx-note">${note}</p>` : ""}
    </section>`;
}
function statsSeg(group, options, active) {
  return options.map(([value, label]) =>
    `<button type="button" class="sx-seg-btn${value === active ? " on" : ""}" aria-pressed="${value === active}" data-sx-seg="${group}" data-value="${value}">${label}</button>`
  ).join("");
}
function statsKpi(label, value, sub = "") {
  return `<div class="sx-kpi"><div class="sx-kpi-label">${label}</div><div class="sx-kpi-value">${value}</div>${sub ? `<div class="sx-kpi-sub">${sub}</div>` : ""}</div>`;
}
function statsEmpty(text) {
  return `<div class="sx-empty">${text}</div>`;
}
// Vertical bars (one per row), every bar's height in proportion to its value.
function statsColumns(rows, { fmt = statsHM, tip = r => `${r.label} · ${fmt(r.min)}`, highlight = null } = {}) {
  const max = Math.max(0, ...rows.map(r => r.min));
  if (!max) return statsEmpty("Nothing watched in this stretch.");
  return `
    <div class="sx-cols" style="--n:${rows.length}">
      ${rows.map((r, i) => `
        <div class="sx-col${highlight === i ? " hl" : ""}" data-tip="${statsEsc(tip(r))}" tabindex="0">
          <span class="sx-col-val">${r.min ? fmt(r.min) : "0"}</span>
          <div class="sx-col-track"><i style="height:${(r.min / max) * 100}%"></i></div>
          <span class="sx-col-label">${statsEsc(r.label)}${r.sub ? `<small>${statsEsc(r.sub)}</small>` : ""}</span>
        </div>`).join("")}
    </div>`;
}
// Horizontal bars with the label and value as text.
function statsBars(rows, { color = null } = {}) {
  const max = Math.max(0, ...rows.map(r => r.value));
  return `
    <div class="sx-bars">
      ${rows.map(r => `
        <div class="sx-bar-row" data-tip="${statsEsc(r.tip || `${r.label} · ${r.text}`)}">
          <span class="sx-bar-label">${r.icon || ""}<span>${statsEsc(r.label)}</span></span>
          <div class="sx-bar-track"><i style="width:${max ? (r.value / max) * 100 : 0}%;${r.color || color ? `background:${r.color || color}` : ""}"></i></div>
          <span class="sx-bar-val">${r.text}</span>
        </div>`).join("")}
    </div>`;
}

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
const STATS_STATUS_COLORS = { completed: "var(--accent)", watching: "var(--gold)", plantowatch: "#2bb3a3", hold: "#9085e9", dropped: "#6b7785" };
const STATS_TABS = [["summary", "Summary"], ["time", "Time"], ["shows", "Shows"], ["taste", "Taste"], ["queue", "Queue"]];

function statsTabSummary(data) {
  const m = statsSummaryMetrics(data);
  const L = statsListMetrics(data);
  const months = statsMonthRows(data);
  const listTotal = statsSum(L.lists, l => l.count);
  const strip = L.lists.filter(l => l.count).map(l =>
    `<i style="flex:${l.count};background:${STATS_STATUS_COLORS[l.key]}" data-tip="${l.label} · ${statsNum(l.count)} shows · ${statsNum(l.eps)} episodes"></i>`).join("");
  const legend = L.lists.map(l => `
    <div class="sx-legend-item">
      <span class="sx-swatch" style="background:${STATS_STATUS_COLORS[l.key]}"></span>
      <div><b>${statsNum(l.count)}</b> ${l.label}
        <small>${statsNum(l.eps)} episodes watched${l.key === "watching" ? ` · ${L.watchingPct}% of aired · ${statsDur(l.leftMin)} left` : l.key === "plantowatch" ? ` · ${statsNum(l.left)} episodes to go` : ""}</small></div>
    </div>`).join("");
  const facts = [
    ["Peak year", m.peakYear == null ? null : `${m.peakYear} · ${statsNum(m.peakYearMin / 60)}h`],
    ["Best weekday", m.topWeekday == null ? null : `${STATS_WEEKDAYS_LONG[m.topWeekday]} · ${statsHM(m.topWeekdayAvg)} a day`],
    ["Longest streak (past year)", m.longestStreak.len ? `${m.longestStreak.len} days` : null],
    ["Last 30 days", `${statsHM(m.last30Min)} · ${m.last30Days} active days`],
    ["Active days this year", `${m.daysThisYear} of ${m.dayOfYear}`],
    [`Hours in ${m.thisYear}`, `${statsNum(m.thisYearMin / 60)}h · ${statsNum(m.epsThisYear)} episodes`],
  ];
  return `
    <div class="sx-kpis">
      ${statsKpi("Hours watched", statsNum(m.totalMin / 60), `≈ ${statsNum(m.totalMin / 1440)} days`)}
      ${statsKpi("Episodes", statsNum(m.totalEps), `${statsNum(m.finished)} in finished shows · ${statsNum(m.inProgress)} in shows you're watching · ${statsNum(m.otherEps)} other`)}
      ${statsKpi("Shows", statsNum(m.tracked), `${statsNum(m.completed)} completed`)}
      ${statsKpi("Completed", `${m.completionOfTracked}%`, "of all tracked shows")}
    </div>
    ${statsSection("Lists", listTotal ? `<div class="sx-strip" role="img" aria-label="Shows per list">${strip}</div><div class="sx-legend">${legend}</div>` : statsEmpty("No shows in the library yet."))}
    <div class="sx-grid2">
      ${statsSection("Hours per month", statsColumns(months, { fmt: v => `${statsNum(v / 60)}h`, tip: r => `${r.label} ${r.sub} · ${statsHM(r.min)}`, highlight: months.length - 1 }), { note: "This month so far is highlighted." })}
      ${statsSection("At a glance", `<dl class="sx-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v == null ? STATS_NO_DATA : v}</dd></div>`).join("")}</dl>`)}
    </div>
    ${m.unknownRuntime || m.undatedEps ? `<p class="sx-note">${[
      m.unknownRuntime ? `${statsNum(m.unknownRuntime)} shows have no episode length on TMDB - counted at ${STATS_DEFAULT_RUNTIME} min an episode.` : "",
      m.undatedEps ? `${statsNum(m.undatedEps)} episodes have no date - in the totals, not in anything by date.` : "",
    ].filter(Boolean).join(" ")}</p>` : ""}`;
}

function statsHourMatrix(data) {
  const h = statsHourMetrics(data);
  if (!h.count) return statsEmpty("Nothing watched in the past year.");
  const order = [0, 1, 2, 3, 4, 5, 6]; // Sunday first
  const rows = order.map(d => `
    <div class="sx-hm-row"><span class="sx-hm-day">${STATS_WEEKDAYS[d]}</span>
      ${h.grid[d].map((v, hr) => `<i style="--a:${v ? 0.15 + 0.85 * (v / h.max) : 0}" data-tip="${STATS_WEEKDAYS_LONG[d]} ${String(hr).padStart(2, "0")}:00 · ${v} episode${v === 1 ? "" : "s"}"></i>`).join("")}
    </div>`).join("");
  const hours = [0, 3, 6, 9, 12, 15, 18, 21].map(hr => `<span style="grid-column:${hr + 2}">${String(hr).padStart(2, "0")}</span>`).join("");
  return `<div class="sx-hm-wrap"><div class="sx-hm">${rows}<div class="sx-hm-hours">${hours}</div></div></div>`;
}
function statsMonthCalendars(data, cal) {
  const out = [];
  const end = new Date(cal.today);
  for (let i = 11; i >= 0; i--) {
    const first = new Date(end.getFullYear(), end.getMonth() - i, 1);
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = first.getDay(); // Sunday first
    let cells = "<i class=\"pad\"></i>".repeat(lead);
    let monthMin = 0;
    for (let d = 1; d <= daysIn; d++) {
      const t = new Date(first.getFullYear(), first.getMonth(), d).getTime();
      const x = data.days.get(statsDayKey(t));
      const shown = x ? x.shown : 0;
      monthMin += x ? x.min : 0;
      const lvl = t > cal.today || t < cal.start ? "out" : !shown ? "l0" : shown < 60 ? "l1" : shown < 150 ? "l2" : shown < 240 ? "l3" : "l4";
      cells += `<i class="${lvl}"${lvl !== "out" ? ` data-tip="${statsDateShort(t)} · ${shown ? statsHM(shown) : "nothing"}"` : ""}></i>`;
    }
    out.push(`<div class="sx-month"><div class="sx-month-name">${STATS_MONTHS[first.getMonth()]} <small>${first.getFullYear()}</small></div><div class="sx-month-grid">${cells}</div></div>`);
  }
  return `<div class="sx-months">${out.join("")}</div>
    <div class="sx-scale"><span>Less</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span><span class="sx-scale-note">under 1h · 1–2.5h · 2.5–4h · 4h+</span></div>`;
}
function statsPeriodColumn(p, title) {
  const top = p.top.length
    ? `<ol class="sx-mini-rank">${p.top.map(x => `<li>${statsThumb(x.sh, "xs")}<span>${statsEsc(x.sh.title)}</span><small>${x.eps} eps · ${statsHM(x.min)}</small></li>`).join("")}</ol>`
    : statsEmpty("Nothing watched.");
  return `
    <div class="sx-period">
      <div class="sx-period-title">${title}</div>
      <div class="sx-period-big">${statsHM(p.min)}</div>
      <dl class="sx-facts tight">
        <div><dt>Shows</dt><dd>${p.showCount}</dd></div>
        <div><dt>Active days</dt><dd>${p.activeDays}</dd></div>
        <div><dt>Per active day</dt><dd>${statsOr(p.avgPerActiveDay, statsHM)}</dd></div>
        <div><dt>Busiest day</dt><dd>${p.topDay ? `${statsDateShort(p.topDay.t)} · ${statsHM(p.topDay.min)}` : STATS_NO_DATA}</dd></div>
        <div><dt>Most of one show in a day</dt><dd>${statsOr(p.longestShowDay, statsHM)}</dd></div>
      </dl>
      ${top}
    </div>`;
}
function statsCompareCard(c) {
  const name = c.unit === "week" ? "week" : "month";
  const delta = c.change == null
    ? `<span class="sx-delta none">no data to compare</span>`
    : `<span class="sx-delta ${c.change > 0 ? "up" : c.change < 0 ? "down" : ""}">${c.change > 0 ? "▲" : c.change < 0 ? "▼" : "="} ${Math.abs(c.change)}%</span>`;
  return `
    <div class="sx-card sx-compare">
      <div class="sx-compare-head"><b>This ${name} vs last</b>${delta}</div>
      <p class="sx-note">So far this ${name} (${statsHM(c.current.min)}) against the same stretch of last ${name} (${statsHM(c.prevSoFar)}).</p>
      <div class="sx-grid2 tight">
        ${statsPeriodColumn(c.current, `This ${name} · from ${statsDateShort(c.current.from)}`)}
        ${statsPeriodColumn(c.previous, `Last ${name} · ${statsDateShort(c.previous.from)} – ${statsDateShort(c.previous.to - 1)}`)}
      </div>
    </div>`;
}
function statsTabTime(data) {
  if (!data.records.length) return statsEmpty("No episodes with a date yet.");
  const w = statsWeekdayMetrics(data);
  const cal = statsCalendarMetrics(data);
  const years = statsYearRows(data);
  const s = statsSummaryMetrics(data);
  const order = [0, 1, 2, 3, 4, 5, 6]; // Sunday first
  const dow = statsBars(order.map(d => ({
    label: STATS_WEEKDAYS_LONG[d], value: w.perDay[d], text: statsHM(w.perDay[d]),
    color: d === w.peak ? "var(--gold)" : null, tip: `${STATS_WEEKDAYS_LONG[d]} · ${statsHM(w.perDay[d])} a day on average`,
  })));
  const week = cal.week.map(d => `<span class="sx-day${d.on ? " on" : ""}${d.future ? " future" : ""}">${d.label}</span>`).join("");
  return `
    <h2 class="sx-group">Patterns</h2>
    <div class="sx-grid2">
      ${statsSection("When you watch", statsHourMatrix(data), { note: "Episodes by the hour they were marked watched (usually as they end), past year. Seasons marked all at once are left out." })}
      ${statsSection("Average per weekday", `${dow}
        <div class="sx-split">${w.weekdayPct == null ? STATS_NO_DATA : `
          <div class="sx-split-bar"><i style="flex:${w.weekdayPct}"></i><i class="b" style="flex:${100 - w.weekdayPct}"></i></div>
          <div class="sx-split-legend"><span><span class="sx-swatch" style="background:var(--accent)"></span>Sun–Thu <b>${w.weekdayPct}%</b></span><span><span class="sx-swatch" style="background:var(--gold)"></span>Fri–Sat <b>${100 - w.weekdayPct}%</b></span><span class="dim">${w.weekendHeavy ? "Weekend-heavy" : "Weekday-heavy"}</span></div>`}
        </div>
        <dl class="sx-facts tight">
          <div><dt>Days with 6h+</dt><dd>${w.marathonDays}</dd></div>
          <div><dt>Busiest month (past year)</dt><dd>${w.busiestMonth == null ? STATS_NO_DATA : `${STATS_MONTHS[w.busiestMonth]} · ${statsNum(w.busiestMonthMin / 60)}h`}</dd></div>
        </dl>`, { note: "Minutes per weekday over the past year, divided by 52." })}
    </div>

    <h2 class="sx-group">Over time</h2>
    ${statsSection("Past 12 months, day by day", statsMonthCalendars(data, cal), { note: `${cal.active} active days, ${cal.dark} without${cal.peak ? ` · busiest ${statsDateShort(cal.peak.t)} (${statsHM(cal.peak.min)})` : ""}. A day shows at most 24 hours.` })}
    ${statsSection("Hours per year", statsColumns(years, { fmt: v => `${statsNum(v / 60)}h`, tip: r => `${r.label} · ${statsNum(r.min / 60)}h`, highlight: years.length - 1 }))}

    <h2 class="sx-group">Trends</h2>
    <div class="sx-kpis">
      ${statsKpi("Current streak", `${cal.current} day${cal.current === 1 ? "" : "s"}`, cal.current >= cal.longest.len && cal.longest.len ? "your best this year" : cal.longest.len ? `${cal.longest.len - cal.current} to tie your best` : "")}
      ${statsKpi("Best streak (past year)", `${cal.longest.len} days`, cal.longest.len ? `${statsDateShort(cal.longest.from)} – ${statsDateShort(cal.longest.to)}` : "")}
      ${statsKpi("This week", `${cal.week.filter(d => d.on).length} of 7`, `<span class="sx-days">${week}</span>`)}
      ${statsKpi("Years logging", s.firstT ? String(new Date(data.now).getFullYear() - new Date(s.firstT).getFullYear() + 1) : STATS_NO_DATA, s.firstT ? `since ${STATS_MONTHS[new Date(s.firstT).getMonth()]} ${new Date(s.firstT).getFullYear()}` : "")}
    </div>
    ${statsCompareCard(statsCompareMetrics(data, "week"))}
    ${statsCompareCard(statsCompareMetrics(data, "month"))}
    ${s.undatedEps ? `<p class="sx-note">${statsNum(s.undatedEps)} episodes have no date and aren't in this tab.</p>` : ""}`;
}

function statsRankTable(rows, cols) {
  return `
    <div class="sx-table-wrap"><table class="sx-table">
      <thead><tr>${cols.map(c => `<th class="${c.cls || ""}">${c.head}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr>${cols.map(c => `<td class="${c.cls || ""}">${c.cell(r, i)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
}
function statsShowCell(sh, sub = "") {
  return `<span class="sx-show">${statsThumb(sh, "sm")}<span><span class="sx-show-name" title="${statsEsc(sh.title)}">${statsEsc(sh.title)}</span>${sub ? `<small>${sub}</small>` : ""}</span></span>`;
}
function statsTabShows(data) {
  if (!data.shows.some(s => s.eps)) return statsEmpty("No episodes logged yet.");
  const top = statsTopShows(data, statsState.top, 15);
  const max = top.length ? top[0].min : 0;
  const board = top.length ? statsRankTable(top, [
    { head: "#", cls: "num rank", cell: (r, i) => i + 1 },
    { head: "Show", cell: r => statsShowCell(r.sh, r.sh.year ? String(r.sh.year) : "") },
    { head: "Episodes", cls: "num", cell: r => statsNum(r.eps) },
    { head: "Time", cls: "num", cell: r => statsDur(r.min) },
    { head: "", cls: "bar", cell: r => `<span class="sx-inline-bar"><i style="width:${max ? (r.min / max) * 100 : 0}%"></i></span>` },
  ]) : statsEmpty("Nothing watched in the past year.");
  const b = statsBingeMetrics(data, statsState.binge);
  const kpis = `
    <div class="sx-kpis five">
      ${statsKpi("Marathon days", statsNum(b.days), b.prevCount == null ? "all time" : b.prevCount === b.days ? "same as the year before" : `${b.prevCount > b.days ? "down" : "up"} from ${b.prevCount} the year before`)}
      ${statsKpi("Average size", statsOr(b.avgSize, v => `${v.toFixed(1)} eps`))}
      ${statsKpi("Time in marathons", statsDur(b.bingeMin), `about ${statsNum(b.bingeMin / 60)} hours`)}
      ${statsKpi("Longest run", `${b.longestRun.len} day${b.longestRun.len === 1 ? "" : "s"}`, b.longestRun.to ? `ended ${statsDateShort(b.longestRun.to)}` : "")}
      ${statsKpi("Share of episodes", `${b.share}%`, b.peakMonth == null ? "" : `mostly in ${STATS_MONTHS[b.peakMonth]}, on ${STATS_WEEKDAYS_LONG[b.topWeekday]}s · one every ${b.everyNDays} days`)}
    </div>`;
  const small = (title, rows, cols) => `<div class="sx-card"><div class="sx-card-title">${title}</div>${rows.length ? statsRankTable(rows, cols) : statsEmpty("None in this range.")}</div>`;
  return `
    ${statsSection("Top 15 by time", board, { controls: statsSeg("top", [["year", "Past year"], ["all", "All time"]], statsState.top) })}
    ${statsSection("Marathons", `${kpis}
      <div class="sx-grid3">
        ${small("Biggest", b.biggest, [{ head: "Show", cell: x => statsShowCell(x.sh, statsDateShort(x.t)) }, { head: "Eps", cls: "num", cell: x => x.eps }])}
        ${small("Most often", b.mostBinged, [{ head: "Show", cell: x => statsShowCell(x.sh) }, { head: "Days", cls: "num", cell: x => x.n }])}
        ${small("Latest", b.latest, [{ head: "Show", cell: x => statsShowCell(x.sh, statsDateShort(x.t)) }, { head: "Eps", cls: "num", cell: x => x.eps }])}
      </div>`, {
      controls: statsSeg("binge", [["year", "Past year"], ["all", "All time"]], statsState.binge),
      note: `A marathon day is ${STATS_BINGE_EPS}+ episodes of one show on one day. A day adding up to more than 24 hours of one show was marked at once, and doesn't count.`,
    })}`;
}

function statsTabTaste(data) {
  if (!data.shows.some(s => s.eps)) return statsEmpty("No episodes logged yet.");
  const p = statsProfileMetrics(data);
  const g = statsGenreMetrics(data, statsState.genres);
  const c = statsCountryMetrics(data);
  const n = statsNetworkMetrics(data, statsState.networks);
  const r = statsReleaseMetrics(data);
  const genreBars = g.rows.length ? statsBars(g.rows.map(([name, v], i) => ({
    label: name, value: v, color: name === "Other" ? STATS_OTHER_COLOR : STATS_GENRE_COLORS[i],
    text: `${statsGenreText(v, statsState.genres)} · ${statsPct(v, g.total)}%`,
  }))) : statsEmpty("No genre data yet.");
  const countryBars = c.rows.length ? statsBars(c.rows.slice(0, 8).map(([code, x]) => ({
    label: statsCountryName(code), icon: statsFlagImg(code), value: x.min,
    text: `${statsPct(x.min, c.total)}% · ${statsDur(x.min)} · ${x.titles} shows`,
  }))) : statsEmpty("No country data yet.");
  const tiles = n.rows.length ? `<div class="sx-nets">${n.rows.slice(0, 15).map((x, i) => `
    <div class="sx-net" data-tip="${statsEsc(x.net.name)} · ${x.shows} shows · ${statsDur(x.min)}">
      <span class="sx-net-rank">${i + 1}</span>
      <div class="sx-net-logo">${x.net.logo ? `<img loading="lazy" src="${STATS_IMG}w185${x.net.logo}" alt="${statsEsc(x.net.name)}">` : `<b>${statsEsc(x.net.name)}</b>`}</div>
      <div class="sx-net-name">${statsEsc(x.net.name)}</div>
      <div class="sx-net-val">${x.shows} shows · ${statsDur(x.min)}</div>
    </div>`).join("")}</div>` : statsEmpty("No network data yet.");
  const profile = [
    ["Top genre", p.topGenre ? `${statsEsc(p.topGenre)} · ${p.topGenrePct}% of your hours` : null],
    ["Average release year", p.avgReleaseYear],
    ["Finished, of shows started", `${p.completionOfStarted}%`],
    ["Shows in progress", p.inProgress],
    ["Hours a day since you started logging", statsOr(p.hoursPerDay, v => v.toFixed(1))],
    ["Logging since", p.since ? `${p.since} · ${p.activeYears} active years` : null],
  ];
  return `
    ${statsSection("Profile", `<dl class="sx-facts cols3">${profile.map(([k, v]) => `<div><dt>${k}</dt><dd>${v == null ? STATS_NO_DATA : v}</dd></div>`).join("")}</dl>`)}
    <div class="sx-grid2">
      ${statsSection("Genres", genreBars, {
        controls: statsSeg("genres", [["shows", "Shows"], ["hours", "Hours"]], statsState.genres),
        note: `${statsState.genres === "hours" ? "A show's hours are split evenly across its genres. " : ""}${g.noGenre ? `${g.noGenre} shows have no genre on TMDB.` : ""}`,
      })}
      ${statsSection("Countries", countryBars, { note: `By watch time, a show's first country of origin.${c.rows.length > 8 ? ` ${c.rows.length - 8} more countries not shown.` : ""}${c.unknown ? ` ${c.unknown} shows have no country.` : ""}` })}
    </div>
    ${statsSection("Networks", tiles, {
      controls: statsSeg("networks", [["shows", "Shows"], ["hours", "Hours"]], statsState.networks),
      note: `Where each show first aired · ${statsNum(n.shows)} shows on ${n.rows.length} networks, ${statsDur(n.min)}.`,
    })}
    <div class="sx-grid2">
      ${statsSection("Release decade", statsColumns(r.decadeRows, { fmt: statsDays, tip: x => `${x.label} · ${statsDur(x.min)} · ${statsPct(x.min, r.total)}%` }), { note: `Watch time by when each show first aired${r.topDecade ? ` · most from the ${r.topDecade}, across ${r.decadesUsed} decades` : ""}.` })}
      ${statsSection("Last 10 release years", statsColumns(r.yearRows, { fmt: statsDays, tip: x => `${x.label} · ${statsDur(x.min)} · ${statsPct(x.min, r.total)}%` }), { note: `About ${r.newPerYear} new shows started a year, the last 5 years.${r.noYear ? ` ${r.noYear} shows have no release year.` : ""}` })}
    </div>`;
}
const statsGenreText = (v, by) => (by === "shows" ? `${statsNum(v)} shows` : statsDur(v));
function statsFlagImg(code) {
  return `<img class="sx-flag" loading="lazy" src="https://flagcdn.com/w40/${code.toLowerCase()}.png" alt="" onerror="this.remove()">`;
}

function statsTabQueue(data) {
  const myPace = statsMyPace(data);
  const pace = statsState.pace || myPace;
  const q = statsQueueMetrics(data, pace);
  const spark = statsLast90(data);
  const sparkMax = Math.max(0, ...spark.map(d => d.min));
  const recent = statsRecentMetrics(data);
  const queueBody = q.queued.length ? `
    <div class="sx-queue-top">
      <div>
        <div class="sx-kpi-label">Left to watch</div>
        <div class="sx-queue-big">${statsDur(q.left)}</div>
        <div class="sx-kpi-sub">${statsNum(statsSum(q.queued, s => s.remaining))} episodes in ${q.queued.length} shows</div>
      </div>
      <div>
        <div class="sx-kpi-label">Clear by</div>
        <div class="sx-queue-big" id="sxClearDate">${statsClearText(q)}</div>
        <div class="sx-kpi-sub" id="sxClearSub">at ${pace.toFixed(1)} h a day</div>
      </div>
      <div class="sx-pace">
        <label class="sx-kpi-label" for="sxPace">Hours a day: <b id="sxPaceVal">${pace.toFixed(1)}</b></label>
        <input type="range" id="sxPace" min="0.5" max="8" step="0.1" value="${Math.min(8, Math.max(0.5, pace))}">
        <div class="sx-kpi-sub">Your pace is ${myPace.toFixed(1)} h a day (last ${STATS_PACE_DAYS} days). <button type="button" class="sx-link" id="sxPaceReset">Use it</button></div>
      </div>
    </div>
    <div class="sx-strip tall" role="img" aria-label="Time left per list">${q.byStatus.filter(x => x.min).map(x =>
      `<i style="flex:${x.min};background:${STATS_STATUS_COLORS[x.key]}" data-tip="${x.label} · ${statsDur(x.min)} · ${x.titles} shows"></i>`).join("")}</div>
    <div class="sx-legend">${q.byStatus.map(x => `<div class="sx-legend-item"><span class="sx-swatch" style="background:${STATS_STATUS_COLORS[x.key]}"></span><div><b>${statsDur(x.min)}</b> ${x.label}<small>${x.titles} shows · ${statsPct(x.min, q.left)}%</small></div></div>`).join("")}</div>
    <p class="sx-note">Everything you've watched so far (${statsDur(q.lifetime)}) is ${statsOr(q.timesLifetime, v => `${v.toFixed(1)}×`)} what's left.</p>` : statsEmpty("Nothing left in Watching, Plan to Watch or On Hold.");
  return `
    ${statsSection("What's left", queueBody)}
    <div class="sx-grid2">
      ${statsSection("Biggest in the queue", q.biggest.length ? statsRankTable(q.biggest, [
        { head: "Show", cell: s => statsShowCell(s, STATS_STATUSES.find(([k]) => k === s.status)[1]) },
        { head: "Eps left", cls: "num", cell: s => statsNum(s.remaining) },
        { head: "Time", cls: "num", cell: s => statsDur(s.remaining * s.runtime) },
      ]) : statsEmpty("Nothing queued."))}
      ${statsSection(`Last ${STATS_PACE_DAYS} days`, sparkMax ? `
        <div class="sx-spark">${spark.map(d => `<i style="height:${(d.min / sparkMax) * 100}%" data-tip="${statsDateShort(d.t)} · ${d.min ? statsHM(d.min) : "nothing"}"></i>`).join("")}</div>
        <div class="sx-spark-axis"><span>${statsDateShort(spark[0].t)}</span><span>today</span></div>` : statsEmpty(`Nothing watched in the last ${STATS_PACE_DAYS} days.`), { note: "Each bar is a day; your pace above is their average." })}
    </div>
    ${statsSection("Recently watched", recent.length ? statsRankTable(recent, [
      { head: "Show", cell: r => statsShowCell(r.sh) },
      { head: "Episode", cls: "num", cell: r => statsCode(r) },
      { head: "When", cls: "num date", cell: r => statsDateShort(r.t) },
    ]) : statsEmpty("Nothing logged yet."))}`;
}
function statsClearText(q) {
  if (!isFinite(q.days)) return "—";
  if (q.clear == null) return "10+ years";
  return new Date(q.clear).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------
const STATS_TAB_KEY = "stats_tab";
const statsState = { tab: "summary", top: "year", binge: "year", genres: "shows", networks: "shows", pace: 0 };
let statsData = null;
const STATS_TAB_RENDER = { summary: statsTabSummary, time: statsTabTime, shows: statsTabShows, taste: statsTabTaste, queue: statsTabQueue };

async function openStatsPage() {
  if (!library || !library.store || !library.adapter || document.getElementById("statsPage")) return;
  try { const saved = localStorage.getItem(STATS_TAB_KEY); if (STATS_TAB_RENDER[saved]) statsState.tab = saved; } catch (e) { /* default tab */ }
  const overlay = document.createElement("div");
  overlay.className = "sx-overlay";
  overlay.id = "statsPage";
  overlay.innerHTML = `
    <div class="sx-modal" role="dialog" aria-modal="true" aria-labelledby="sxTitle">
      <div class="sx-head">
        <div class="sx-title"><h2 id="sxTitle">My Stats</h2><span class="sx-subtitle" id="sxSubtitle"></span></div>
        <div class="sx-tabs" role="tablist" aria-label="Stats">
          ${STATS_TABS.map(([k, label]) => `<button type="button" role="tab" class="sx-tab" id="sxTab-${k}" data-tab="${k}" aria-controls="sxPanel" aria-selected="${k === statsState.tab}" tabindex="${k === statsState.tab ? 0 : -1}">${label}</button>`).join("")}
        </div>
        <button type="button" class="sx-close" id="statsCloseBtn" aria-label="Close">&times;</button>
      </div>
      <div class="sx-body" id="sxPanel" role="tabpanel" tabindex="-1"><div class="sx-loading"><div class="spinner"></div><div id="statsProgress">Gathering your shows…</div></div></div>
    </div>
    <div class="sx-tip" id="statsTip" hidden></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("stats-open");
  pushModalHistoryState(closeStatsPage);
  overlay.querySelector("#statsCloseBtn").onclick = closeStatsPage;
  overlay.addEventListener("click", e => { if (e.target === overlay) closeStatsPage(); });
  document.addEventListener("keydown", statsKeyHandler);
  statsWireTabs(overlay);
  statsWireTips(overlay);
  overlay.querySelector(".sx-tab[aria-selected=\"true\"]").focus();

  try {
    const progress = overlay.querySelector("#statsProgress");
    statsData = await statsGather((done, total) => {
      if (progress && total > 20) progress.textContent = `Gathering show details… ${done}/${total}`;
    });
    if (!document.getElementById("statsPage")) return; // closed meanwhile
    const sub = overlay.querySelector("#sxSubtitle");
    const first = statsData.records.length ? new Date(statsData.records[0].t).getFullYear() : null;
    sub.textContent = `${statsNum(statsSum(statsData.shows, s => s.eps))} episodes${first ? ` · since ${first}` : ""}`;
    statsRenderTab();
  } catch (err) {
    const body = document.getElementById("sxPanel");
    if (body) body.innerHTML = statsEmpty(`Couldn't build your stats: ${statsEsc(err.message || err)}`);
  }
}

function statsRenderTab() {
  const body = document.getElementById("sxPanel");
  if (!body || !statsData) return;
  body.setAttribute("aria-labelledby", `sxTab-${statsState.tab}`);
  body.innerHTML = STATS_TAB_RENDER[statsState.tab](statsData);
  body.scrollTop = 0;
  statsWirePace();
}

function statsSelectTab(tab, focus) {
  if (!STATS_TAB_RENDER[tab]) return;
  statsState.tab = tab;
  try { localStorage.setItem(STATS_TAB_KEY, tab); } catch (e) { /* not remembered */ }
  document.querySelectorAll("#statsPage .sx-tab").forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  statsRenderTab();
}

function statsWireTabs(overlay) {
  const tabs = overlay.querySelector(".sx-tabs");
  tabs.addEventListener("click", e => { const b = e.target.closest(".sx-tab"); if (b) statsSelectTab(b.dataset.tab); });
  tabs.addEventListener("keydown", e => {
    const keys = STATS_TABS.map(([k]) => k);
    const i = keys.indexOf(statsState.tab);
    const next = e.key === "ArrowRight" ? keys[(i + 1) % keys.length] : e.key === "ArrowLeft" ? keys[(i - 1 + keys.length) % keys.length]
      : e.key === "Home" ? keys[0] : e.key === "End" ? keys[keys.length - 1] : null;
    if (next) { e.preventDefault(); statsSelectTab(next, true); }
  });
  overlay.querySelector(".sx-body").addEventListener("click", e => {
    const btn = e.target.closest("[data-sx-seg]");
    if (btn) {
      statsState[btn.dataset.sxSeg] = btn.dataset.value;
      const y = e.currentTarget.scrollTop;
      statsRenderTab();
      e.currentTarget.scrollTop = y;
      return;
    }
    if (e.target.id === "sxPaceReset") { statsState.pace = 0; const y = e.currentTarget.scrollTop; statsRenderTab(); e.currentTarget.scrollTop = y; }
  });
}

function statsWirePace() {
  const input = document.getElementById("sxPace");
  if (!input) return;
  input.oninput = () => {
    const p = Number(input.value);
    statsState.pace = p;
    const q = statsQueueMetrics(statsData, p);
    document.getElementById("sxPaceVal").textContent = p.toFixed(1);
    document.getElementById("sxClearDate").textContent = statsClearText(q);
    document.getElementById("sxClearSub").textContent = `at ${p.toFixed(1)} h a day`;
  };
}

// One tooltip for the window: anything with data-tip - on hover, on keyboard
// focus, and on tap for touch (a second tap hides it). Kept on screen.
function statsWireTips(overlay) {
  const tip = overlay.querySelector("#statsTip");
  let pinned = null;
  const place = (x, y) => {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 12));
    const top = y + 18 + h > window.innerHeight - 8 ? Math.max(8, y - h - 12) : y + 18;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  };
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; place(x, y); };
  overlay.addEventListener("pointerover", e => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest("[data-tip]");
    if (el) show(el, e.clientX, e.clientY); else if (!pinned) tip.hidden = true;
  });
  overlay.addEventListener("pointermove", e => { if (e.pointerType !== "touch" && !tip.hidden && !pinned) place(e.clientX, e.clientY); });
  overlay.addEventListener("pointerdown", e => {
    if (e.pointerType !== "touch") return;
    const el = e.target.closest("[data-tip]");
    if (el && el !== pinned) { pinned = el; show(el, e.clientX, e.clientY); } else { pinned = null; tip.hidden = true; }
  });
  overlay.addEventListener("focusin", e => {
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    const r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.bottom - 10);
  });
  overlay.querySelector(".sx-body").addEventListener("scroll", () => { if (!pinned) tip.hidden = true; }, { passive: true });
}

function statsKeyHandler(e) {
  if (e.key === "Escape") closeStatsPage();
}
function closeStatsPage() {
  const page = document.getElementById("statsPage");
  if (!page) return;
  page.remove();
  document.body.classList.remove("stats-open");
  document.removeEventListener("keydown", statsKeyHandler);
  consumeModalHistoryState();
  const btn = document.getElementById("statsBtn");
  if (btn) btn.focus();
}

document.getElementById("statsBtn").onclick = openStatsPage;
