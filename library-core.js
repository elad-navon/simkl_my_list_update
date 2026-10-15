// Library core: the app's own TV library model and every rule computed from
// it, with no network or DOM access, so it runs unchanged in the browser
// (window.LibraryCore) and in Node (require) for the unit tests.
//
// A library show is the source of truth for what only the user knows:
// status, when it was added / changed, and which episodes were watched and
// when. Everything about the show itself (titles, episode lists, air
// dates) comes from outside sources and is only ever passed in.
//
// toSimklShape() turns a library show + its episode list into the exact
// item shape the rest of app.js was written against (SIMKL's
// /sync/all-items format), so the UI code keeps working unchanged.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LibraryCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const STATUSES = ["watching", "plantowatch", "hold", "completed", "dropped"];

  // ---------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------

  // "YYYY-MM-DD" is date-only (TMDB); anything longer carries a time and a
  // zone (TVMaze airstamp, SIMKL).
  function hasTime(dateStr) {
    return typeof dateStr === "string" && dateStr.length > 10;
  }

  // The local calendar day of a moment, as "YYYY-MM-DD".
  function localDateStr(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Has this episode aired by `now`?
  // - exact date + time: once it has finished airing - its start plus its
  //   runtime (else fallbackMinutes, the show's average, else 30 minutes).
  //   While it's on the air it isn't available yet;
  // - date only: from the following local day - on the day itself the time
  //   is unknown, so it isn't counted as aired yet;
  // - no date: never (unknown is not aired).
  function isAired(ep, now, fallbackMinutes) {
    if (!ep || !ep.date) return false;
    if (hasTime(ep.date)) {
      const ts = new Date(ep.date).getTime();
      if (isNaN(ts)) return false;
      const minutes = ep.runtime > 0 ? ep.runtime : fallbackMinutes > 0 ? fallbackMinutes : 30;
      return ts + minutes * 60000 <= now;
    }
    return ep.date < localDateStr(now);
  }

  // The average runtime (minutes, rounded) of a list's regular episodes that
  // have one, or null.
  function averageRuntime(episodes) {
    const runtimes = (episodes || []).filter(isRegular).map(e => e.runtime).filter(r => r > 0);
    return runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length) : null;
  }

  // ---------------------------------------------------------------------
  // Episodes
  // ---------------------------------------------------------------------
  // An episode (from the episode source) looks like:
  //   { season, episode, date, title, keys: ["tvmaze:123", "tmdb:456"] }
  // `keys` are stable source ids; season/episode numbers can differ between
  // sources, so they're only the fallback for matching a watched record.

  function isRegular(ep) {
    return ep && ep.season != null && ep.season !== 0 && ep.episode != null;
  }

  function compareOrder(a, b) {
    return (a.season - b.season) || (a.episode - b.episode);
  }

  function episodeCode(season, episode) {
    return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  }

  // Whole days between two dates ("YYYY-MM-DD" or ISO date-times, compared
  // by their calendar day as written), or null if either is missing.
  function dayDiff(a, b) {
    if (!a || !b) return null;
    const ta = Date.parse(String(a).slice(0, 10) + "T00:00:00Z");
    const tb = Date.parse(String(b).slice(0, 10) + "T00:00:00Z");
    return isNaN(ta) || isNaN(tb) ? null : Math.abs(ta - tb) / 86400000;
  }

  const normTitle = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
  function titlesAgree(a, b) {
    const x = normTitle(a), y = normTitle(b);
    return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
  }

  // The next episode still to air: the earliest regular episode with a
  // known date that hasn't aired by `now` (a date-only episode airing today
  // counts as upcoming - see isAired). Null when none is scheduled.
  function nextUpcoming(episodes, now) {
    let best = null, bestTs = Infinity;
    for (const ep of episodes || []) {
      if (!isRegular(ep) || !ep.date || isAired(ep, now)) continue;
      const ts = hasTime(ep.date) ? Date.parse(ep.date) : Date.parse(ep.date + "T00:00:00");
      if (!isNaN(ts) && ts < bestTs) { best = ep; bestTs = ts; }
    }
    return best;
  }

  // Maps watched episodes, as numbered by the old service, onto an episode
  // list whose numbering may differ. `sourceEps` is the old service's own
  // episode list (with air dates and titles), used to translate numbers:
  //   1. same season/episode number, and the air dates agree (<= 2 days)
  //      - or the old service has no date to compare;
  //   2. otherwise by air date (within a day): a single candidate;
  //   3. several candidates that day: the one with a matching title;
  //   4. still several: the same position within that day's episodes,
  //      when both lists have the same number of episodes that day;
  //   5. the same number, when that season has exactly as many episodes in
  //      both lists (the same episodes, only the dates differ);
  //   6. the same absolute position in the show, when the whole show has
  //      exactly as many episodes in both lists (seasons split differently).
  // Never guesses beyond that - anything else stays unmapped. Two watched
  // entries never map to the same episode (the second is reported).
  // Returns [{ w, ep, method }] with method "number" | "date" | "title" |
  // "date-order" | "season-match" | "position" | "special" | "unmapped" |
  // "duplicate".
  function mapWatched(watched, target, sourceEps) {
    const regular = (target || []).filter(isRegular).slice().sort(compareOrder);
    const byNum = new Map(regular.map(ep => [`${ep.season}-${ep.episode}`, ep]));
    const src = (sourceEps || []).filter(isRegular).slice().sort(compareOrder);
    const srcByNum = new Map(src.map(ep => [`${ep.season}-${ep.episode}`, ep]));
    const seasonSize = (list, season) => list.filter(ep => ep.season === season).length;
    const used = new Set();
    const take = (w, ep, method) => {
      if (!ep) return { w, ep: null, method };
      const k = `${ep.season}-${ep.episode}`;
      if (used.has(k)) return { w, ep: null, method: "duplicate" };
      used.add(k);
      return { w, ep, method };
    };
    return (watched || []).map(w => {
      if (w.s === 0) return { w, ep: null, method: "special" };
      const num = byNum.get(`${w.s}-${w.e}`);
      const old = srcByNum.get(`${w.s}-${w.e}`);
      if (num && (!old || !old.date || !num.date || dayDiff(old.date, num.date) <= 2)) return take(w, num, "number");
      if (!old) return take(w, null, "unmapped");
      if (old.date) {
        const candidates = regular.filter(ep => ep.date && dayDiff(ep.date, old.date) <= 1);
        if (candidates.length === 1) return take(w, candidates[0], "date");
        if (candidates.length > 1) {
          const byTitle = candidates.filter(ep => titlesAgree(ep.title, old.title));
          if (byTitle.length === 1) return take(w, byTitle[0], "title");
          const sameDayOld = src.filter(ep => ep.date && dayDiff(ep.date, old.date) <= 1);
          if (sameDayOld.length === candidates.length) {
            const rank = sameDayOld.indexOf(old);
            if (rank >= 0) return take(w, candidates[rank], "date-order");
          }
        }
      }
      if (num && seasonSize(src, w.s) === seasonSize(regular, w.s)) return take(w, num, "season-match");
      if (src.length === regular.length) {
        const i = src.indexOf(old);
        if (i >= 0) return take(w, regular[i], "position");
      }
      return take(w, null, "unmapped");
    });
  }

  // ---------------------------------------------------------------------
  // Library shows
  // ---------------------------------------------------------------------
  //   { schemaVersion, rev, updatedAt,
  //     ids: { tmdb, imdb, tvdb, tvmaze, simklLegacy }, idsVerified,
  //     title, year, status, addedAt, statusChangedAt,
  //     watched: { [key]: { s, e, at, keys?, partial? } },
  //     watchedCountHint?, unmappedWatched: [] }
  // A watched record is keyed by the episode's primary key. `partial` marks
  // a record that is the only thing known about a show's history (SIMKL's
  // dropped list gives just the last watched episode) - nothing is
  // inferred from it about the other episodes; watchedCountHint keeps the
  // aggregate count the source reported alongside it.

  // A show's document id: its TMDB id, or - for the few shows TMDB doesn't
  // know - a prefixed IMDb / TheTVDB id, so no show is ever dropped.
  function showDocId(ids) {
    if (!ids) return null;
    if (ids.tmdb != null) return String(ids.tmdb);
    if (ids.imdb) return `imdb:${ids.imdb}`;
    if (ids.tvdb) return `tvdb:${ids.tvdb}`;
    return null;
  }

  function createShow({ ids, title, year, status, now }) {
    if (!showDocId(ids)) throw new Error("A library show needs a TMDB, IMDb or TheTVDB id");
    if (!STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`);
    const at = new Date(now).toISOString();
    return {
      schemaVersion: SCHEMA_VERSION, rev: 0, updatedAt: at,
      ids: { tmdb: ids.tmdb ?? null, imdb: ids.imdb || null, tvdb: ids.tvdb || null, tvmaze: ids.tvmaze || null, simklLegacy: ids.simklLegacy || null },
      idsVerified: true,
      title: title || "Unknown", year: year || null,
      status, addedAt: at, statusChangedAt: at,
      watched: {}, unmappedWatched: [],
    };
  }

  // Which episode of `episodes` a watched record belongs to: by a shared
  // source key first, by season/episode number only when no key matches.
  function findEpisodeForRecord(record, key, episodes) {
    const recKeys = new Set([key, ...(record.keys || [])]);
    const byKey = episodes.find(ep => (ep.keys || []).some(k => recKeys.has(k)));
    if (byKey) return { ep: byKey, by: "key" };
    const byNumber = episodes.find(ep => ep.season === record.s && ep.episode === record.e);
    return byNumber ? { ep: byNumber, by: "number" } : null;
  }

  // ---------------------------------------------------------------------
  // The SIMKL-shaped view the existing UI code reads
  // ---------------------------------------------------------------------
  // next_to_watch: the first aired, unwatched regular episode AFTER the
  // latest one watched (in season/episode order), or the first aired one if
  // nothing is watched yet - null when that next episode hasn't aired.
  // Unwatched gaps before the latest watched episode don't move it back
  // (they still count toward remaining episodes).
  function toSimklShape(show, episodes, now) {
    const regular = (episodes || []).filter(isRegular).slice().sort(compareOrder);
    const watchedEps = new Map();     // "s-e" -> watched_at, for episodes in the list
    const extraWatched = [];          // records with no episode in the list
    for (const [key, rec] of Object.entries(show.watched || {})) {
      const found = findEpisodeForRecord(rec, key, regular);
      if (found) {
        const k = `${found.ep.season}-${found.ep.episode}`;
        const prev = watchedEps.get(k);
        if (!prev || new Date(rec.at) > new Date(prev)) watchedEps.set(k, rec.at);
      } else if (rec.s != null && rec.s !== 0 && rec.e != null) {
        extraWatched.push({ season: rec.s, episode: rec.e, at: rec.at });
      }
    }

    const seasonsMap = new Map();
    const addWatched = (season, episode, at) => {
      if (!seasonsMap.has(season)) seasonsMap.set(season, new Map());
      const eps = seasonsMap.get(season);
      if (!eps.has(episode) || new Date(at) > new Date(eps.get(episode))) eps.set(episode, at);
    };
    for (const [k, at] of watchedEps) {
      const [s, e] = k.split("-").map(Number);
      addWatched(s, e, at);
    }
    for (const x of extraWatched) addWatched(x.season, x.episode, x.at);
    const seasons = [...seasonsMap.keys()].sort((a, b) => a - b).map(number => ({
      number,
      episodes: [...seasonsMap.get(number).entries()].sort((a, b) => a[0] - b[0])
        .map(([n, at]) => ({ number: n, watched_at: at || null })),
    }));

    let watchedCount = seasons.reduce((sum, s) => sum + s.episodes.length, 0);
    if (show.watchedCountHint != null) watchedCount = Math.max(watchedCount, show.watchedCountHint);

    let latestInOrder = null;
    let lastByTime = null;
    for (const s of seasons) {
      for (const e of s.episodes) {
        const pos = { season: s.number, episode: e.number };
        if (!latestInOrder || compareOrder(pos, latestInOrder) > 0) latestInOrder = pos;
        const ts = e.watched_at ? new Date(e.watched_at).getTime() : NaN;
        if (!isNaN(ts) && (!lastByTime || ts > lastByTime.ts)) lastByTime = { ...pos, ts, at: e.watched_at };
      }
    }

    let next = null;
    for (const ep of regular) {
      if (latestInOrder && compareOrder(ep, latestInOrder) <= 0) continue;
      if (watchedEps.has(`${ep.season}-${ep.episode}`)) continue;
      next = ep;
      break;
    }
    const avgRuntime = averageRuntime(regular);
    const nextToWatch = next && isAired(next, now, avgRuntime) ? episodeCode(next.season, next.episode) : null;

    return {
      status: show.status,
      show: {
        title: show.title,
        year: show.year,
        runtime: null,
        ids: {
          tmdb: show.ids.tmdb, imdb: show.ids.imdb || undefined,
          tvdb: show.ids.tvdb || undefined, tvmaze: show.ids.tvmaze || undefined,
        },
      },
      seasons,
      watched_episodes_count: watchedCount,
      total_episodes_count: regular.length,
      // A watched episode has aired, whatever its date says (many older
      // episodes simply have no date in any source).
      not_aired_episodes_count: regular.filter(ep => !isAired(ep, now, avgRuntime) && !watchedEps.has(`${ep.season}-${ep.episode}`)).length,
      next_to_watch: nextToWatch,
      last_watched_at: lastByTime ? lastByTime.at : null,
      last_watched: lastByTime ? episodeCode(lastByTime.season, lastByTime.episode) : null,
    };
  }

  // ---------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------
  // Every change to the library is an operation, applied the same way
  // everywhere (locally, on retry, after a conflict re-read):
  //   { id, type: "setStatus", status, at, autoStarted? }
  //   { id, type: "setWatched", watched: true|false, at, by?,
  //     episodes: [{ key, keys?, season, episode, at? }] }
  //     (by: what marked them, kept on each record - "emby", "simkl";
  //     none when marked by hand)
  //   { id, type: "remove" }
  //   { id, type: "create", show }   (adding a show; on a show that already
  //                                    exists it just sets op.show.status)
  // `id` makes an operation recognisable when it is retried, so it is never
  // applied twice: a changed show remembers the ids of its last
  // APPLIED_OPS_KEPT operations (appliedOps), and an operation whose id is
  // already there changes nothing. Applying the same operation again
  // changes nothing either way.
  // Returns { show, changed } - `show` is a new object, null after remove.
  const APPLIED_OPS_KEPT = 50;

  function cloneShow(show) {
    return JSON.parse(JSON.stringify(show));
  }

  function applyOp(show, op) {
    if (op.type === "remove") return { show: null, changed: !!show };
    if (op.type === "create") {
      if (!show) {
        const created = cloneShow(op.show);
        created.rev = 1;
        created.appliedOps = op.id ? [op.id] : [];
        return { show: created, changed: true };
      }
      return applyOp(show, { id: op.id, type: "setStatus", status: op.show.status, at: op.at || op.show.statusChangedAt });
    }
    if (!show) throw new Error(`Cannot apply ${op.type} to a show that isn't in the library`);
    if (op.id && (show.appliedOps || []).includes(op.id)) return { show: cloneShow(show), changed: false };
    const next = cloneShow(show);
    let changed = false;
    if (op.type === "setStatus") {
      if (!STATUSES.includes(op.status)) throw new Error(`Unknown status: ${op.status}`);
      if (next.status !== op.status) {
        next.status = op.status;
        next.statusChangedAt = op.at;
        changed = true;
      }
      // Premiere auto-start bookkeeping (see autoStartAiredPremieres in
      // app.js): the first-air date already moved to Watching, or "manual"
      // once the show was sent back to Plan to Watch by hand.
      if (op.autoStarted !== undefined && next.autoStarted !== op.autoStarted) {
        next.autoStarted = op.autoStarted;
        changed = true;
      }
    } else if (op.type === "setWatched") {
      for (const ep of op.episodes || []) {
        const existingKey = Object.keys(next.watched).find(k => {
          const rec = next.watched[k];
          const keys = new Set([k, ...(rec.keys || [])]);
          return keys.has(ep.key) || (ep.keys || []).some(x => keys.has(x));
        });
        if (op.watched && !existingKey) {
          // An episode may carry its own watch time (e.g. when it was really
          // watched, as reported by the old service); otherwise the op's.
          next.watched[ep.key] = { s: ep.season, e: ep.episode, at: ep.at !== undefined ? ep.at : op.at, keys: ep.keys || [ep.key] };
          if (op.by) next.watched[ep.key].by = op.by;
          changed = true;
        } else if (!op.watched && existingKey) {
          delete next.watched[existingKey];
          changed = true;
        }
      }
    } else {
      throw new Error(`Unknown operation: ${op.type}`);
    }
    if (changed) {
      next.rev = (show.rev || 0) + 1;
      next.updatedAt = op.at || new Date().toISOString();
      if (op.id) next.appliedOps = [...(show.appliedOps || []), op.id].slice(-APPLIED_OPS_KEPT);
    }
    return { show: next, changed };
  }

  // ---------------------------------------------------------------------
  // Conflicts
  // ---------------------------------------------------------------------
  // An operation was prepared against `base` (what this device last saw),
  // but the stored copy is now `remote`. It may still be applied when
  // nothing it touches was changed since `base` - or was changed the same
  // way. Otherwise it's a real conflict and must not be written blindly.
  // Returns { ok: true } or { ok: false, reason }.

  function watchedStateFor(show, ep) {
    if (!show) return false;
    return Object.keys(show.watched || {}).some(k => {
      const rec = show.watched[k];
      const keys = new Set([k, ...(rec.keys || [])]);
      return keys.has(ep.key) || (ep.keys || []).some(x => keys.has(x));
    });
  }

  function checkConflict(base, remote, op) {
    if ((base ? base.rev : null) === (remote ? remote.rev : null)) return { ok: true };
    if (op.id && remote && (remote.appliedOps || []).includes(op.id)) return { ok: true }; // already applied
    if (op.type === "create") {
      // Added on another device meanwhile: fine if it's in the same list.
      if (!remote || remote.status === op.show.status) return { ok: true };
      if (base && remote.status === base.status) return { ok: true };
      return { ok: false, reason: `It was added on another device as "${remote.status}"` };
    }
    if (op.type === "remove") {
      // Already gone elsewhere is fine; removing a copy that another device
      // has since changed would silently discard that change.
      return remote ? { ok: false, reason: "The show was changed on another device" } : { ok: true };
    }
    if (!remote) return { ok: false, reason: "The show was removed on another device" };
    if (op.type === "setStatus") {
      const baseStatus = base ? base.status : null;
      if (remote.status === baseStatus || remote.status === op.status) return { ok: true };
      return { ok: false, reason: `Its status was changed to "${remote.status}" on another device` };
    }
    if (op.type === "setWatched") {
      for (const ep of op.episodes || []) {
        const before = watchedStateFor(base, ep);
        const now = watchedStateFor(remote, ep);
        if (before !== now && now !== op.watched) {
          return { ok: false, reason: `${episodeCode(ep.season, ep.episode)} was changed on another device` };
        }
      }
      return { ok: true };
    }
    return { ok: false, reason: `Unknown operation: ${op.type}` };
  }

  return {
    SCHEMA_VERSION, STATUSES,
    hasTime, localDateStr, isAired, averageRuntime, isRegular, episodeCode,
    dayDiff, titlesAgree, nextUpcoming, mapWatched,
    showDocId, createShow, findEpisodeForRecord, toSimklShape,
    applyOp, checkConflict,
  };
});
