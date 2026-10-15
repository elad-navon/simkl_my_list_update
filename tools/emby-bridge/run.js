// Runs the Emby auto-marking bridge (emby-bridge.js) on this computer:
// asks the local Emby server once a minute what's playing and what was
// played, and marks episodes watched in the library.
//
//   node run.js           keep running (what the startup shortcut does)
//   node run.js --check   test the connections and exit
//   node run.js --once    one pass and exit
//
// Needs config.json next to this file (see config.example.json) and the
// Firebase service-account key it points to. Both stay on this computer
// only: the key can write to the library, so it never goes into the site
// or the repository (.gitignore).
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../../library-core.js");
const { createLibraryStore } = require("../../library-store.js");
const EpisodeSource = require("../../episode-source.js");
const { createLibraryAdapter } = require("../../library-adapter.js");
const { createEmbyBridge } = require("./emby-bridge.js");

const HERE = __dirname;
const LOG_FILE = path.join(HERE, "emby-bridge.log");
const LOG_MAX_BYTES = 1024 * 1024;

function log(...parts) {
  const line = `${new Date().toLocaleString("en-GB", { hour12: false })}  ${parts.join(" ")}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + ".old");
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (e) { /* the console still has it */ }
}

function readConfig() {
  const file = path.join(HERE, "config.json");
  if (!fs.existsSync(file)) throw new Error(`No config.json in ${HERE} - copy config.example.json to config.json and fill it in.`);
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    embyUrl: (c.embyUrl || "http://localhost:8096").replace(/\/+$/, ""),
    embyApiKey: c.embyApiKey,
    embyUser: c.embyUser || null,
    serviceAccountFile: path.resolve(HERE, c.serviceAccountFile || "service-account.json"),
    uid: c.uid || null,
    tmdbApiKey: c.tmdbApiKey || null,
    intervalSeconds: Math.max(30, Number(c.intervalSeconds) || 60),
    threshold: Math.min(1, Math.max(0.5, Number(c.threshold) || 0.8)),
  };
}

// ---- Emby (its REST API, with an API key from Emby's dashboard) ----------
function embyClient({ embyUrl, embyApiKey, embyUser }) {
  if (!embyApiKey) throw new Error("config.json: embyApiKey is missing (Emby dashboard > Advanced > API Keys).");
  let userId = null;
  async function get(p, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${embyUrl}/emby${p}${qs ? "?" + qs : ""}`, { headers: { "X-Emby-Token": embyApiKey, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Emby ${p}: ${res.status}`);
    return res.json();
  }
  async function user() {
    if (!userId) {
      const users = await get("/Users");
      const pick = embyUser ? users.find(u => u.Name.toLowerCase() === embyUser.toLowerCase()) : users.length === 1 ? users[0] : null;
      if (!pick) throw new Error(embyUser ? `No Emby user named "${embyUser}".` : `Emby has ${users.length} users - set embyUser in config.json.`);
      userId = pick.Id;
    }
    return userId;
  }
  return {
    user,
    async sessions() {
      const uid = await user();
      return (await get("/Sessions")).filter(s => s.UserId === uid && s.NowPlayingItem)
        .map(s => ({ item: s.NowPlayingItem, positionTicks: (s.PlayState && s.PlayState.PositionTicks) || 0, paused: !!(s.PlayState && s.PlayState.IsPaused) }));
    },
    // Episodes stopped partway, with where they stopped.
    async resume() {
      const page = await get(`/Users/${await user()}/Items/Resume`, {
        IncludeItemTypes: "Episode", Recursive: "true", Fields: "ProviderIds", EnableUserData: "true", Limit: "30",
      });
      return page.Items || [];
    },
    // Episodes marked played, newest first, back to `sinceIso`.
    async playedSince(sinceIso) {
      const uid = await user();
      const out = [];
      for (let start = 0; ; start += 50) {
        const page = await get(`/Users/${uid}/Items`, {
          IncludeItemTypes: "Episode", Recursive: "true", IsPlayed: "true", SortBy: "DatePlayed", SortOrder: "Descending",
          Fields: "ProviderIds", EnableUserData: "true", StartIndex: String(start), Limit: "50",
        });
        const items = page.Items || [];
        let older = false;
        for (const it of items) {
          // Emby writes 7 decimals ("…:12.0000000Z"): cut to ISO's 3.
          if (it.UserData && it.UserData.LastPlayedDate) it.UserData.LastPlayedDate = new Date(it.UserData.LastPlayedDate.replace(/(\.\d{3})\d+/, "$1")).toISOString();
          const at = it.UserData && it.UserData.LastPlayedDate;
          if (!at || at < sinceIso) { older = true; break; }
          out.push(it);
        }
        if (older || items.length < 50) return out;
      }
    },
    async series(id) {
      return get(`/Users/${await user()}/Items/${id}`, { Fields: "ProviderIds" });
    },
  };
}

// ---- The library (Firestore, through a service account) -----------------
function adminBackend(db, uid) {
  const shows = () => db.collection("users").doc(uid).collection("shows");
  const meta = name => db.collection("users").doc(uid).collection("meta").doc(name);
  return {
    async loadAll() {
      const snap = await shows().get();
      const docs = {};
      snap.forEach(d => { docs[d.id] = d.data(); });
      return { docs };
    },
    // Same contract as firebase-backend.js: Firestore re-runs `update` if the
    // document changed between the read and the write.
    async transact(docId, update) {
      const doc = await db.runTransaction(async tx => {
        const ref = shows().doc(docId);
        const snap = await tx.get(ref);
        const current = snap.exists ? snap.data() : null;
        const out = update(current);
        if (out.skip) return current;
        if (out.write === null) { tx.delete(ref); return null; }
        tx.set(ref, out.write);
        return out.write;
      });
      return { doc };
    },
    async replaceAll() { throw new Error("Not available here"); },
    async getMeta(name) { const s = await meta(name).get(); return s.exists ? s.data() : null; },
    async setMeta(name, data) { await meta(name).set(data); },
  };
}

async function openLibrary(cfg) {
  let admin;
  try { admin = require("firebase-admin"); } catch (e) {
    throw new Error("firebase-admin isn't installed - run: npm install (in tools/emby-bridge)");
  }
  if (!fs.existsSync(cfg.serviceAccountFile)) throw new Error(`The service-account key isn't there: ${cfg.serviceAccountFile}`);
  const app = admin.initializeApp({ credential: admin.credential.cert(require(cfg.serviceAccountFile)) });
  const db = app.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  let uid = cfg.uid;
  if (!uid) {
    const { users } = await app.auth().listUsers(10);
    if (users.length !== 1) throw new Error(`The project has ${users.length} users - set uid in config.json.`);
    uid = users[0].uid;
  }
  return { db, uid, backend: adminBackend(db, uid) };
}

function tmdbGetter(key) {
  if (!key) return async () => null;
  return async (p, params) => {
    const qs = new URLSearchParams({ api_key: key, ...(params || {}) });
    const res = await fetch(`https://api.themoviedb.org/3${p}?${qs}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return res.json();
  };
}

async function main() {
  const args = process.argv.slice(2);
  const cfg = readConfig();
  const emby = embyClient(cfg);
  const { backend, uid } = await openLibrary(cfg);

  if (args.includes("--check")) {
    const embyUser = await emby.user();
    const sessions = await emby.sessions();
    const { docs } = await backend.loadAll();
    const m = await backend.getMeta("embyBridge");
    log(`Emby: OK (user ${embyUser}, ${sessions.length} playing now)`);
    log(`Library: OK (user ${uid}, ${Object.keys(docs).length} shows)`);
    log(`Read point: ${m && m.since ? m.since : "not started yet - the first pass starts it from now"}`);
    return;
  }

  const store = createLibraryStore({ core, backend, storage: null });
  await store.load();
  const source = EpisodeSource.createEpisodeSource({ fetch: (...a) => fetch(...a), tmdbGet: tmdbGetter(cfg.tmdbApiKey), cache: EpisodeSource.memoryCache() });
  // (tmdbGetter answers null without a key: TVMaze alone then.)
  // A series not in the library yet is added under its English TMDB title
  // (as the site does), not Emby's - which may be in another language.
  const tmdbGet = tmdbGetter(cfg.tmdbApiKey);
  const showMeta = cfg.tmdbApiKey ? async tmdbId => {
    const d = await tmdbGet(`/tv/${tmdbId}`, { append_to_response: "external_ids" });
    if (!d) return null;
    const ext = d.external_ids || {};
    return { title: d.name || d.original_name || null, year: d.first_air_date ? d.first_air_date.slice(0, 4) : null, imdb: ext.imdb_id || null, tvdb: ext.tvdb_id || null };
  } : undefined;
  const adapter = createLibraryAdapter({ core, store, source, appendAfter: EpisodeSource.appendAfter, showMeta });
  const bridge = createEmbyBridge({ core, store, adapter, backend, emby, threshold: cfg.threshold });

  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const r = await bridge.run();
      if (r.started) log("Started: episodes played from now on will be marked.");
      for (const m of r.marked || []) log(`Marked: ${m}`);
      if (r.created.length) log(`Added as Watching: ${r.created.join(", ")}`);
      if (r.moved.length) log(`Moved to Watching: ${r.moved.join(", ")}`);
      if (r.unplaced.length) log(`Kept by number (not in the episode list): ${r.unplaced.join(", ")}`);
      for (const p of r.problems) log(`Problem: ${p}`);
    } catch (e) {
      log(`Pass skipped: ${e.message}`); // Emby or the internet away: next minute
    } finally {
      running = false;
    }
  };

  log(`Emby bridge running: every ${cfg.intervalSeconds}s, marking at ${Math.round(cfg.threshold * 100)}%.`);
  await pass();
  if (args.includes("--once")) { process.exit(0); }
  setInterval(pass, cfg.intervalSeconds * 1000);
}

main().catch(e => { log(`Stopped: ${e.message}`); process.exit(1); });
