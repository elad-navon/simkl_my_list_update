// Read-only migration preview: reads the whole library from SIMKL, maps
// every show and watched episode to TMDB / TVMaze, checks the new library
// rules (library-core.js) against what the site shows today, and reports
// every gap. It changes nothing anywhere: SIMKL calls are reads (the one
// POST, /sync/watched, is SIMKL's read-only "is this watched?" check, used
// only if a list is too big to fetch in one go), and nothing is written to
// localStorage or to a library. The two downloads are the only output.
"use strict";
(function () {
  const SIMKL_BASE = "https://api.simkl.com";
  const TMDB_BASE = "https://api.themoviedb.org/3";
  const STATUSES = LibraryCore.STATUSES;
  const ACTIVE = ["watching", "plantowatch", "hold"];
  const DAY = 86400000;
  const NOW = Date.now();
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STATUS_LABEL = { watching: "צפייה פעילה", plantowatch: "תוכניות לצפייה", hold: "בהמתנה", completed: "הושלמו", dropped: "ננטשו" };
  const SOURCE_LABEL = { tvmaze: "טיוי־מייז", tmdb: "טי־אם־די־בי", snapshot: "תמונת מצב מסימקל", none: "אין" };
  const code = (s, e) => LibraryCore.episodeCode(s, e);

  let rawLists = null;
  let report = null;
  let simklEpisodesStopped = null;

  // ---- Settings already stored by the main app (read only) -----------------
  function readConfig() {
    const clientIdV2 = localStorage.getItem("simkl_client_id_v2") || "";
    const clientIdV1 = localStorage.getItem("simkl_client_id") || "";
    const tmdbKey = localStorage.getItem("tmdb_api_key") || "";
    let token = null, expired = false;
    if (clientIdV2) {
      try {
        const auth = JSON.parse(localStorage.getItem("simkl_auth_v2") || "null");
        if (auth && auth.access) { token = auth.access; expired = !!auth.expiresAt && auth.expiresAt <= Date.now(); }
      } catch (e) { token = null; }
    } else {
      token = localStorage.getItem("simkl_access_token");
    }
    return { clientId: clientIdV2 || clientIdV1, token, expired, tmdbKey };
  }

  // ---- SIMKL (reads) --------------------------------------------------------
  let nextSimklAt = 0;
  async function simklRequest(cfg, method, path, params, body) {
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const at = Math.max(now, nextSimklAt);
      nextSimklAt = at + (method === "GET" ? 150 : 1100);
      if (at > now) await sleep(at - now);
      const qs = new URLSearchParams({ client_id: cfg.clientId, "app-name": "my-list-summary-web", "app-version": "1.0", ...(params || {}) });
      const res = await fetch(`${SIMKL_BASE}${path}?${qs}`, {
        method,
        headers: body ? { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" } : { Authorization: `Bearer ${cfg.token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) throw new Error("החיבור לסימקל פג. פתח פעם אחת את האתר הראשי כדי לחדש אותו, ואז הרץ שוב.");
      if (res.status === 404) return null;
      if (res.status === 429) {
        const info = await res.json().catch(() => null);
        if (info && info.error === "user_limit_exceeded") {
          const err = new Error("הגעת למכסה היומית של סימקל. היא מתאפסת בחצות לפי שעון החוף המזרחי בארה\"ב.");
          err.dailyLimit = true;
          throw err;
        }
        if (attempt < 2) { await sleep(2000 * 2 ** attempt); continue; }
      }
      if (res.status === 400) {
        const info = await res.json().catch(() => null);
        const err = new Error(`סימקל דחה את הבקשה (${(info && info.error) || 400})`);
        err.maxItems = !!info && info.error === "max_items";
        throw err;
      }
      if (!res.ok) throw new Error(`בקשה לסימקל נכשלה (${res.status})`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }
  const listItems = data => (Array.isArray(data) ? data : ((data && data.shows) || []));

  // One status list with every watched episode. If SIMKL says it's too big
  // for one answer, fall back to its read-only per-show watched check.
  async function fetchList(cfg, status) {
    const path = `/sync/all-items/shows/${status}`;
    try {
      const data = await simklRequest(cfg, "GET", path, { extended: "full", episode_watched_at: "yes", include_all_episodes: "original", episode_tvdb_id: "yes", memos: "yes" });
      return { data, mode: "full" };
    } catch (e) {
      if (!e.maxItems) throw e;
    }
    const data = await simklRequest(cfg, "GET", path, { extended: "full", memos: "yes" });
    const items = listItems(data);
    for (let i = 0; i < items.length; i += 100) {
      const batch = items.slice(i, i + 100);
      const res = await simklRequest(cfg, "POST", "/sync/watched", { extended: "episodes" },
        batch.map(it => ({ ids: { simkl: it.show.ids.simkl }, type: "show" })));
      for (const r of res || []) {
        const id = r.simkl != null ? r.simkl : (r.ids || {}).simkl;
        const it = batch.find(x => x.show.ids.simkl === id);
        if (!it || !r.seasons) continue;
        it.seasons = r.seasons.map(s => ({
          number: s.number,
          episodes: (s.episodes || []).filter(e => e.watched).map(e => ({ number: e.number, watched_at: e.last_watched_at || null })),
        })).filter(s => s.episodes.length);
      }
    }
    return { data, mode: "watched-check" };
  }

  // SIMKL's own episode list for a show (numbers, air dates, titles) - what
  // translates its numbering when another source numbers differently.
  async function simklEpisodes(cfg, simklId) {
    if (simklEpisodesStopped || !simklId) return null;
    try {
      const list = await simklRequest(cfg, "GET", `/tv/episodes/${simklId}`, { extended: "full" });
      return (list || []).filter(e => e.season != null && e.episode != null)
        .map(e => ({
          season: e.season, episode: e.episode, date: e.date || null, title: e.title || null,
          hasTime: !!e.date && e.date.length > 10, keys: [`simklep:${e.season}-${e.episode}`],
        }));
    } catch (e) {
      if (e.dailyLimit) { simklEpisodesStopped = e.message; return null; }
      throw e;
    }
  }

  // ---- TMDB (GET only, memoized per run) --------------------------------------
  const tmdbMemo = new Map();
  let nextTmdbAt = 0;
  function tmdbGet(path, params) {
    const key = path + "?" + new URLSearchParams(params || {});
    if (!tmdbMemo.has(key)) {
      tmdbMemo.set(key, (async () => {
        for (let attempt = 0; ; attempt++) {
          const now = Date.now();
          const at = Math.max(now, nextTmdbAt);
          nextTmdbAt = at + 30;
          if (at > now) await sleep(at - now);
          const qs = new URLSearchParams({ api_key: readConfig().tmdbKey, ...(params || {}) });
          const res = await fetch(`${TMDB_BASE}${path}?${qs}`);
          if (res.status === 404) return null;
          if (res.status === 429 && attempt < 3) { await sleep(1500 * 2 ** attempt); continue; }
          if (!res.ok) throw new Error(`טי־אם־די־בי (${res.status})`);
          return res.json();
        }
      })());
    }
    return tmdbMemo.get(key);
  }

  const source = EpisodeSource.createEpisodeSource({ fetch: (...a) => fetch(...a), tmdbGet, cache: EpisodeSource.memoryCache() });

  // ---- Helpers ------------------------------------------------------------------
  function parseCode(c) {
    const m = /S(\d+)E(\d+)/i.exec(c || "");
    return m ? { s: Number(m[1]), e: Number(m[2]) } : null;
  }
  const MAPPED = new Set(["number", "date", "title", "date-order", "season-match", "position"]);

  async function resolveTmdb(ids) {
    if (ids.tmdb) return { tmdbId: Number(ids.tmdb), method: "simkl" };
    if (ids.imdb) {
      const r = await tmdbGet(`/find/${encodeURIComponent(ids.imdb)}`, { external_source: "imdb_id" });
      const tv = r && r.tv_results && r.tv_results[0];
      if (tv) return { tmdbId: tv.id, method: "imdb" };
    }
    if (ids.tvdb) {
      const r = await tmdbGet(`/find/${encodeURIComponent(ids.tvdb)}`, { external_source: "tvdb_id" });
      const tv = r && r.tv_results && r.tv_results[0];
      if (tv) return { tmdbId: tv.id, method: "tvdb" };
    }
    return { tmdbId: null, method: "none" };
  }

  // ---- One show ---------------------------------------------------------------
  async function analyze(cfg, status, item) {
    const show = item.show || {};
    const ids = show.ids || {};
    const memoText = item.memo && item.memo.text ? item.memo.text : null;
    const rec = {
      status, simklId: ids.simkl || null, title: show.title || "Unknown", year: show.year || null,
      ids: { imdb: ids.imdb || null, tvdb: ids.tvdb || null, tmdb: ids.tmdb || null },
      personal: { addedAt: item.added_to_watchlist_at || null, userRating: item.user_rating ?? null, userRatedAt: item.user_rated_at || null, memo: memoText },
      tmdbId: null, idMethod: "none", uncertain: null, translatedName: null, issues: [],
      source: "none", pinnedToTmdb: false, episodes: 0, timed: 0, dateOnly: 0, noDate: 0,
      recentDisagreements: [], allDisagreements: 0,
      simklWatchedCount: item.watched_episodes_count ?? null, watchedRecorded: 0, watchedWithDate: 0,
      bulkMarked: 0, partial: false, methods: {}, unmapped: [], verifiedByDate: false,
      checks: [], info: [], airing: null,
    };

    try {
      const r = await resolveTmdb(ids);
      rec.tmdbId = r.tmdbId;
      rec.idMethod = r.method;
    } catch (e) { rec.issues.push(`חיפוש המזהה נכשל: ${e.message}`); }

    let detail = null;
    if (rec.tmdbId) {
      try { detail = await tmdbGet(`/tv/${rec.tmdbId}`); } catch (e) { rec.issues.push(`פרטי הסדרה לא נטענו: ${e.message}`); }
      if (!detail) rec.issues.push("המזהה לא קיים בטי־אם־די־בי");
    } else {
      rec.issues.push("אין מזהה בטי־אם־די־בי: תישמר תחת מזהה חלופי, בלי לאבד נתונים");
    }
    if (detail) {
      const tmdbYear = detail.first_air_date ? Number(detail.first_air_date.slice(0, 4)) : null;
      const titleOk = LibraryCore.titlesAgree(rec.title, detail.name) || LibraryCore.titlesAgree(rec.title, detail.original_name);
      const yearOk = !rec.year || !tmdbYear || Math.abs(rec.year - tmdbYear) <= 1;
      const reasons = [];
      if (rec.idMethod !== "simkl") reasons.push(rec.idMethod === "imdb" ? "המזהה נמצא דרך IMDb" : "המזהה נמצא דרך TheTVDB");
      if (!yearOk) reasons.push(`שנה בטי־אם־די־בי: ${tmdbYear}, השם שם: "${detail.name}"`);
      rec.uncertain = reasons.length ? reasons.join(", ") : null;
      if (!titleOk && yearOk) rec.translatedName = detail.name;
    }

    // Watched episodes as SIMKL records them.
    const watched = [];
    for (const s of item.seasons || []) {
      for (const e of s.episodes || []) {
        if (e.number != null) watched.push({ s: s.number, e: e.number, at: e.watched_at || null, tvdbId: (e.ids && e.ids.tvdb_id) || null });
      }
    }
    if (!watched.length && item.last_watched) {
      const p = parseCode(item.last_watched);
      if (p) { watched.push({ s: p.s, e: p.e, at: item.last_watched_at || null, partial: true }); rec.partial = true; }
    }
    const recordedRegular = watched.filter(w => !w.partial && w.s !== 0).length;
    rec.watchedRecorded = watched.filter(w => !w.partial).length;
    rec.watchedWithDate = watched.filter(w => w.at).length;
    if (rec.simklWatchedCount != null && recordedRegular < rec.simklWatchedCount && !rec.partial) {
      rec.bulkMarked = rec.simklWatchedCount - recordedRegular;
    }

    // Episode lists from both sources, then the one whose numbering fits
    // this show's history best.
    const idsForSource = { tmdb: rec.tmdbId, imdb: ids.imdb || null, tvdb: ids.tvdb || null };
    const lists = await source.getSourceLists(idsForSource);
    lists.errors.forEach(m => rec.issues.push(`מקור פרקים: ${m}`));
    const candidates = [];
    if (lists.tvmaze) candidates.push({ name: "tvmaze", res: await source.getEpisodes(idsForSource) });
    if (lists.tmdb) candidates.push({ name: "tmdb", res: await source.getEpisodes(idsForSource, { prefer: "tmdb" }) });

    const score = mapping => mapping.filter(m => MAPPED.has(m.method)).length;
    let oldEps = null;
    const firstPass = candidates.map(c => ({ c, mapping: LibraryCore.mapWatched(watched, c.res.episodes, null) }));
    const bestFirst = firstPass.sort((a, b) => score(b.mapping) - score(a.mapping))[0];
    const regularWatched = watched.filter(w => w.s !== 0).length;
    const needsDates = ACTIVE.includes(status) || !bestFirst ||
      score(bestFirst.mapping) < regularWatched ||
      (item.total_episodes_count != null && bestFirst.c.res.episodes.length !== item.total_episodes_count) ||
      candidates.some(c => c.res.disagreements.length);
    if (needsDates && candidates.length) {
      try { oldEps = await simklEpisodes(cfg, rec.simklId); } catch (e) { rec.issues.push(`רשימת הפרקים של סימקל לא נטענה: ${e.message}`); }
    }
    rec.verifiedByDate = !!oldEps;

    let chosen = null;
    for (const c of candidates) {
      const mapping = LibraryCore.mapWatched(watched, c.res.episodes, oldEps);
      const sc = score(mapping);
      if (!chosen || sc > chosen.score) chosen = { ...c, mapping, score: sc };
    }
    // When neither outside source covers the whole history, SIMKL's own
    // episode list is kept as a fixed snapshot for this show (upcoming
    // episodes still come from the best outside source).
    if (oldEps && oldEps.length && (!chosen || chosen.score < regularWatched)) {
      const filled = EpisodeSource.appendUpcoming(oldEps, chosen ? chosen.res.episodes : [], NOW, { afterBaseEnd: true });
      const res = { episodes: filled.episodes, disagreements: [], upcomingFromOther: filled.added };
      const mapping = LibraryCore.mapWatched(watched, res.episodes, oldEps);
      const sc = score(mapping);
      if (!chosen || sc > chosen.score) chosen = { name: "snapshot", res, mapping, score: sc };
    }
    if (!chosen) {
      rec.issues.push("אין רשימת פרקים לא בטיוי־מייז ולא בטי־אם־די־בי");
      return rec;
    }
    const eps = chosen.res.episodes;
    rec.source = chosen.name;
    rec.pinnedToTmdb = chosen.name === "tmdb" && !!lists.tvmaze;
    rec.episodes = eps.length;
    rec.timed = eps.filter(x => x.hasTime).length;
    rec.dateOnly = eps.filter(x => !x.hasTime && x.date).length;
    rec.noDate = eps.filter(x => !x.date).length;
    rec.allDisagreements = chosen.res.disagreements.length;
    rec.recentDisagreements = chosen.res.disagreements.filter(d =>
      [d.tvmaze, d.tmdb].some(x => x && Date.parse(x.slice(0, 10)) >= NOW - 60 * DAY));
    for (const m of chosen.mapping) rec.methods[m.method] = (rec.methods[m.method] || 0) + 1;
    rec.unmapped = chosen.mapping.filter(m => m.method === "unmapped" || m.method === "duplicate").map(m => code(m.w.s, m.w.e));
    if (rec.unmapped.length) rec.issues.push(`${rec.unmapped.length} פרקים שנצפו לא הותאמו: ${rec.unmapped.slice(0, 8).join(", ")}${rec.unmapped.length > 8 ? "…" : ""}`);
    if (rec.recentDisagreements.length) rec.issues.push(`${rec.recentDisagreements.length} פרקים מהזמן האחרון עם תאריך שונה בשני המקורות`);

    // The library show as the import would build it (in memory only).
    if (!rec.tmdbId) return rec;
    const lib = LibraryCore.createShow({ ids: { tmdb: rec.tmdbId }, title: rec.title, year: rec.year, status, now: NOW });
    for (const m of chosen.mapping) {
      if (m.method === "special") continue;
      if (m.ep) {
        const keys = m.w.tvdbId ? [...m.ep.keys, `tvdb:${m.w.tvdbId}`] : m.ep.keys;
        lib.watched[m.ep.keys[0]] = { s: m.ep.season, e: m.ep.episode, at: m.w.at, keys, partial: m.w.partial || undefined };
      } else {
        lib.watched[`num:${m.w.s}-${m.w.e}`] = { s: m.w.s, e: m.w.e, at: m.w.at, partial: m.w.partial || undefined };
      }
    }
    // Marked watched in one go: a completed show whose count equals its
    // total had every episode watched - recorded as such, with no date.
    // Anything less certain keeps SIMKL's count as a hint instead.
    if (status === "completed" && rec.bulkMarked && rec.simklWatchedCount === item.total_episodes_count) {
      const have = new Set(Object.values(lib.watched).map(r => `${r.s}-${r.e}`));
      for (const ep of eps) {
        if (!LibraryCore.isRegular(ep) || !LibraryCore.isAired(ep, NOW) || have.has(`${ep.season}-${ep.episode}`)) continue;
        lib.watched[ep.keys[0]] = { s: ep.season, e: ep.episode, at: null, keys: ep.keys, inferred: "completed" };
        rec.inferredEpisodes = (rec.inferredEpisodes || 0) + 1;
      }
      // The episode list may still have fewer episodes than SIMKL counted.
      lib.watchedCountHint = rec.simklWatchedCount;
    } else if (rec.partial || rec.bulkMarked) {
      lib.watchedCountHint = rec.simklWatchedCount;
      rec.countHint = true;
    }
    const d = LibraryCore.toSimklShape(lib, eps, NOW);

    // What the site shows today vs. what the new data would show.
    const avail = it => Math.max((it.total_episodes_count || 0) - (it.not_aired_episodes_count || 0), 0);
    const remaining = it => Math.max(avail(it) - (it.watched_episodes_count || 0), 0);
    const check = (field, simklVal, newVal) => rec.checks.push({ field, simkl: simklVal ?? null, derived: newVal ?? null, ok: (simklVal ?? null) === (newVal ?? null) });
    check("watched", item.watched_episodes_count, d.watched_episodes_count);
    check("available", avail(item), avail(d));
    if (status === "watching") {
      check("remaining", remaining(item), remaining(d));
      let simklNext = item.next_to_watch || null;
      const p = parseCode(simklNext);
      if (p) {
        const t = LibraryCore.mapWatched([{ s: p.s, e: p.e }], eps, oldEps)[0];
        if (t.ep) simklNext = code(t.ep.season, t.ep.episode);
      }
      check("next", simklNext, d.next_to_watch);
    }
    if ((item.total_episodes_count ?? null) !== d.total_episodes_count) rec.info.push({ field: "total", simkl: item.total_episodes_count, derived: d.total_episodes_count });
    if ((item.not_aired_episodes_count ?? null) !== d.not_aired_episodes_count) rec.info.push({ field: "notAired", simkl: item.not_aired_episodes_count, derived: d.not_aired_episodes_count });

    // Airing Next: the next episode to air, by SIMKL today and by the new source.
    if ((status === "watching" || status === "plantowatch") && oldEps) {
      let simklNext = null;
      for (const e of oldEps) {
        if (!e.season || !e.date) continue;
        const ts = Date.parse(e.date);
        if (!isNaN(ts) && ts > NOW && (!simklNext || ts < Date.parse(simklNext.date))) simklNext = e;
      }
      const mine = LibraryCore.nextUpcoming(eps, NOW);
      let ok;
      if (!simklNext || !mine) ok = !simklNext && !mine;
      else {
        const t = LibraryCore.mapWatched([{ s: simklNext.season, e: simklNext.episode }], eps, oldEps)[0];
        ok = !!t.ep && t.ep.season === mine.season && t.ep.episode === mine.episode && LibraryCore.dayDiff(simklNext.date, mine.date) <= 1;
      }
      rec.airing = {
        ok,
        simkl: simklNext ? `${code(simklNext.season, simklNext.episode)} ${simklNext.date.slice(0, 10)}` : "—",
        derived: mine ? `${code(mine.season, mine.episode)} ${mine.date.slice(0, 10)}` : "—",
      };
    }
    return rec;
  }

  // ---- Run ----------------------------------------------------------------------
  async function run() {
    $("error").textContent = "";
    $("report").innerHTML = "";
    simklEpisodesStopped = null;
    const cfg = readConfig();
    if (!cfg.clientId || !cfg.token) throw new Error("לא נמצא חיבור לסימקל בדפדפן הזה. פתח את הכלי באותו שרת מקומי שבו האתר מחובר.");
    if (cfg.expired) throw new Error("החיבור לסימקל פג. פתח פעם אחת את האתר הראשי כדי לחדש אותו, ואז הרץ שוב.");
    if (!cfg.tmdbKey) throw new Error("לא נמצא מפתח טי־אם־די־בי בדפדפן הזה.");

    rawLists = {};
    const listModes = {};
    const entries = [];
    for (const status of STATUSES) {
      $("progress").textContent = `קורא מסימקל את הרשימה: ${STATUS_LABEL[status]}…`;
      const { data, mode } = await fetchList(cfg, status);
      rawLists[status] = data;
      listModes[status] = mode;
      listItems(data).forEach(item => entries.push({ status, item }));
    }
    $("backupBtn").disabled = false;

    const records = new Array(entries.length);
    let done = 0, cursor = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const i = cursor++;
        const { status, item } = entries[i];
        try {
          records[i] = await analyze(cfg, status, item);
        } catch (e) {
          records[i] = { status, title: (item.show || {}).title || "Unknown", issues: [`הבדיקה נכשלה: ${e.message}`], checks: [], info: [], unmapped: [], methods: {}, recentDisagreements: [], personal: {} };
        }
        done++;
        $("progress").textContent = `בודק סדרות: ${done} מתוך ${entries.length} (טיוי־מייז מגביל את הקצב, זה לוקח כמה דקות)`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);

    report = buildReport(records, listModes);
    render(report);
    $("reportBtn").disabled = false;
    $("progress").textContent = `הבדיקה הסתיימה: ${entries.length} סדרות.`;
  }

  function buildReport(records, listModes) {
    const byTmdb = new Map(), bySimkl = new Map();
    records.forEach(r => {
      if (r.tmdbId) byTmdb.set(r.tmdbId, [...(byTmdb.get(r.tmdbId) || []), r]);
      if (r.simklId) bySimkl.set(r.simklId, [...(bySimkl.get(r.simklId) || []), r]);
    });
    const duplicates = [...new Set([...byTmdb.values(), ...bySimkl.values()].filter(g => g.length > 1)
      .map(g => g.map(r => `${r.title} (${STATUS_LABEL[r.status]})`).join(" / ")))];

    const sum = f => records.reduce((a, r) => a + (f(r) || 0), 0);
    const method = m => sum(r => (r.methods || {})[m]);
    const checkStats = field => {
      const all = records.flatMap(r => (r.checks || []).filter(c => c.field === field));
      return { compared: all.length, match: all.filter(c => c.ok).length };
    };
    const airing = records.filter(r => r.airing);
    return {
      summary: {
        generatedAt: new Date(NOW).toISOString(),
        listModes,
        simklEpisodesStopped,
        shows: records.length,
        byStatus: Object.fromEntries(STATUSES.map(s => [s, records.filter(r => r.status === s).length])),
        personal: {
          rated: records.filter(r => r.personal && r.personal.userRating != null).length,
          withMemo: records.filter(r => r.personal && r.personal.memo).length,
          withAddedDate: records.filter(r => r.personal && r.personal.addedAt).length,
        },
        watched: {
          simklCount: sum(r => r.simklWatchedCount),
          recorded: sum(r => r.watchedRecorded),
          withDate: sum(r => r.watchedWithDate),
          bulkMarkedShows: records.filter(r => r.bulkMarked).length,
          bulkMarkedEpisodes: sum(r => r.bulkMarked),
          inferredCompletedShows: records.filter(r => r.inferredEpisodes).length,
          inferredEpisodes: sum(r => r.inferredEpisodes),
          countHintShows: records.filter(r => r.countHint).length,
          partialShows: records.filter(r => r.partial).length,
        },
        ids: {
          fromSimkl: records.filter(r => r.idMethod === "simkl").length,
          foundOther: records.filter(r => r.idMethod === "imdb" || r.idMethod === "tvdb").length,
          unresolved: records.filter(r => !r.tmdbId).length,
          uncertain: records.filter(r => r.uncertain).length,
          translatedNames: records.filter(r => r.translatedName).length,
          duplicates: duplicates.length,
        },
        mapping: {
          byNumber: method("number"), byDate: method("date"), byTitle: method("title"), byDayOrder: method("date-order"),
          bySeasonMatch: method("season-match"), byPosition: method("position"),
          unmapped: method("unmapped"), duplicates: method("duplicate"), specials: method("special"),
          verifiedByDateShows: records.filter(r => r.verifiedByDate).length,
        },
        sources: {
          tvmaze: records.filter(r => r.source === "tvmaze").length,
          tmdb: records.filter(r => r.source === "tmdb").length,
          pinnedToTmdb: records.filter(r => r.pinnedToTmdb).length,
          snapshot: records.filter(r => r.source === "snapshot").length,
          none: records.filter(r => r.source === "none").length,
          withTimes: records.filter(r => r.source === "tvmaze" && r.timed > 0).length,
          recentDisagreements: sum(r => (r.recentDisagreements || []).length),
        },
        checks: {
          watched: checkStats("watched"), available: checkStats("available"),
          remaining: checkStats("remaining"), next: checkStats("next"),
          airing: { compared: airing.length, match: airing.filter(r => r.airing.ok).length },
        },
        info: {
          totalDiffers: records.filter(r => (r.info || []).some(i => i.field === "total")).length,
          notAiredDiffers: records.filter(r => (r.info || []).some(i => i.field === "notAired")).length,
        },
      },
      duplicates,
      shows: records,
    };
  }

  // ---- Render ---------------------------------------------------------------------
  function stat(n, label, cls) {
    return `<div class="stat"><div class="n ${cls || ""}">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
  }
  function rate(s) {
    if (!s.compared) return "—";
    return `${s.match}/${s.compared} (${Math.round((s.match / s.compared) * 100)}%)`;
  }
  const cls = (n, bad) => (n ? (bad ? "bad" : "warn") : "ok");
  const FIELD_LABEL = { watched: "פרקים שנצפו", available: "פרקים ששודרו", remaining: "פרקים שנשארו", next: "הפרק הבא לצפייה" };

  function render(rep) {
    const s = rep.summary;
    const shows = rep.shows;
    const html = [];
    if (s.simklEpisodesStopped) html.push(`<p class="bad">${esc(s.simklEpisodesStopped)} חלק מהסדרות לא אומתו לפי תאריך.</p>`);
    const fallbackLists = Object.entries(s.listModes).filter(([, m]) => m !== "full").map(([st]) => STATUS_LABEL[st]);
    if (fallbackLists.length) html.push(`<p class="warn">רשימות שנקראו בדרך החלופית, כי היו גדולות מדי: ${esc(fallbackLists.join(", "))}</p>`);

    html.push(`<h2>סיכום</h2><div class="grid">
      ${stat(s.shows, "סדרות בסך הכל")}
      ${STATUSES.map(st => stat(s.byStatus[st], STATUS_LABEL[st])).join("")}
    </div>`);

    html.push(`<h2>היסטוריית צפייה</h2><div class="grid">
      ${stat(s.watched.simklCount, "פרקים שנצפו, לפי המונה של סימקל")}
      ${stat(s.watched.recorded, "פרקים שנצפו, מפורטים אחד אחד")}
      ${stat(s.watched.withDate, "פרקים עם תאריך צפייה")}
      ${stat(s.watched.bulkMarkedShows, `סדרות שסומנו כנצפו בבת אחת (${s.watched.bulkMarkedEpisodes} פרקים בלי פירוט)`, s.watched.bulkMarkedShows ? "warn" : "ok")}
      ${stat(s.watched.inferredCompletedShows, `מתוכן הושלמו במלואן: ${s.watched.inferredEpisodes} פרקים יסומנו כנצפו, בלי תאריך`)}
      ${stat(s.watched.countHintShows, "סדרות שבהן יישמר רק המונה של סימקל", cls(s.watched.countHintShows))}
      ${stat(s.watched.partialShows, "סדרות שידוע עליהן רק הפרק האחרון", cls(s.watched.partialShows))}
    </div>`);

    html.push(`<h2>נתונים אישיים שיישמרו</h2><div class="grid">
      ${stat(s.personal.rated, "סדרות עם דירוג שלך")}
      ${stat(s.personal.withMemo, "סדרות עם הערה שלך")}
      ${stat(s.personal.withAddedDate, "סדרות עם תאריך הוספה")}
    </div>`);

    html.push(`<h2>זיהוי הסדרות</h2><div class="grid">
      ${stat(s.ids.fromSimkl, "המזהה הגיע מסימקל", "ok")}
      ${stat(s.ids.foundOther, "המזהה נמצא בדרך אחרת", cls(s.ids.foundOther))}
      ${stat(s.ids.unresolved, "בלי מזהה (יישמרו תחת מזהה חלופי)", cls(s.ids.unresolved))}
      ${stat(s.ids.uncertain, "התאמות לבדיקה (שנה שונה או מזהה עקיף)", cls(s.ids.uncertain))}
      ${stat(s.ids.translatedNames, "שם מתורגם בלבד (אותו מזהה כמו היום)")}
      ${stat(s.ids.duplicates, "כפילויות אפשריות", cls(s.ids.duplicates))}
    </div>`);

    html.push(`<h2>התאמת פרקים שנצפו</h2><div class="grid">
      ${stat(s.mapping.byNumber, "לפי מספר, והתאריך תואם", "ok")}
      ${stat(s.mapping.byDate, "לפי תאריך שידור", "ok")}
      ${stat(s.mapping.byTitle, "לפי שם הפרק", "ok")}
      ${stat(s.mapping.byDayOrder, "לפי הסדר באותו יום", "ok")}
      ${stat(s.mapping.bySeasonMatch, "לפי מספר, כשהעונה זהה בגודלה", "ok")}
      ${stat(s.mapping.byPosition, "לפי המיקום בסדרה, כשהחלוקה לעונות שונה", "ok")}
      ${stat(s.mapping.unmapped + s.mapping.duplicates, "לא הותאמו (יישמרו כמו שהם)", cls(s.mapping.unmapped + s.mapping.duplicates, true))}
      ${stat(s.mapping.specials, "ספיישלים (יישמרו, לא נספרים)")}
      ${stat(s.mapping.verifiedByDateShows, "סדרות שאומתו גם לפי תאריך")}
    </div>`);

    html.push(`<h2>מקור הפרקים שנבחר</h2><div class="grid">
      ${stat(s.sources.tvmaze, "טיוי־מייז")}
      ${stat(s.sources.withTimes, "מתוכן עם שעת שידור מדויקת", "ok")}
      ${stat(s.sources.tmdb, "טי־אם־די־בי (תאריך בלבד)")}
      ${stat(s.sources.pinnedToTmdb, "מתוכן נבחרו כי המספור שלהן מתאים יותר")}
      ${stat(s.sources.snapshot, "תמונת מצב מסימקל (המקורות החיצוניים חסרים פרקים)", cls(s.sources.snapshot))}
      ${stat(s.sources.none, "בלי רשימת פרקים", cls(s.sources.none, true))}
      ${stat(s.sources.recentDisagreements, "פרקים מהזמן האחרון עם תאריך שונה בשני המקורות", cls(s.sources.recentDisagreements))}
    </div>`);

    html.push(`<h2>השוואה למה שהאתר מציג היום</h2><div class="grid">
      ${["watched", "available", "remaining", "next"].map(f => stat(rate(s.checks[f]), FIELD_LABEL[f])).join("")}
      ${stat(rate(s.checks.airing), "הפרק הבא לשידור (קוביית הפרקים הקרובים)")}
    </div>
    <p class="lead">לידיעה בלבד, בלי השפעה על המסך: סך הפרקים שונה ב־${esc(s.info.totalDiffers)} סדרות, ומספר הפרקים שעוד לא שודרו שונה ב־${esc(s.info.notAiredDiffers)}. אלה בעיקר פרקים עתידיים שסימקל כבר מכיר.</p>`);

    const failed = shows.flatMap(r => (r.checks || []).filter(c => !c.ok).map(c => ({ r, label: FIELD_LABEL[c.field], a: c.simkl, b: c.derived })))
      .concat(shows.filter(r => r.airing && !r.airing.ok).map(r => ({ r, label: "הפרק הבא לשידור", a: r.airing.simkl, b: r.airing.derived })));
    if (failed.length) {
      html.push(`<div class="card"><table><thead><tr><th>סדרה</th><th>סטטוס</th><th>מה</th><th>היום</th><th>אחרי המעבר</th></tr></thead><tbody>
        ${failed.map(x => `<tr><td>${esc(x.r.title)}</td><td>${esc(STATUS_LABEL[x.r.status])}</td><td>${esc(x.label)}</td><td class="ltr">${esc(x.a)}</td><td class="ltr">${esc(x.b)}</td></tr>`).join("")}
      </tbody></table></div>`);
    }

    if (rep.duplicates.length) html.push(`<h2>כפילויות אפשריות</h2><div class="card"><ul class="issues">${rep.duplicates.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>`);

    const attention = shows.filter(r => r.issues.length || r.uncertain);
    html.push(`<h2>סדרות שדורשות תשומת לב (${attention.length})</h2>`);
    if (attention.length) {
      html.push(`<div class="card"><table><thead><tr><th>סדרה</th><th>סטטוס</th><th>מה נמצא</th></tr></thead><tbody>
        ${attention.map(r => `<tr><td>${esc(r.title)}${r.year ? ` (${esc(r.year)})` : ""}</td><td>${esc(STATUS_LABEL[r.status])}</td><td><ul class="issues">
          ${r.uncertain ? `<li class="warn">לבדיקה: ${esc(r.uncertain)}</li>` : ""}
          ${r.issues.map(i => `<li>${esc(i)}</li>`).join("")}
        </ul></td></tr>`).join("")}
      </tbody></table></div>`);
    } else {
      html.push(`<p class="ok">לא נמצאו בעיות.</p>`);
    }

    html.push(`<h2>כל הסדרות</h2><details class="card"><summary>הצגת הטבלה המלאה (${shows.length})</summary><table><thead><tr>
      <th>סדרה</th><th>סטטוס</th><th>מקור</th><th>פרקים (עם שעה / תאריך בלבד)</th><th>נצפו (מפורט / מונה סימקל)</th></tr></thead><tbody>
      ${shows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(STATUS_LABEL[r.status])}</td><td>${esc(SOURCE_LABEL[r.source] || r.source)}${r.pinnedToTmdb ? " ★" : ""}</td><td class="ltr">${esc(r.episodes)} (${esc(r.timed)} / ${esc(r.dateOnly)})</td><td class="ltr">${esc(r.watchedRecorded)} / ${esc(r.simklWatchedCount ?? "—")}</td></tr>`).join("")}
    </tbody></table></details>`);

    $("report").innerHTML = html.join("\n");
  }

  // ---- Downloads ------------------------------------------------------------------
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  $("runBtn").addEventListener("click", async () => {
    $("runBtn").disabled = true;
    try { await run(); } catch (e) { $("error").textContent = e.message; $("progress").textContent = ""; }
    $("runBtn").disabled = false;
  });
  $("backupBtn").addEventListener("click", () => {
    download(`simkl-backup-${stamp()}.json`, {
      exportedAt: new Date().toISOString(),
      source: "SIMKL /sync/all-items/shows/{status}?extended=full&episode_watched_at=yes&include_all_episodes=original&episode_tvdb_id=yes&memos=yes",
      lists: rawLists,
    });
  });
  $("reportBtn").addEventListener("click", () => download(`migration-report-${stamp()}.json`, report));
})();
