// My Stats: a full-page look at everything watched, in the spirit of
// SIMKL's own stats page - all computed here from the library (every
// watched record carries its time) and one light TMDB lookup per show
// (runtime, genres, countries, networks, release year, poster/backdrop),
// kept for 30 days. Uses app.js's globals: library, tmdbGet,
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
      docId, title: s.title, status: s.status, year: info.y || s.year || null, runtime,
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
const STATS_NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function statsDateLong(t) {
  return new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function statsDateShort(t) {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function statsPoster(sh, cls = "st-poster") {
  return sh.poster
    ? `<img class="${cls}" loading="lazy" src="${sh.poster}" alt="">`
    : `<div class="${cls} st-poster-none">${statsEsc((sh.title || "?")[0])}</div>`;
}
function statsFlag(code) {
  return `<img class="st-flag" loading="lazy" src="https://flagcdn.com/w40/${code.toLowerCase()}.png" alt="">`;
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
// Sections
// ---------------------------------------------------------------------
function statsHead(eyebrow, plain, bold, sub, controls = "") {
  return `
    <div class="st-head">
      <div>
        ${eyebrow ? `<div class="st-eyebrow">${eyebrow}</div>` : ""}
        <h2 class="st-h2">${plain} <b>${bold}</b></h2>
        ${sub ? `<div class="st-sub">${sub}</div>` : ""}
      </div>
      ${controls ? `<div class="st-toggles">${controls}</div>` : ""}
    </div>`;
}
function statsToggle(group, options, active) {
  return options.map(([value, label]) =>
    `<button type="button" class="st-toggle${value === active ? " on" : ""}" data-st-toggle="${group}" data-value="${value}">${label}</button>`
  ).join("");
}

function statsOverview(data) {
  const { shows, records, days, now } = data;
  const tracked = shows.length;
  const completed = shows.filter(s => s.status === "completed");
  const totalMin = shows.reduce((a, s) => a + s.min, 0);
  const totalEps = shows.reduce((a, s) => a + s.eps, 0);
  const epsOf = st => shows.filter(s => s.status === st).reduce((a, s) => a + s.eps, 0);
  const finished = epsOf("completed"), inProgress = epsOf("watching");
  const years = new Map();
  for (const r of records) { const y = new Date(r.t).getFullYear(); years.set(y, (years.get(y) || 0) + r.min); }
  const thisYear = new Date(now).getFullYear();
  const peak = [...years].sort((a, b) => b[1] - a[1])[0] || [thisYear, 0];
  const yearAgo = now - 365 * STATS_DAY_MS;
  const lastYear = records.filter(r => r.t >= yearAgo);
  const wd = new Array(7).fill(0);
  for (const r of lastYear) wd[new Date(r.t).getDay()] += r.min;
  const topWd = wd.indexOf(Math.max(...wd));
  const activeKeys = [...days.keys()].filter(k => statsKeyToTime(k) >= statsDayStart(yearAgo)).sort();
  const streak = statsLongestRun(activeKeys);
  const last30 = statsBetween(data, now - 30 * STATS_DAY_MS, now + 1);
  const last30Days = new Set(last30.map(r => r.day)).size;
  const jan1 = new Date(thisYear, 0, 1).getTime();
  const daysThisYear = new Set(records.filter(r => r.t >= jan1).map(r => r.day)).size;
  const dayOfYear = Math.floor((statsDayStart(now) - jan1) / STATS_DAY_MS) + 1;
  const backlog = shows.filter(s => ["watching", "plantowatch", "hold"].includes(s.status) && s.remaining > 0);
  const backlogMin = backlog.reduce((a, s) => a + s.remaining * s.runtime, 0);
  const thisYearMin = years.get(thisYear) || 0;
  const first = records.length ? records[0].t : now;
  const dhm = { d: Math.floor(totalMin / 1440), h: Math.floor((totalMin % 1440) / 60), m: Math.round(totalMin % 60) };
  const yearsSpent = Math.floor(totalMin / 1440 / 365);
  const headline = yearsSpent >= 1
    ? `<b>${STATS_NUMBER_WORDS[yearsSpent] || yearsSpent} year${yearsSpent === 1 ? "" : "s"}</b> spent in stories.`
    : `<b>${statsNum(totalMin / 1440)} days</b> spent in stories.`;
  const tile = (label, value, sub, gold) => `
    <div class="st-tile">
      <div class="st-tile-label">${label}</div>
      <div class="st-tile-value${gold ? " gold" : ""}">${value}</div>
      <div class="st-tile-sub">${sub}</div>
    </div>`;
  return `
    <section class="st-section">
      <div class="st-eyebrow">Your <b>all-time</b> totals</div>
      <h2 class="st-h1">${headline}</h2>
      <div class="st-sub">Counting every episode logged since ${STATS_MONTHS[new Date(first).getMonth()]} ${new Date(first).getFullYear()}.</div>
      <div class="st-overview">
        <div class="st-spent">
          <div class="st-spent-word">SPENT</div>
          <div class="st-spent-what">WATCHING TV SHOWS</div>
          <div class="st-dhm">
            <div><span>${statsNum(dhm.d)}</span><small>DAYS</small></div><i>:</i>
            <div><span>${dhm.h}</span><small>HOURS</small></div><i>:</i>
            <div><span>${dhm.m}</span><small>MINUTES</small></div>
          </div>
        </div>
        <div class="st-tiles">
          ${tile("Titles tracked", statsNum(tracked), `${statsNum(completed.length)} completed · ${statsPct(completed.length, tracked)}% rate`)}
          ${tile("Episodes", statsNum(totalEps), `${statsNum(finished)} finished · ${statsNum(inProgress)} in-progress · ${statsNum(totalEps - finished - inProgress)} other`)}
          ${tile("This year", `${statsNum(thisYearMin / 60)}<small>h</small>`, `${statsNum(records.filter(r => r.t >= jan1).length)} episodes since Jan 1`)}
          ${tile("Peak year", peak[0], `${statsNum(peak[1] / 60)}h in ${peak[0]}${peak[0] !== thisYear ? `, ${statsNum(thisYearMin / 60)}h in ${thisYear}` : ""}`, true)}
          ${tile("Top weekday", STATS_WEEKDAYS[topWd], `${STATS_WEEKDAYS[topWd]}s avg ${statsHM(wd[topWd] / 52)}`, true)}
          ${tile("Watch streak", `${streak.len}<small>d</small>`, "longest run in the past year")}
          ${tile("Last 30 days", `${statsNum(last30.reduce((a, r) => a + r.min, 0) / 60)}<small>h</small>`, `watched on ${last30Days} days`)}
          ${tile("Watch days this year", `${daysThisYear}<small>/${dayOfYear}</small>`, "days you watched something")}
          ${tile("Backlog", `${statsNum(backlogMin / 1440)}<small>d</small>`, `across ${backlog.length} queued titles`)}
        </div>
      </div>
    </section>`;
}

// The past year day by day, a square each (GitHub style), and the streaks.
function statsYearHeatmap(data) {
  const { days, now } = data;
  const today = statsDayStart(now);
  const start = statsDayStart(today - 364 * STATS_DAY_MS);
  const gridStart = start - new Date(start).getDay() * STATS_DAY_MS; // the Sunday of that week
  const level = min => (!min ? 0 : min < 60 ? 1 : min < 150 ? 2 : min < 240 ? 3 : min < 360 ? 4 : 5);
  const cols = [];
  const monthLabels = [];
  let active = 0, dark = 0, peak = null;
  for (let w = 0, t = gridStart; t <= today; w++) {
    const cells = [];
    for (let dow = 0; dow < 7; dow++, t += STATS_DAY_MS) {
      const tt = statsDayStart(t + 2 * 60 * 60 * 1000); // DST-safe
      if (tt < start || tt > today) { cells.push(`<i class="st-hm-cell out"></i>`); continue; }
      const d = days.get(statsDayKey(tt));
      const min = d ? d.shown : 0;
      if (min) active++; else dark++;
      if (d && (!peak || min > peak.min)) peak = { t: tt, min };
      const tip = d ? `${statsDateShort(tt)} · ${statsHM(min)} · ${d.eps} episode${d.eps === 1 ? "" : "s"}` : `${statsDateShort(tt)} · nothing watched`;
      cells.push(`<i class="st-hm-cell l${level(min)}" data-tip="${tip}"></i>`);
      if (new Date(tt).getDate() === 1 || (w === 0 && dow === new Date(start).getDay())) monthLabels.push([w, STATS_MONTHS[new Date(tt).getMonth()]]);
    }
    cols.push(`<div class="st-hm-col">${cells.join("")}</div>`);
  }
  const keys = [...days.keys()].filter(k => statsKeyToTime(k) >= start).sort();
  const longest = statsLongestRun(keys);
  // Current streak: days in a row up to today (or yesterday, if nothing yet today).
  let cur = 0;
  for (let t = days.has(statsDayKey(today)) ? today : today - STATS_DAY_MS; days.has(statsDayKey(t)); t -= STATS_DAY_MS) cur++;
  const monday = today - ((new Date(today).getDay() + 6) % 7) * STATS_DAY_MS;
  const week = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const t = monday + i * STATS_DAY_MS;
    const on = days.has(statsDayKey(t + 2 * 60 * 60 * 1000));
    const future = t > today;
    return `<div class="st-wk${on ? " on" : ""}${future ? " future" : ""}"><span>${on ? "✓" : ""}</span><small>${STATS_WEEKDAYS[(i + 1) % 7]}</small></div>`;
  }).join("");
  const colW = 100 / cols.length;
  const labels = monthLabels.filter(([w], i, arr) => i === 0 || w - arr[i - 1][0] >= 3)
    .map(([w, m]) => `<span style="left:${(w * colW).toFixed(2)}%">${m}</span>`).join("");
  return `
    <section class="st-section">
      ${statsHead("A year, day by day", "Your year of", "watching.", "", "")}
      <div class="st-card">
        <div class="st-card-top">
          <div>
            <div class="st-card-title">Your last 12 months of watching</div>
            <div class="st-card-meta">365 days · ${active} with activity · ${dark} dark${peak ? ` · peak ${statsDateShort(peak.t)} (${statsHM(peak.min)})` : ""}</div>
          </div>
          ${longest.len ? `<div class="st-card-meta green">Longest streak · ${longest.len} days · ${statsDateShort(longest.from)} → ${statsDateShort(longest.to)}</div>` : ""}
        </div>
        <div class="st-hm-wrap">
          <div class="st-hm-days"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
          <div class="st-hm-main">
            <div class="st-hm-months">${labels}</div>
            <div class="st-hm">${cols.join("")}</div>
          </div>
        </div>
        <div class="st-hm-legend">Quiet <i class="st-hm-cell l0"></i><i class="st-hm-cell l1"></i><i class="st-hm-cell l2"></i><i class="st-hm-cell l3"></i><i class="st-hm-cell l4"></i><i class="st-hm-cell l5"></i> Binge</div>
      </div>
      <div class="st-card st-streak">
        <div class="st-streak-now"><span>${cur}</span><div><b>DAY${cur === 1 ? "" : "S"}</b><small>Watch streak</small></div></div>
        <div class="st-streak-week"><div class="st-label">Streak &amp; activity · this week</div><div class="st-wks">${week}</div></div>
        <div class="st-streak-best">
          <div class="st-label">Personal best <b>${longest.len} days</b></div>
          <div class="st-bar"><i style="width:${longest.len ? Math.min(100, (cur / longest.len) * 100) : 0}%"></i></div>
          <div class="st-tile-sub">${cur >= longest.len ? "You're on your best run" : `${longest.len - cur} days to tie`}</div>
        </div>
      </div>
    </section>`;
}

// The TV card: time, a sparkline of the last 90 days, and every list.
function statsWatchedTv(data) {
  const { shows, days, now } = data;
  const total = shows.reduce((a, s) => a + s.min, 0);
  const dhm = { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: Math.round(total % 60) };
  const pts = [];
  for (let i = 89; i >= 0; i--) { const d = days.get(statsDayKey(now - i * STATS_DAY_MS)); pts.push(d ? d.min : 0); }
  const max = Math.max(60, ...pts);
  const line = pts.map((v, i) => `${(i / 89 * 300).toFixed(1)},${(38 - v / max * 34).toFixed(1)}`).join(" ");
  const of = st => shows.filter(s => s.status === st);
  const eps = list => list.reduce((a, s) => a + s.eps, 0);
  const watching = of("watching"), plan = of("plantowatch"), hold = of("hold"), dropped = of("dropped"), completed = of("completed");
  const wWatched = eps(watching), wLeft = watching.reduce((a, s) => a + s.remaining, 0);
  const wLeftMin = watching.reduce((a, s) => a + s.remaining * s.runtime, 0);
  const planLeft = plan.reduce((a, s) => a + s.remaining, 0);
  const row = (n, label, sub, right) => `<div class="st-tv-row"><b>${statsNum(n)}</b><span>${label}${sub ? `<small>${sub}</small>` : ""}</span><em>${right}</em></div>`;
  return `
    <section class="st-section">
      <div class="st-tv">
        <div class="st-tv-icon">${STATS_ICON_TV}</div>
        <div class="st-tv-title">WATCHED TV</div>
        <div class="st-label">Total spent watching</div>
        <div class="st-dhm small">
          <div><span>${statsNum(dhm.d)}</span><small>DAYS</small></div><i>:</i>
          <div><span>${dhm.h}</span><small>HOURS</small></div><i>:</i>
          <div><span>${dhm.m}</span><small>MINUTES</small></div>
        </div>
        <div class="st-label">Last 90 days</div>
        <svg class="st-spark" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="${line}"/></svg>
        <div class="st-tv-rows">
          ${row(completed.length, "completed", "", `${statsNum(eps(completed))} episodes`)}
          ${row(watching.length, "watching", `${statsPct(wWatched, wWatched + wLeft)}% watched`, `${statsNum(wWatched)} eps watched, need ${statsNum(wLeftMin / 1440)} days to watch the rest`)}
          ${row(plan.length, "plan to watch", "", `${statsNum(planLeft)} episodes left to watch`)}
          ${row(hold.length, "on hold", "", `${statsNum(eps(hold))} episodes`)}
          ${row(dropped.length, "dropped", "", `${statsNum(eps(dropped))} episodes`)}
        </div>
      </div>
    </section>`;
}

// A month or a week, recapped.
function statsRecapBody(data, from, to, label, unit) {
  const recs = statsBetween(data, from, to);
  const min = recs.reduce((a, r) => a + r.min, 0);
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
  const nDays = Math.round((statsDayStart(to - 1) - statsDayStart(from)) / STATS_DAY_MS) + 1;
  const grid = [];
  for (let i = 0; i < nDays; i++) {
    const t = from + i * STATS_DAY_MS + 2 * 60 * 60 * 1000;
    grid.push(`<i class="${dayMin.has(statsDayKey(t)) ? "on" : ""}" data-tip="${statsDateShort(t)}${dayMin.has(statsDayKey(t)) ? ` · ${statsHM(dayMin.get(statsDayKey(t)))}` : ""}"></i>`);
  }
  const top = [...shows].sort((a, b) => b[1].eps - a[1].eps || b[1].min - a[1].min).slice(0, 3);
  return `
    <div class="st-card st-recap">
      <div class="st-recap-top">
        <div class="st-recap-icon">${STATS_ICON_HOURGLASS}</div>
        <div class="st-recap-title">SPENT WATCHING<br>${label}</div>
        <div class="st-recap-total"><small>${shows.size} TV SHOW${shows.size === 1 ? "" : "S"}</small><b>${statsHM(min)}</b></div>
      </div>
      <div class="st-recap-grid">
        <div><div class="st-label">Total watched</div><b class="big">${statsHM(min)}</b></div>
        <div><div class="st-label">Days with activity</div><b>${dayMin.size} days</b><div class="st-recap-days ${unit}">${grid.join("")}</div></div>
        <div><div class="st-label">Average per day</div><b>${dayMin.size ? statsHM(min / dayMin.size) : "—"}</b></div>
        <div><div class="st-label">Most active day</div><b>${topDay ? `${statsDateLong(statsKeyToTime(topDay[0]))} · ${statsHM(topDay[1])}` : "—"}</b></div>
        <div><div class="st-label">Longest binge</div><b>${binge ? statsHM(binge) : "—"}</b></div>
      </div>
      ${top.length ? `
      <div class="st-recap-shows">
        <div class="st-recap-shows-label">${STATS_ICON_TV}<span>MOST WATCHED SHOWS</span></div>
        ${top.map(([sh, v], i) => `
          <div class="st-recap-show">
            ${statsPoster(sh)}
            <div><span class="st-rank">${i + 1}</span><b>${statsEsc(sh.title)}</b><small>${v.eps} plays</small><small class="dim">${statsHM(v.min)}</small></div>
          </div>`).join("")}
      </div>` : `<div class="st-empty">Nothing watched yet.</div>`}
    </div>`;
}
function statsMonthRecap(data, which = "last") {
  const n = new Date(data.now);
  const from = new Date(n.getFullYear(), n.getMonth() - (which === "last" ? 1 : 0), 1).getTime();
  const to = which === "last" ? new Date(n.getFullYear(), n.getMonth(), 1).getTime() : data.now + 1;
  const name = new Date(from).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `
    ${statsHead("", "Your month,", "recapped", "Watch time, this month and last",
      statsToggle("month", [["last", "Last month"], ["this", "This month"]], which) + `<span class="st-chip">${name}</span>`)}
    ${statsRecapBody(data, from, to, which === "last" ? "LAST MONTH" : "THIS MONTH", "month")}`;
}
function statsWeekRecap(data, which = "last") {
  const today = statsDayStart(data.now);
  const monday = today - ((new Date(today).getDay() + 6) % 7) * STATS_DAY_MS;
  const from = which === "last" ? statsDayStart(monday - 7 * STATS_DAY_MS + 2 * 3600000) : monday;
  const to = which === "last" ? monday : data.now + 1;
  const end = which === "last" ? to - 1 : statsDayStart(monday + 6 * STATS_DAY_MS + 2 * 3600000);
  const fmt = t => new Date(t).toLocaleDateString("en-GB").replace(/\//g, "-");
  return `
    ${statsHead("", "Your week,", "recapped", "Watch time, this week and last",
      statsToggle("week", [["last", "Last week"], ["this", "This week"]], which) + `<span class="st-chip">Monday ${fmt(from)} - Sunday ${fmt(end)}</span>`)}
    ${statsRecapBody(data, from, to, which === "last" ? "LAST WEEK" : "THIS WEEK", "week")}`;
}

// Genres: one bar split by share, the labels alternating above and below.
function statsGenres(data, by = "items") {
  const counts = new Map();
  for (const sh of data.shows) {
    if (!sh.eps) continue;
    for (const g of sh.genres) counts.set(g, (counts.get(g) || 0) + (by === "items" ? 1 : sh.min / sh.genres.length));
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return "";
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((a, [, v]) => a + v, 0);
  const segs = rest ? [...top, ["Other", rest]] : top;
  const total = segs.reduce((a, [, v]) => a + v, 0);
  const unit = v => (by === "items" ? `${statsNum(v)} shows` : statsDays(v));
  const bar = segs.map(([g, v], i) => {
    const pct = (v / total) * 100;
    const color = g === "Other" ? STATS_OTHER_COLOR : STATS_GENRE_COLORS[i];
    return `
      <div class="st-genre ${i % 2 ? "below" : "above"}" style="flex:${pct} 1 0;--c:${color}" data-tip="${statsEsc(g)} · ${unit(v)} · ${Math.round(pct)}%">
        <div class="st-genre-label"><b>${statsEsc(g)}</b><small>${unit(v)}</small></div>
        <div class="st-genre-seg">${pct >= 4 ? `${Math.round(pct)}%` : ""}</div>
      </div>`;
  }).join("");
  const least = top[top.length - 1];
  return `
    ${statsHead("", "Your top", "genres", "Sized by titles watched or time spent",
      statsToggle("genres", [["items", "By items"], ["time", "By watch time"]], by))}
    <div class="st-card">
      <div class="st-genre-meta">MOST <b>${statsEsc(top[0][0])}</b> <span class="st-chip small">${unit(top[0][1])}</span>
        &nbsp; LEAST <b>${statsEsc(least[0])}</b> <span class="st-chip small">${unit(least[1])}</span></div>
      <div class="st-genres">${bar}</div>
    </div>`;
}

// Countries of origin, by watch time.
function statsWorld(data) {
  const by = new Map();
  for (const sh of data.shows) {
    if (!sh.eps || !sh.countries.length) continue;
    const c = sh.countries[0];
    const x = by.get(c) || { min: 0, titles: 0 };
    x.min += sh.min; x.titles++; by.set(c, x);
  }
  const sorted = [...by].sort((a, b) => b[1].min - a[1].min);
  if (!sorted.length) return "";
  const total = sorted.reduce((a, [, x]) => a + x.min, 0);
  const shown = sorted.slice(0, 6);
  const more = sorted.length - shown.length;
  const tiles = shown.map(([c, x], i) => {
    const pct = (x.min / total) * 100;
    return i === 0
      ? `<div class="st-world-tile first" style="flex:${Math.max(pct, 30)} 1 0" data-tip="${statsEsc(statsCountryName(c))} · ${Math.round(pct)}%">
          <div class="st-world-name">${statsFlag(c)}${statsEsc(statsCountryName(c))}</div>
          <div class="st-world-big">${Math.round(pct)}%<small>${statsDays(x.min)} · ${x.titles} titles</small></div></div>`
      : `<div class="st-world-tile" style="flex:${Math.max(pct, 4)} 1 0" data-tip="${statsEsc(statsCountryName(c))} · ${Math.round(pct)}%">${statsFlag(c)}<b>${Math.round(pct)}%</b></div>`;
  }).join("") + (more > 0 ? `<div class="st-world-tile more">+${more}<small>MORE</small></div>` : "");
  const list = shown.map(([c, x]) =>
    `<span>${statsFlag(c)}${statsEsc(statsCountryName(c))} <b>${Math.round((x.min / total) * 100)}%</b> <small>· ${statsDays(x.min)} · ${x.titles} titles</small></span>`
  ).join("") + (more > 0 ? `<span class="dim">+ ${more} more countries</span>` : "");
  return `
    ${statsHead("", "Your watching, around the", "world", "Countries of origin, by watch time.", `<span class="st-sub">${sorted.length} countries total</span>`)}
    <div class="st-world">${tiles}</div>
    <div class="st-world-list">${list}</div>`;
}

// Binge days: 4+ episodes of one show on one calendar day - one that adds
// up to more than a day of runtime was marked at once, not binged.
function statsBinges(data, range = "year") {
  const { days, now } = data;
  const yearAgo = statsDayStart(now - 365 * STATS_DAY_MS);
  const inRange = k => range === "all" || statsKeyToTime(k) >= yearAgo;
  const binges = []; // { day, t, sh, eps, min }
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
  const topWd = wd.indexOf(Math.max(...wd));
  const months = new Array(12).fill(0);
  bingeDays.forEach(k => months[new Date(statsKeyToTime(k)).getMonth()]++);
  const peakMonth = months.indexOf(Math.max(...months));
  const span = range === "all" && bingeDays.length ? Math.max(1, (now - statsKeyToTime(bingeDays[0])) / STATS_DAY_MS) : 365;
  const runs = statsLongestRun(bingeDays);
  const avgSize = binges.length ? binges.reduce((a, b) => a + b.eps, 0) / binges.length : 0;
  const bingeMin = binges.reduce((a, b) => a + b.min, 0);
  const share = statsPct(bingeEps, allEps);
  const biggest = binges.slice().sort((a, b) => b.eps - a.eps || b.t - a.t).slice(0, 3);
  const perShow = new Map();
  for (const b of binges) {
    const x = perShow.get(b.sh) || { n: 0, last: b };
    x.n++; if (b.t > x.last.t) x.last = b; perShow.set(b.sh, x);
  }
  const mostBinged = [...perShow].sort((a, b) => b[1].n - a[1].n).slice(0, 3);
  const latest = [...perShow].map(([, x]) => x.last).sort((a, b) => b.t - a.t).slice(0, 3);
  const listRow = (b, i, right) => `
    <div class="st-binge-row">${i != null ? `<span class="st-num">0${i + 1}</span>` : ""}${statsPoster(b.sh)}
      <div><b>${statsEsc(b.sh.title)}</b><small>${b.sh.year || ""} · TV</small></div>
      <div class="r"><b>${b.eps} episodes</b><small>${statsDateShort(b.t)}</small></div></div>`;
  const ring = 2 * Math.PI * 52;
  const label = range === "year" ? "Last 12 months" : "All time";
  return `
    ${statsHead("", "Your", "binge report", "A binge day is a calendar day with 4 or more episodes of a single show.",
      statsToggle("binge", [["year", "Last 12 months"], ["all", "All time"]], range))}
    <div class="st-binge">
      <div class="st-card">
        <div class="st-label">Binge days · ${label}</div>
        <div class="st-binge-top">
          <div class="st-binge-count"><span>${bingeDays.length}</span><div><b>binge days</b>
            ${prevCount != null ? `<small>${prevCount === bingeDays.length ? "same as" : prevCount > bingeDays.length ? `down from ${prevCount}` : `up from ${prevCount}`} the year before</small>` : ""}</div></div>
          <svg class="st-ring" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" stroke-dasharray="${(share / 100) * ring} ${ring}"/>
            <text x="60" y="60">${share}%</text><text x="60" y="78" class="s">MID-BINGE</text></svg>
        </div>
        ${bingeDays.length ? `<div class="st-binge-style">◆ ${topWd === 0 || topWd === 6 ? "WEEKEND WARRIOR" : "WEEKNIGHT BINGER"}</div>
        <div class="st-binge-text">Most binges land on a ${STATS_WEEKDAYS_LONG[topWd]}, roughly one binge day every ${Math.max(1, Math.round(span / bingeDays.length))} days.</div>` : ""}
        <div class="st-binge-tiles">
          <div><div class="st-label">Average binge size</div><b>${avgSize.toFixed(1)} episodes</b></div>
          <div><div class="st-label">Watch time inside binges</div><b>${statsDur(bingeMin)}</b><small>about ${statsNum(bingeMin / 60)} hours total</small></div>
          <div><div class="st-label">Longest binge streak</div><b>${runs.len} day${runs.len === 1 ? "" : "s"} in a row</b>${runs.to ? `<small>ended ${statsDateShort(runs.to)}</small>` : ""}</div>
          <div><div class="st-label">Peak binge month</div><b>${bingeDays.length ? STATS_MONTHS[peakMonth] : "—"}</b><small>${share}% of episodes mid-binge</small></div>
        </div>
      </div>
      <div class="st-card">
        <div class="st-label">Biggest single-day binges</div><div class="st-sub">Most episodes of one show in a single day.</div>
        ${biggest.map((b, i) => listRow(b, i)).join("") || `<div class="st-empty">No binges in this range.</div>`}
      </div>
      <div class="st-card">
        <div class="st-label">Most binged shows</div><div class="st-sub">Ranked by number of separate binge days.</div>
        <div class="st-binge-posters">${mostBinged.map(([sh, x], i) => `
          <div>${statsPoster(sh, "st-poster big")}<div><span class="st-num">0${i + 1}</span> <b>${statsEsc(sh.title)}</b></div><small>${x.n} binge day${x.n === 1 ? "" : "s"}</small></div>`).join("")}</div>
      </div>
      <div class="st-card">
        <div class="st-label">Latest binges</div><div class="st-sub">The most recent binge for each show.</div>
        ${latest.map(b => listRow(b, null)).join("")}
      </div>
    </div>`;
}

// Networks: where each show first aired (its first TMDB network).
function statsNetworks(data, by = "items") {
  const map = new Map();
  for (const sh of data.shows) {
    if (!sh.eps || !sh.network) continue;
    const x = map.get(sh.network.id) || { net: sh.network, shows: 0, min: 0 };
    x.shows++; x.min += sh.min; map.set(sh.network.id, x);
  }
  const key = by === "items" ? "shows" : "min";
  const sorted = [...map.values()].sort((a, b) => b[key] - a[key]);
  if (!sorted.length) return "";
  const total = sorted.reduce((a, x) => a + x[key], 0);
  const totalShows = sorted.reduce((a, x) => a + x.shows, 0);
  const totalMin = sorted.reduce((a, x) => a + x.min, 0);
  const tiles = sorted.slice(0, 14).map((x, i) => {
    const pct = Math.round((x[key] / total) * 100);
    const val = by === "items" ? `${x.shows} shows` : statsDays(x.min);
    return `
      <div class="st-net${i === 0 ? " first" : i < 3 ? " second" : ""}" data-tip="${statsEsc(x.net.name)} · ${val} · ${pct}%">
        <div class="st-net-top"><span class="st-net-rank">${String(i + 1).padStart(2, "0")}</span>${i === 0 ? `<span class="st-net-badge">★ MOST WATCHED</span>` : ""}<span class="st-net-pct">${pct}%${i < 3 ? ` · ${val}` : ""}</span></div>
        <div class="st-net-logo">${x.net.logo ? `<img loading="lazy" src="${STATS_IMG}w300${x.net.logo}" alt="${statsEsc(x.net.name)}">` : `<b>${statsEsc(x.net.name)}</b>`}</div>
        ${i < 3 ? `<div class="st-net-bottom"><b>${statsEsc(x.net.name)}</b><span>${by === "items" ? `<b>${x.shows}</b> shows` : `<b>${statsDays(x.min)}</b>`}</span></div>` : ""}
      </div>`;
  }).join("");
  return `
    ${statsHead("", "Your top", "networks", `Where your shows first aired · ${totalShows} shows · ${statsDays(totalMin)} across ${sorted.length} networks`,
      statsToggle("networks", [["items", "By items"], ["time", "By watch time"]], by))}
    <div class="st-nets">${tiles}</div>`;
}

// When and how: the week's rhythm and a few habits, over the past year.
function statsHabits(data) {
  const { records, days, shows, now } = data;
  const yearAgo = now - 365 * STATS_DAY_MS;
  const recs = records.filter(r => r.t >= yearAgo);
  const wd = new Array(7).fill(0);
  for (const r of recs) wd[new Date(r.t).getDay()] += r.min;
  const perDay = wd.map(v => v / 52);
  const max = Math.max(1, ...perDay);
  const peak = perDay.indexOf(Math.max(...perDay));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const weekend = wd[0] + wd[6], all = wd.reduce((a, b) => a + b, 0);
  const wkPct = statsPct(all - weekend, all);
  const bars = order.map(i => `
    <div class="st-dow${i === peak ? " peak" : ""}" data-tip="${STATS_WEEKDAYS[i]} · ${statsHM(perDay[i])} a day on average">
      <div class="st-dow-track"><i style="height:${(perDay[i] / max) * 100}%"></i></div><small>${STATS_WEEKDAYS[i].toUpperCase()}</small></div>`).join("");
  const activeKeys = [...days.keys()].filter(k => statsKeyToTime(k) >= statsDayStart(yearAgo)).sort();
  const streak = statsLongestRun(activeKeys);
  const marathons = activeKeys.filter(k => days.get(k).min >= STATS_MARATHON_MIN).length;
  const months = new Array(12).fill(0);
  for (const r of recs) months[new Date(r.t).getMonth()] += r.min;
  const busiest = months.indexOf(Math.max(...months));
  const finished = shows.filter(s => s.status === "completed").length;
  const ended = shows.filter(s => s.status !== "plantowatch").length;
  const jan1 = new Date(new Date(now).getFullYear(), 0, 1).getTime();
  const thisYear = records.filter(r => r.t >= jan1).reduce((a, r) => a + r.min, 0);
  const style = weekend / Math.max(1, all) > 2 / 7 * 1.15 ? "Weekend Warrior" : "Weekday Regular";
  return `
    ${statsHead("Activity insights", "How you", "watch", "", `<span class="st-sub">Patterns from your past year</span>`)}
    <div class="st-habits">
      <div class="st-card">
        <div class="st-card-top"><div><div class="st-card-title small">Day of week</div><div class="st-card-meta">Avg min/day · past year</div></div><div class="st-card-meta gold">PEAK ${STATS_WEEKDAYS[peak].toUpperCase()}</div></div>
        <div class="st-dow-wrap">
          <div class="st-dows">${bars}</div>
          <div class="st-split">
            <div class="st-label">Weekday vs weekend</div>
            <div class="st-split-bar"><i style="flex:${wkPct}"></i><i class="b" style="flex:${100 - wkPct}"></i></div>
            <small><span class="dot a"></span>Weekday <b>${wkPct}%</b> &nbsp; <span class="dot b"></span>Weekend <b>${100 - wkPct}%</b></small>
          </div>
        </div>
      </div>
      <div class="st-card st-facts">
        <div><span>Watch style</span><b>${style}</b></div>
        <div><span>Watch streak</span><b>${streak.len} <small>d</small></b></div>
        <div><span>Completion</span><b>${statsPct(finished, ended)}%</b></div>
        <div><span>Marathon days (6h+)</span><b>${marathons} <small>d</small></b></div>
        <div><span>Busiest month</span><b>${STATS_MONTHS[busiest]} <small>${statsNum(months[busiest] / 60)}h</small></b></div>
        <div><span>This year</span><b>${statsNum(thisYear / 60)} <small>h</small></b></div>
      </div>
    </div>`;
}

// Bars of watch time, by release decade/year and by viewing year/month.
function statsBarList(rows, total) {
  const max = Math.max(1, ...rows.map(r => r[1]));
  return rows.map(([label, v]) => `
    <div class="st-bl" data-tip="${statsEsc(label)} · ${statsDur(v)}">
      <b>${statsEsc(label)}</b><div class="st-bl-track"><i style="width:${Math.max(v ? 3 : 0, (v / max) * 100)}%"></i></div>
      <span><b>${statsPct(v, total)}%</b> · ${statsDur(v)}</span></div>`).join("");
}
function statsMosaic(shows) {
  const posters = shows.filter(s => s.poster).slice(0, 9);
  return `<div class="st-mosaic">${posters.map(s => `<img loading="lazy" src="${s.poster}" alt="">`).join("")}</div>`;
}
function statsNewPerYear(data) {
  const firstSeen = new Map();
  for (const r of data.records) if (!firstSeen.has(r.sh)) firstSeen.set(r.sh, r.t);
  const y = new Date(data.now).getFullYear();
  let n = 0;
  for (const t of firstSeen.values()) { const yy = new Date(t).getFullYear(); if (yy >= y - 5 && yy < y) n++; }
  return Math.round(n / 5);
}
function statsCameOut(data) {
  const watched = data.shows.filter(s => s.eps && s.year);
  const total = watched.reduce((a, s) => a + s.min, 0);
  const decades = new Map();
  const years = new Map();
  for (const s of watched) {
    const d = s.year < 1970 ? "Older" : `${Math.floor(s.year / 10) * 10}s`;
    decades.set(d, (decades.get(d) || 0) + s.min);
    years.set(s.year, (years.get(s.year) || 0) + s.min);
  }
  const y = new Date(data.now).getFullYear();
  const decadeRows = [];
  for (let d = Math.floor(y / 10) * 10; d >= 1970; d -= 10) decadeRows.push([`${d}s`, decades.get(`${d}s`) || 0]);
  decadeRows.push(["Older", decades.get("Older") || 0]);
  const yearRows = [];
  for (let yy = y; yy > y - 10; yy--) yearRows.push([String(yy), years.get(yy) || 0]);
  const topDecade = decadeRows.slice().sort((a, b) => b[1] - a[1])[0];
  const used = decadeRows.filter(r => r[1] > 0).length;
  const decadeShows = watched.filter(s => `${Math.floor(s.year / 10) * 10}s` === topDecade[0]).sort((a, b) => b.min - a.min);
  return `
    <div class="st-h2-icon"><span>${STATS_ICON_LAYERS}</span><h2 class="st-h2">When your titles <b>came out</b></h2></div>
    <div class="st-split-card">
      <div class="st-split-side">
        ${statsMosaic(decadeShows)}
        <div class="st-split-side-text">
          <div class="st-label">Your top decade</div>
          <div class="st-split-big">${topDecade[0]}</div>
          <span class="st-pill">${used >= 4 ? "TIME TRAVELER" : "OF ITS TIME"}</span>
          <p>Your titles came out across ${used} different decades, led by the ${topDecade[0]}.</p>
          <p class="dim">On average, you start <b>${statsNewPerYear(data)}</b> new TV shows a year · last 5 years</p>
        </div>
      </div>
      <div class="st-split-main">
        <div class="st-card-meta">Watch time by each title's release year · ${statsDur(total)} across ${used} decades</div>
        <div class="st-two">
          <div><div class="st-label">By decade</div>${statsBarList(decadeRows, total)}</div>
          <div><div class="st-label">Last 10 years</div>${statsBarList(yearRows, total)}</div>
        </div>
      </div>
    </div>`;
}
function statsWhenWatched(data) {
  const total = data.records.reduce((a, r) => a + r.min, 0);
  const years = new Map();
  for (const r of data.records) { const yy = new Date(r.t).getFullYear(); years.set(yy, (years.get(yy) || 0) + r.min); }
  const y = new Date(data.now).getFullYear();
  const yearRows = [];
  let older = 0;
  for (const [yy, v] of years) if (yy <= y - 11) older += v;
  for (let yy = y; yy > y - 11; yy--) yearRows.push([String(yy), years.get(yy) || 0]);
  if (older) yearRows.push(["Older", older]);
  const monthRows = [];
  const n = new Date(data.now);
  for (let i = 0; i < 12; i++) {
    const from = new Date(n.getFullYear(), n.getMonth() - i, 1).getTime();
    const to = new Date(n.getFullYear(), n.getMonth() - i + 1, 1).getTime();
    const d = new Date(from);
    monthRows.push([`${STATS_MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`, statsBetween(data, from, to).reduce((a, r) => a + r.min, 0)]);
  }
  const active = [...years.keys()].length;
  const biggest = [...years].sort((a, b) => b[1] - a[1])[0] || [y, 0];
  const yearShows = new Map();
  for (const r of data.records) if (new Date(r.t).getFullYear() === biggest[0]) yearShows.set(r.sh, (yearShows.get(r.sh) || 0) + r.min);
  const top = [...yearShows].sort((a, b) => b[1] - a[1]).map(([sh]) => sh);
  return `
    <div class="st-h2-icon"><span>${STATS_ICON_CLOCK}</span><h2 class="st-h2">When you <b>watched</b></h2></div>
    <div class="st-split-card">
      <div class="st-split-side">
        ${statsMosaic(top)}
        <div class="st-split-side-text">
          <div class="st-label">Your biggest year</div>
          <div class="st-split-big">${biggest[0]}</div>
          <span class="st-pill">${active >= 8 ? "LONG-HAULER" : "RISING STAR"}</span>
          <p>Your TV time spans ${active} active years, peaking in ${biggest[0]}.</p>
        </div>
      </div>
      <div class="st-split-main">
        <div class="st-card-meta">Watch time by viewing date · ${statsDur(total)} across ${active} years</div>
        <div class="st-two">
          <div><div class="st-label">Years</div>${statsBarList(yearRows, total)}</div>
          <div><div class="st-label">Last 12 months</div>${statsBarList(monthRows, total)}</div>
        </div>
      </div>
    </div>`;
}

// The ten shows with the most watch time - in the past year, or ever.
function statsTopTen(data, range) {
  let list;
  if (range === "year") {
    const by = new Map();
    for (const r of statsBetween(data, data.now - 365 * STATS_DAY_MS, data.now + 1)) {
      const x = by.get(r.sh) || { eps: 0, min: 0 };
      x.eps++; x.min += r.min; by.set(r.sh, x);
    }
    list = [...by].map(([sh, x]) => ({ sh, ...x }));
  } else {
    list = data.shows.filter(s => s.eps).map(sh => ({ sh, eps: sh.eps, min: sh.min }));
  }
  list.sort((a, b) => b.min - a.min);
  list = list.slice(0, 10);
  if (!list.length) return "";
  const [first, ...rest] = list;
  return `
    ${statsHead("", "Your most-watched shows", range === "year" ? "last 12 months" : "all time", "", `<span class="st-sub">By time spent watching</span>`)}
    <div class="st-top1" ${first.sh.backdrop ? `style="--bg:url('${first.sh.backdrop}')"` : ""}>
      <div class="st-top1-num">1</div>
      <div class="st-top1-text">
        <div class="st-label gold">Most time invested</div>
        <div class="st-top1-stats"><div><b>${statsNum(first.eps)}</b><small>EPISODES</small></div><div><b>${statsDur(first.min)}</b><small>TIME WATCHED</small></div></div>
        <div class="st-top1-title">${statsEsc(first.sh.title)}</div>
      </div>
      ${statsPoster(first.sh, "st-poster hero")}
    </div>
    <div class="st-top-grid">
      ${rest.map((x, i) => `
        <div class="st-top-card" ${x.sh.backdrop ? `style="--bg:url('${x.sh.backdrop.replace("w1280", "w780")}')"` : ""}>
          ${statsPoster(x.sh)}
          <div><b>${statsEsc(x.sh.title)}</b><small><b>${statsDur(x.min)}</b> · ${statsNum(x.eps)} eps</small></div>
          <span class="st-top-num">${i + 2}</span>
        </div>`).join("")}
    </div>`;
}

// How long the list of what's left takes, at your pace (last 90 days).
function statsRealityHtml(data, pace) {
  const queued = data.shows.filter(s => ["watching", "plantowatch", "hold"].includes(s.status) && s.remaining > 0);
  const left = queued.reduce((a, s) => a + s.remaining * s.runtime, 0);
  const days = pace > 0 ? left / (pace * 60) : Infinity;
  const clear = new Date(data.now + days * STATS_DAY_MS);
  const months = Math.round(days / 30.4);
  const lifetime = data.shows.reduce((a, s) => a + s.min, 0);
  return { queued, left, clear, months, lifetime, days };
}
function statsReality(data, pace) {
  const recent = statsBetween(data, data.now - 90 * STATS_DAY_MS, data.now + 1).reduce((a, r) => a + r.min, 0);
  const myPace = Math.max(0.1, Math.round((recent / 90 / 60) * 10) / 10);
  const p = pace || myPace;
  const r = statsRealityHtml(data, p);
  const by = { watching: 0, plantowatch: 0, hold: 0 };
  for (const s of r.queued) by[s.status] += s.remaining * s.runtime;
  if (!r.queued.length) return `<div class="st-eyebrow gold">Your watchlist reality check</div><h2 class="st-h2">Nothing left in the queue - <b>all caught up</b></h2>`;
  const segs = [["watching", "Watching"], ["plantowatch", "Plan to watch"], ["hold", "On hold"]]
    .filter(([k]) => by[k] > 0)
    .map(([k, name]) => `<div class="st-where ${k}" style="flex:${by[k]} 1 0" data-tip="${name} · ${statsDays(by[k])}"><small>${name}</small><b>${statsPct(by[k], r.left)}%</b><small>${statsDays(by[k])} · ${r.queued.filter(s => s.status === k).length} titles</small></div>`).join("");
  return `
    <div class="st-eyebrow gold">Your watchlist reality check</div>
    <h2 class="st-h2" id="stRealityHead">At your pace, the list takes <b>${r.months} month${r.months === 1 ? "" : "s"}</b> to clear</h2>
    <div class="st-card st-reality">
      <div class="st-reality-top">
        <div>
          <div class="st-label" id="stRealityPaceLabel">At ${pace ? "this" : "your"} pace, ${p} h/day, this clears</div>
          <div class="st-reality-date" id="stRealityDate">${isFinite(r.days) ? r.clear.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "never"}</div>
          <div><b>${statsDays(r.left)}</b> of runtime across <b>${r.queued.length} titles</b></div>
        </div>
        <div class="st-pace">
          <div class="st-pace-top"><span class="st-label">If you watched</span><b><span id="stPaceVal">${p}</span> h/day</b></div>
          <input type="range" id="stPace" min="0.5" max="8" step="0.1" value="${p}" data-my="${myPace}">
          <div class="st-pace-ticks"><span>0.5h</span><span>2h</span><span>4h</span><span>6h</span><span>8h</span></div>
          <small>Your pace · ${myPace} h (last 90 days). Drag to try another.</small>
        </div>
      </div>
      <div class="st-label">Where the time lives</div>
      <div class="st-wheres">${segs}</div>
      <div class="st-reality-foot">You've already watched ${statsDays(r.lifetime)} in your lifetime, ${(r.lifetime / Math.max(1, r.left)).toFixed(1)}× the size of this entire watchlist.</div>
    </div>`;
}

function statsRecent(data) {
  const seen = new Set();
  const list = [];
  for (let i = data.records.length - 1; i >= 0 && list.length < 14; i--) {
    const r = data.records[i];
    if (seen.has(r.sh)) continue;
    seen.add(r.sh);
    list.push(r);
  }
  return `
    <h2 class="st-h2 plain">Recently Watched</h2>
    <div class="st-recent">${list.map(r => `
      <div data-tip="${statsEsc(r.sh.title)} · ${statsDateShort(r.t)}">${statsPoster(r.sh, "st-poster tall")}<small>S${String(r.s).padStart(2, "0")} E${String(r.e).padStart(2, "0")}</small></div>`).join("")}</div>`;
}

// A light, fun read of the whole profile.
function statsViewerType(data) {
  const { shows } = data;
  const watched = shows.filter(s => s.eps);
  const total = watched.reduce((a, s) => a + s.min, 0);
  const genre = new Map();
  for (const s of watched) for (const g of s.genres) genre.set(g, (genre.get(g) || 0) + s.min / s.genres.length);
  const topGenre = [...genre].sort((a, b) => b[1] - a[1])[0];
  const completed = shows.filter(s => s.status === "completed").length;
  const started = shows.filter(s => s.status !== "plantowatch").length;
  const completion = statsPct(completed, started);
  const years = watched.filter(s => s.year);
  const avgYear = years.length ? Math.round(years.reduce((a, s) => a + s.year * s.min, 0) / Math.max(1, years.reduce((a, s) => a + s.min, 0))) : "—";
  const parked = shows.filter(s => s.status === "watching").length;
  const type = completion >= 60
    ? ["The Couch Commander", "Free evenings are overrated. You see things through - the longer the run, the better."]
    : ["The Channel Surfer", "Always something new on - you sample widely and keep your options open."];
  return `
    ${statsHead("", "Your viewer", "type", "")}
    <div class="st-type" ${watched[0] && data.topBackdrop ? `style="--bg:url('${data.topBackdrop}')"` : ""}>
      <div class="st-type-icon">${STATS_ICON_TV}</div>
      <div>
        <div class="st-eyebrow gold">Series, series, series</div>
        <div class="st-type-name">${type[0]}</div>
        <p>${type[1]}</p>
        <div class="st-type-stats">
          <div><b>${statsNum(total / 60 / Math.max(1, (data.now - (data.records[0] ? data.records[0].t : data.now)) / STATS_DAY_MS))}h</b><small>A DAY, ON AVERAGE</small></div>
          <div><b>${completion}%</b><small>SERIES COMPLETION</small></div>
          <div><b>${avgYear}</b><small>AVG RELEASE YEAR</small></div>
        </div>
      </div>
    </div>
    <div class="st-badges">
      ${topGenre ? `<div class="st-badge"><span>${STATS_ICON_STAR}</span><div><b>${statsEsc(topGenre[0])} lover</b><small>${statsPct(topGenre[1], total)}% of your time is ${statsEsc(topGenre[0])}</small></div></div>` : ""}
      <div class="st-badge violet"><span>${STATS_ICON_LAYERS}</span><div><b>Plate-Spinner</b><small>${parked} titles parked mid-watch</small></div></div>
      <div class="st-badge green"><span>${STATS_ICON_CLOCK}</span><div><b>Since ${data.records[0] ? new Date(data.records[0].t).getFullYear() : "—"}</b><small>${statsNum(data.records.length)} episodes with a date logged</small></div></div>
    </div>`;
}

// ---------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------
const STATS_ICON_TV = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>`;
const STATS_ICON_HOURGLASS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12M6 22h12M7 2c0 5 10 6 10 10S7 17 7 22M17 2c0 5-10 6-10 10s10 5 10 10"/></svg>`;
const STATS_ICON_LAYERS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
const STATS_ICON_CLOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const STATS_ICON_STAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/></svg>`;

let statsData = null;
async function openStatsPage() {
  if (!library || !library.store || !library.adapter || document.getElementById("statsPage")) return;
  const page = document.createElement("div");
  page.className = "stats-page";
  page.id = "statsPage";
  page.innerHTML = `
    <button type="button" class="st-close" id="statsCloseBtn" aria-label="Close">&times;</button>
    <div class="st-inner">
      <header class="st-hero">
        <div class="st-hero-word" aria-hidden="true">STATS</div>
        <div class="st-eyebrow center">Personal stats</div>
        <h1>All time</h1>
        <div class="st-sub">All time in review</div>
      </header>
      <div id="statsBody"><div class="st-loading"><div class="spinner"></div><div id="statsProgress">Gathering your shows…</div></div></div>
    </div>
    <div class="st-tip" id="statsTip" hidden></div>`;
  document.body.appendChild(page);
  document.body.classList.add("stats-open");
  pushModalHistoryState(closeStatsPage);
  document.getElementById("statsCloseBtn").onclick = closeStatsPage;
  document.addEventListener("keydown", statsEscHandler);
  statsWireTips(page);

  try {
    const progress = document.getElementById("statsProgress");
    statsData = await statsGather((done, total) => {
      if (progress && total > 20) progress.textContent = `Gathering show details… ${done}/${total}`;
    });
    if (!document.getElementById("statsPage")) return; // closed meanwhile
    const yearTop = statsData.shows.filter(s => s.backdrop).sort((a, b) => b.min - a.min)[0];
    statsData.topBackdrop = yearTop ? yearTop.backdrop : null;
    statsRender();
  } catch (err) {
    const body = document.getElementById("statsBody");
    if (body) body.innerHTML = `<div class="st-empty">Couldn't build your stats: ${statsEsc(err.message || err)}</div>`;
  }
}

const statsState = { month: "last", week: "last", genres: "items", networks: "items", binge: "year", pace: 0 };
function statsRender() {
  const body = document.getElementById("statsBody");
  if (!body || !statsData) return;
  const d = statsData;
  body.innerHTML = `
    ${statsOverview(d)}
    ${statsYearHeatmap(d)}
    ${statsWatchedTv(d)}
    <section class="st-section" data-st-part="month">${statsMonthRecap(d, statsState.month)}</section>
    <section class="st-section" data-st-part="week">${statsWeekRecap(d, statsState.week)}</section>
    <section class="st-section">${statsViewerType(d)}</section>
    <section class="st-section" data-st-part="genres">${statsGenres(d, statsState.genres)}</section>
    <section class="st-section">${statsWorld(d)}</section>
    <section class="st-section" data-st-part="binge">${statsBinges(d, statsState.binge)}</section>
    <section class="st-section" data-st-part="networks">${statsNetworks(d, statsState.networks)}</section>
    <section class="st-section">${statsHabits(d)}</section>
    <section class="st-section">${statsCameOut(d)}</section>
    <section class="st-section">${statsWhenWatched(d)}</section>
    <section class="st-section">${statsTopTen(d, "year")}</section>
    <section class="st-section">${statsTopTen(d, "all")}</section>
    <section class="st-section" data-st-part="reality">${statsReality(d, statsState.pace)}</section>
    <section class="st-section">${statsRecent(d)}</section>
    <footer class="st-credits">
      <div class="st-eyebrow center">End credits</div>
      <div class="st-credits-line"><b>Fade out.</b> The story's far from over.</div>
      <div class="st-sub">The page keeps counting. Come back anytime.</div>
    </footer>`;
  body.onclick = e => {
    const btn = e.target.closest("[data-st-toggle]");
    if (!btn) return;
    const group = btn.dataset.stToggle;
    statsState[group] = btn.dataset.value;
    const part = body.querySelector(`[data-st-part="${group}"]`);
    const render = { month: statsMonthRecap, week: statsWeekRecap, genres: statsGenres, networks: statsNetworks, binge: statsBinges }[group];
    if (part && render) part.innerHTML = render(statsData, statsState[group]);
  };
  statsWirePace();
}

function statsWirePace() {
  const input = document.getElementById("stPace");
  if (!input) return;
  input.oninput = () => {
    const p = Number(input.value);
    const r = statsRealityHtml(statsData, p);
    document.getElementById("stPaceVal").textContent = p.toFixed(1);
    document.getElementById("stRealityDate").textContent = r.clear.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    document.getElementById("stRealityPaceLabel").textContent = `At ${p.toFixed(1)} h/day, this clears`;
    document.getElementById("stRealityHead").innerHTML = `At ${Math.abs(p - Number(input.dataset.my)) < 0.05 ? "your" : "this"} pace, the list takes <b>${r.months} month${r.months === 1 ? "" : "s"}</b> to clear`;
  };
}

// One tooltip for the whole page: anything with data-tip.
function statsWireTips(page) {
  const tip = page.querySelector("#statsTip");
  page.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (!el) { tip.hidden = true; return; }
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
  });
  page.addEventListener("mousemove", e => {
    if (tip.hidden) return;
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14);
    tip.style.transform = `translate(${Math.max(8, x)}px, ${e.clientY + 16}px)`;
  });
  page.addEventListener("mouseleave", () => { tip.hidden = true; });
}

function statsEscHandler(e) {
  if (e.key === "Escape") closeStatsPage();
}
function closeStatsPage() {
  const page = document.getElementById("statsPage");
  if (!page) return;
  page.remove();
  document.body.classList.remove("stats-open");
  document.removeEventListener("keydown", statsEscHandler);
  consumeModalHistoryState();
}

document.getElementById("statsBtn").onclick = openStatsPage;
