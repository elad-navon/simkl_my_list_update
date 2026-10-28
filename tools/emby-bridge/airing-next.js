// Airing Next for the phone's home-screen widget (android-app, AiringWidgetProvider):
// the same shows the site's Airing Next tab lists - Watching, plus Plan to Watch
// shows whose next episode is the series premiere - with the next few episodes of
// each, written to the account as meta "airingNext". The phone reads that one
// document in the background and works out by itself which episode is next as
// time passes (the same aired rule as LibraryCore.isAired), so it stays right for
// a while even when this computer is off.
//
// Written only when something changed. The document holds one JSON string
// (`json`) so the phone doesn't have to unpack Firestore's typed fields:
//   { v: 1, generatedAt, shows: [{ key, title, plan, art,
//       eps: [{ s, e, date, runtime, title, badge }] }] }
// `date` is the episode list's own: a full ISO date-time when the air time is
// known, else "YYYY-MM-DD".
"use strict";

const DOC = "airingNext";
const EPISODES_AHEAD = 4;
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const ART_TTL_MS = 7 * 24 * 3600 * 1000;

function createAiringNext({ core, adapter, backend, tmdbGet, now = () => Date.now() }) {
  const artCache = new Map(); // tmdbId -> { url, at }
  let lastJson = null;

  // The show's banner as the site picks it by default (computeImages): TMDB's
  // own backdrop when it's an English / no-language one, else the first of
  // those, else a Hebrew one. A pick made by clicking on the site lives only in
  // that browser, so it isn't known here.
  async function artFor(tmdbId) {
    if (tmdbId == null || !tmdbGet) return null;
    const hit = artCache.get(tmdbId);
    if (hit && now() - hit.at < ART_TTL_MS) return hit.url;
    let url = null;
    try {
      const d = await tmdbGet(`/tv/${tmdbId}`, { append_to_response: "images", include_image_language: "en,null,he" });
      const all = (d && d.images && d.images.backdrops) || [];
      const en = all.filter(p => p.iso_639_1 === "en" || p.iso_639_1 == null);
      const list = (en.length ? en : all.filter(p => p.iso_639_1 === "he")).map(p => p.file_path).filter(Boolean);
      const path = d && d.backdrop_path && list.includes(d.backdrop_path) ? d.backdrop_path : list[0];
      url = path ? TMDB_BACKDROP_BASE + path : null;
    } catch (e) {
      return hit ? hit.url : null; // TMDB away: keep what we had
    }
    artCache.set(tmdbId, { url, at: now() });
    return url;
  }

  // Premiere / finale, as buildAiringRow (app.js) decides it.
  function badgeFor(ep, episodes) {
    if (ep.episode === 1) return ep.season === 1 ? "SERIES PREMIERE" : "SEASON PREMIERE";
    const same = episodes.filter(e => e.season === ep.season && e.episode != null);
    return same.length && ep.episode === Math.max(...same.map(e => e.episode)) ? "SEASON FINALE" : null;
  }

  function cleanTitle(t) {
    const s = t == null ? "" : String(t).trim();
    return s && !/^Episode\s+\d+$/i.test(s) ? s : null;
  }

  // The episodes still to come (or on the air now), soonest first - the
  // candidates nextAiringEpisodeFromList (app.js) picks from.
  function upcoming(episodes, runtime, at) {
    return episodes
      .filter(e => e.season != null && e.season !== 0 && e.episode != null && e.date)
      .filter(e => !core.isAired(e, at, runtime))
      .map(e => ({ e, ts: Date.parse(e.date.length > 10 ? e.date : e.date + "T00:00:00") }))
      .filter(x => !isNaN(x.ts))
      .sort((a, b) => a.ts - b.ts)
      .map(x => x.e);
  }

  async function showEntry(item, plan, at) {
    const show = item.show || {};
    const ids = show.ids || {};
    if (item.not_aired_episodes_count === 0) return null;
    const episodes = (ids.library != null && await adapter.showEpisodes(ids.library)) || [];
    let next = upcoming(episodes, show.runtime, at);
    if (!next.length) return null;
    if (plan) {
      if (!(next[0].season === 1 && next[0].episode === 1)) return null;
      next = next.slice(0, 1);
    }
    return {
      key: String(ids.library),
      tmdb: ids.tmdb != null ? ids.tmdb : null,
      title: show.title || "Unknown",
      plan,
      art: await artFor(ids.tmdb),
      eps: next.slice(0, EPISODES_AHEAD).map(e => ({
        s: e.season, e: e.episode, date: e.date,
        runtime: e.runtime > 0 ? e.runtime : (show.runtime > 0 ? Math.round(show.runtime) : null),
        title: cleanTitle(e.title),
        badge: badgeFor(e, episodes),
      })),
    };
  }

  // Works the list out; writes it only when it differs from the last one.
  // { written, shows } - throws if the library couldn't be read, so a broken
  // pass never replaces a good document.
  async function run({ dryRun = false } = {}) {
    const at = now();
    const [watching, plan] = await Promise.all([adapter.items("watching"), adapter.items("plantowatch")]);
    const watchingRows = await Promise.all(watching.filter(i => i.status === "watching").map(i => showEntry(i, false, at)));
    const seen = new Set();
    const shows = [];
    for (const row of watchingRows) {
      if (!row) continue;
      if (row.tmdb != null) seen.add(row.tmdb);
      shows.push(row);
    }
    const planRows = await Promise.all(plan
      .filter(i => !(i.show && i.show.ids && i.show.ids.tmdb != null && seen.has(i.show.ids.tmdb)))
      .map(i => showEntry(i, true, at)));
    for (const row of planRows) if (row) shows.push(row);
    for (const s of shows) delete s.tmdb;

    const json = JSON.stringify({ v: 1, shows });
    if (lastJson == null && !dryRun) {
      const saved = await backend.getMeta(DOC).catch(() => null);
      if (saved && typeof saved.json === "string") {
        try { lastJson = JSON.stringify({ v: 1, shows: JSON.parse(saved.json).shows }); } catch (e) { lastJson = null; }
      }
    }
    if (dryRun || json === lastJson) return { written: false, shows };
    const generatedAt = new Date(at).toISOString();
    await backend.setMeta(DOC, { json: JSON.stringify({ v: 1, generatedAt, shows }), generatedAt });
    lastJson = json;
    return { written: true, shows };
  }

  return { run };
}

module.exports = { createAiringNext };
