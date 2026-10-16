// Fake world for tests/compare-modes.harness.html: one set of synthetic
// shows, served the way the library + TMDB + TVMaze serve it (and, for the
// auto-marking bridge, the way SIMKL reports changes), with no real
// network. Loaded into the page before app.js; window.__BASE fixes "now"
// for the dates, so every run sees the same data. (The SIMKL list answers
// are what tests/golden/panels.json was taken from, while the site could
// still read SIMKL.)
(function () {
  "use strict";
  const BASE = window.__BASE;
  const DAY = 86400000;
  const midnight = (() => { const d = new Date(BASE); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  // Day offsets from today, at 21:00 local time.
  const stamp = day => new Date(midnight + day * DAY + 21 * 3600000).toISOString();
  const localDate = iso => { if (!iso) return null; const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // season(n, count, firstDay, everyDays)
  const season = (n, count, first, every = 7) => Array.from({ length: count }, (_, i) => ({ season: n, number: i + 1, day: first + i * every }));

  // watched: [season, episode, watchedDay]
  const SHOWS = [
    { title: "Alpha", simkl: 11, tmdb: 101, tvmaze: 1001, status: "watching", ended: false,
      eps: [...season(1, 10, -140), ...season(2, 8, -16)],
      watched: [...Array.from({ length: 10 }, (_, i) => [1, i + 1, -130 + i * 7]), [2, 1, -8]] },
    { title: "Bravo", simkl: 12, tmdb: 102, tvmaze: 1002, status: "watching", ended: false,
      eps: season(1, 8, -34), watched: [1, 2, 3, 4, 5].map(e => [1, e, -34 + (e - 1) * 7 + 1]) },
    { title: "Charlie", simkl: 13, tmdb: 103, tvmaze: 1003, status: "watching", ended: true,
      eps: [...season(1, 10, -900), ...season(2, 10, -500)], watched: [1, 2, 3, 4, 5].map(e => [1, e, -6 + e]) },
    { title: "Hotel", simkl: 18, tmdb: 108, tvmaze: 1008, status: "watching", ended: false,
      eps: season(1, 6, -1), watched: [] },
    { title: "Delta", simkl: 14, tmdb: 104, tvmaze: 1004, status: "plantowatch", ended: false,
      eps: season(1, 6, 10), watched: [] },
    { title: "Echo", simkl: 15, tmdb: 105, tvmaze: 1005, status: "plantowatch", ended: true,
      eps: [...season(1, 12, -1500), ...season(2, 12, -1100)], watched: [] },
    { title: "Foxtrot", simkl: 16, tmdb: 106, tvmaze: 1006, status: "dropped", ended: true,
      eps: season(1, 10, -200), watched: [[1, 1, -5], [1, 2, -4], [1, 3, -3]] },
    { title: "Golf", simkl: 17, tmdb: 107, tvmaze: 1007, status: "completed", ended: true,
      eps: season(1, 5, -400), watched: [1, 2, 3, 4, 5].map(e => [1, e, -380 + e]) },
  ];
  // Only for the write checks (?scenario=writes): a just-premiered Plan to
  // Watch show (moves to Watching on its own) and one that isn't in the
  // library yet (added from search).
  if (window.__SCENARIO === "writes") {
    SHOWS.push(
      { title: "Juliet", simkl: 19, tmdb: 109, tvmaze: 1009, status: "plantowatch", ended: false, eps: season(1, 8, -2), watched: [] },
      { title: "India", simkl: 20, tmdb: 110, tvmaze: 1010, status: null, ended: true, eps: season(1, 6, -300), watched: [] },
    );
  }
  // ?scenario=onair: Kilo airs right now (45 minutes long, started 44 minutes
  // ago - it ends a minute in), Lima starts 40 seconds in (a one-minute
  // episode, over 100 seconds in), Mike in 5h 20m.
  // The page refreshes itself as each starts or ends.
  // `at`: an exact air time, as an offset from BASE in ms.
  // ?scenario=ui: Oscar's first season has no air dates anywhere (all
  // watched) - the episodes manager must still count it as aired.
  if (window.__SCENARIO === "ui") {
    SHOWS.push({ title: "Oscar", simkl: 24, tmdb: 114, tvmaze: 1014, status: "watching", ended: false,
      eps: [...season(1, 3, -900).map(e => ({ ...e, undated: true })), ...season(2, 3, -10)],
      watched: [[1, 1, -20], [1, 2, -19], [1, 3, -18], [2, 1, -9]] },
      // Clean-up candidates: Papa ended and is fully watched (-> Completed);
      // Quebec has episodes left but was last watched two years ago (-> On Hold).
      { title: "Papa", simkl: 25, tmdb: 115, tvmaze: 1015, status: "watching", ended: true,
        eps: season(1, 4, -300), watched: [1, 2, 3, 4].map(e => [1, e, -290 + e]) },
      { title: "Quebec", simkl: 26, tmdb: 116, tvmaze: 1016, status: "watching", ended: false,
        eps: season(1, 6, -800), watched: [[1, 1, -790], [1, 2, -783]] },
      // Romeo: fully watched two years ago, still running (on a long break):
      // never suggested - a new season may come.
      { title: "Romeo", simkl: 27, tmdb: 117, tvmaze: 1017, status: "watching", ended: false,
        eps: season(1, 3, -760), watched: [1, 2, 3].map(e => [1, e, -740 + e]) });
  }
  if (window.__SCENARIO === "onair") {
    const ep = (number, x) => ({ season: 1, number, ...x });
    SHOWS.push(
      { title: "Kilo", simkl: 21, tmdb: 111, tvmaze: 1011, status: "watching", ended: false,
        eps: [ep(1, { day: -7 }), ep(2, { at: -44 * 60000 }), ep(3, { day: 6 })], watched: [[1, 1, -6]] },
      { title: "Lima", simkl: 22, tmdb: 112, tvmaze: 1012, status: "watching", ended: false,
        eps: [ep(1, { day: -7 }), ep(2, { at: 40000, runtime: 1 }), ep(3, { day: 7 })], watched: [[1, 1, -6]] },
      { title: "Mike", simkl: 23, tmdb: 113, tvmaze: 1013, status: "watching", ended: false,
        eps: [ep(1, { day: -7 }), ep(2, { at: (5 * 60 + 20) * 60000 }), ep(3, { day: 8 })], watched: [[1, 1, -6]] },
    );
  }
  // ?scenario=airtimes: episodes TVMaze knows only the date of, and the
  // time SIMKL gives each (`simklDate`): November's real time 3 hours in
  // (taken), Sierra's midnight in SIMKL's timezone ("some time that day" -
  // not taken), Tango's two days off the known date (a disagreement - not
  // taken).
  if (window.__SCENARIO === "airtimes") {
    const ep = (number, x) => ({ season: 1, number, ...x });
    SHOWS.push(
      { title: "November", simkl: 28, tmdb: 118, tvmaze: 1018, status: "watching", ended: false,
        eps: [ep(1, { day: -7 }), ep(2, { day: 0, dateOnly: true, simklDate: new Date(BASE + 3 * 3600000).toISOString() }), ep(3, { day: 7, dateOnly: true })],
        watched: [[1, 1, -6]] },
      { title: "Sierra", simkl: 29, tmdb: 119, tvmaze: 1019, status: "watching", ended: false,
        eps: [ep(1, { day: -7 }), ep(2, { day: 0, dateOnly: true, simklDate: `${localDate(stamp(0))}T00:00:00-04:00` })],
        watched: [[1, 1, -6]] },
      { title: "Tango", simkl: 30, tmdb: 120, tvmaze: 1020, status: "watching", ended: false,
        eps: [ep(1, { day: -7 }), ep(2, { day: 1, dateOnly: true, simklDate: `${localDate(stamp(3))}T21:00:00-04:00` })],
        watched: [[1, 1, -6]] },
    );
  }
  // ?scenario=order: My List's order. Uno was already waiting (S01E02 out
  // ten days ago) when S01E03 came out two hours ago - it stays put; Dos had
  // nothing to watch until its S01E02 came out three hours ago - it comes
  // first.
  if (window.__SCENARIO === "order") {
    const ep = (number, x) => ({ season: 1, number, ...x });
    SHOWS.push(
      { title: "Uno", simkl: 31, tmdb: 121, tvmaze: 1021, status: "watching", ended: false,
        eps: [ep(1, { day: -20 }), ep(2, { day: -10 }), ep(3, { at: -2 * 3600000 })], watched: [[1, 1, -15]] },
      { title: "Dos", simkl: 32, tmdb: 122, tvmaze: 1022, status: "watching", ended: false,
        eps: [ep(1, { day: -20 }), ep(2, { at: -3 * 3600000 })], watched: [[1, 1, -19]] },
    );
  }
  for (const s of SHOWS) {
    s.imdb = `tt${s.tmdb}`;
    s.tvdb = 9000 + s.tmdb;
    s.year = new Date(stamp(s.eps[0].day)).getFullYear();
    for (const e of s.eps) { e.airstamp = e.undated ? null : e.at != null ? new Date(BASE + e.at).toISOString() : stamp(e.day); e.id = s.tvmaze * 1000 + e.season * 100 + e.number; e.name = `${s.title} ${e.season}x${e.number}`; }
  }
  const code = (s, e) => `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;

  // ---- The old service's view (SIMKL) -------------------------------------
  function simklItem(s) {
    const now = Date.now();
    const watched = s.watched.map(([se, ep, day]) => ({ se, ep, at: stamp(day) }));
    const isW = (se, ep) => watched.some(w => w.se === se && w.ep === ep);
    const aired = s.eps.filter(e => Date.parse(e.airstamp) <= now);
    let last = null;
    for (const w of watched) if (!last || w.se > last.se || (w.se === last.se && w.ep > last.ep)) last = w;
    const after = aired.filter(e => !last || e.season > last.se || (e.season === last.se && e.number > last.ep));
    const next = after.find(e => !isW(e.season, e.number));
    const lastByTime = watched.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    const item = {
      show: { title: s.title, year: s.year, runtime: 45, ids: { simkl: s.simkl, tmdb: String(s.tmdb), imdb: s.imdb, tvdb: String(s.tvdb) } },
      status: s.status,
      watched_episodes_count: watched.length,
      total_episodes_count: s.eps.length,
      not_aired_episodes_count: s.eps.length - aired.length,
      last_watched_at: lastByTime ? lastByTime.at : null,
      last_watched: lastByTime ? code(lastByTime.se, lastByTime.ep) : null,
    };
    if (s.status === "watching") {
      item.next_to_watch = next ? code(next.season, next.number) : null;
      const bySeason = new Map();
      for (const w of watched) {
        if (!bySeason.has(w.se)) bySeason.set(w.se, []);
        bySeason.get(w.se).push({ number: w.ep, watched_at: w.at });
      }
      item.seasons = [...bySeason].map(([number, episodes]) => ({ number, episodes }));
    }
    return item;
  }

  // ---- The new mode's view (library + TMDB + TVMaze) ----------------------
  function libraryDoc(s) {
    const watched = {};
    for (const [se, ep, day] of s.watched) {
      const e = s.eps.find(x => x.season === se && x.number === ep);
      watched[`tvmaze:${e.id}`] = { s: se, e: ep, at: stamp(day), keys: [`tvmaze:${e.id}`] };
    }
    const at = stamp(-1000);
    return {
      schemaVersion: 1, rev: 1, updatedAt: at,
      ids: { tmdb: s.tmdb, imdb: s.imdb, tvdb: s.tvdb, tvmaze: null, simklLegacy: s.simkl },
      idsVerified: true, title: s.title, year: s.year, status: s.status,
      addedAt: at, statusChangedAt: at, watched, unmappedWatched: [],
      ...(window.__SCENARIO === "bridge" ? { importedAt: new Date(BASE - 2 * 3600000).toISOString() } : {}),
    };
  }
  window.__libraryDocs = Object.fromEntries(SHOWS.filter(s => s.status).map(s => [String(s.tmdb), libraryDoc(s)]));

  function tmdbShow(s) {
    const first = s.eps[0], lastEp = s.eps[s.eps.length - 1];
    return {
      id: s.tmdb, name: s.title, original_name: s.title,
      first_air_date: localDate(first.airstamp), last_air_date: localDate(lastEp.airstamp),
      status: s.ended ? "Ended" : "Returning Series",
      seasons: [...new Set(s.eps.map(e => e.season))].map(n => ({ season_number: n })),
      networks: [{ name: "Network", logo_path: null }],
      images: { posters: [], backdrops: [] },
      external_ids: { imdb_id: s.imdb, tvdb_id: s.tvdb },
      vote_average: 7.5, episode_run_time: [45], content_ratings: { results: [] }, genres: [{ name: "Drama" }],
    };
  }

  // ---- Fake network ---------------------------------------------------------
  const calls = window.__calls = [];
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  const byTmdb = id => SHOWS.find(s => String(s.tmdb) === String(id));
  window.fetch = function (input) {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push(`${url.host}${url.pathname}`);
    const p = url.pathname;
    let m;
    if (url.host === "api.simkl.com") {
      if ((m = /^\/sync\/all-items\/shows\/(\w+)$/.exec(p))) return json(SHOWS.filter(s => s.status === m[1]).map(simklItem));
      if ((m = /^\/tv\/episodes\/(\d+)$/.exec(p))) {
        const s = SHOWS.find(x => String(x.simkl) === m[1]);
        return json(s.eps.map(e => ({ type: "episode", season: e.season, episode: e.number, date: e.simklDate || e.airstamp, title: e.name })));
      }
      if (/^\/tv\/\d+$/.test(p)) return json({});
      // ?scenario=bridge: Emby marked Alpha S02E02 watched on SIMKL an hour ago.
      if (window.__SCENARIO === "bridge") {
        const alpha = SHOWS.find(x => x.title === "Alpha");
        if (p === "/sync/activities") return json({ all: new Date(BASE).toISOString(), tv_shows: { all: new Date(BASE).toISOString() } });
        if (p === "/sync/all-items/shows") {
          const it = simklItem(alpha);
          it.seasons.find(x => x.number === 2).episodes.push({ number: 2, watched_at: new Date(BASE - 3600000).toISOString() });
          return json([it]);
        }
      }
      return json({ error: "unexpected" }, 500);
    }
    if (url.host === "api.themoviedb.org") {
      if ((m = /^\/3\/tv\/(\d+)$/.exec(p))) return byTmdb(m[1]) ? json(tmdbShow(byTmdb(m[1]))) : json(null, 404);
      if ((m = /^\/3\/tv\/(\d+)\/season\/(\d+)$/.exec(p))) {
        const s = byTmdb(m[1]);
        return json({ episodes: s.eps.filter(e => e.season === Number(m[2])).map(e => ({ id: e.id + 500000, episode_number: e.number, air_date: localDate(e.airstamp), name: e.name, runtime: 45 })) });
      }
      if (p === "/3/search/tv") {
        const q = (url.searchParams.get("query") || "").toLowerCase();
        return json({ results: SHOWS.filter(x => x.title.toLowerCase().includes(q)).map(x => ({ id: x.tmdb, name: x.title, first_air_date: localDate(x.eps[0].airstamp), poster_path: null })) });
      }
      return json(null, 404);
    }
    if (url.host === "api.tvmaze.com") {
      if (p === "/lookup/shows") {
        const s = SHOWS.find(x => x.imdb === url.searchParams.get("imdb"));
        return s ? json({ id: s.tvmaze, name: s.title }) : json(null, 404);
      }
      if ((m = /^\/shows\/(\d+)\/episodes$/.exec(p))) {
        const s = SHOWS.find(x => String(x.tvmaze) === m[1]);
        return json(s.eps.map(e => ({ id: e.id, season: e.season, number: e.number, name: e.name, airdate: localDate(e.airstamp) || "", airtime: e.airstamp && !e.dateOnly ? "21:00" : "", airstamp: e.airstamp, runtime: e.runtime || 45 })));
      }
      if (p === "/updates/shows") return json({});
      return json(null, 404);
    }
    return json(null, 404);
  };

  // ---- Fake database (in place of Firebase) --------------------------------
  let signedIn = true;
  const user = { uid: "test", email: "test@example.com" };
  // ?scenario=nowwatching: Alpha's next episode (S02E02) playing on Emby,
  // Charlie's (S01E06) open but paused; Hotel's (S01E01) only stopped
  // partway some other time (an old-style resume entry - not shown).
  const embyMeta = window.__SCENARIO === "nowwatching" ? {
    updatedAt: new Date(BASE).toISOString(),
    playing: [{ docId: "101", tmdb: 101, s: 2, e: 2, pos: 23 * 60, len: 45 * 60 },
      { docId: "103", tmdb: 103, s: 1, e: 6, pos: 12 * 60, len: 45 * 60, paused: true }],
    resume: [{ docId: "108", tmdb: 108, s: 1, e: 1, pos: 5 * 60, len: 45 * 60 }],
  } : null;
  window.__fakeFirebaseCreate = () => Object.assign(LibraryStore.memoryBackend(window.__libraryDocs), {
    watchMeta(name, cb) { setTimeout(() => cb(name === "emby" ? embyMeta : null), 0); return () => {}; },
    ready: async () => {},
    currentUser: () => (signedIn ? user : null),
    signIn: async () => { signedIn = true; return user; },
    signOut: async () => { signedIn = false; },
  });

  // ---- Settings both modes start from ---------------------------------------
  localStorage.setItem("tmdb_api_key", "fake");
  localStorage.setItem("simkl_client_id", "fake");
  localStorage.setItem("simkl_access_token", "fake");
})();
