// Loading the library without reading all of it every time. A load read
// every show document (721 of them in November 2026) - and the computer's
// bridge loads the library every half hour, which alone came to ~35,000 of
// the free plan's 50,000 reads a day.
//
// Every write stamps the show with the server's time (SYNC_FIELD, set by the
// database itself - a show's own `updatedAt` is the time of the change, which
// can lie in the past, e.g. an episode Emby reports hours after it was
// watched). A removed show is noted with that time in meta "removed". So a
// load needs only the shows saved since the last one, plus that one
// document, on top of the copy kept from before: the database's own offline
// copy in the browser, the bridge's memory. Once a day - or with no copy, or
// no record of the last load - it reads everything, which also settles
// anything the quick loads could miss (e.g. a write by an older version of
// the site, without the stamp).
//
// The same code for the site (firebase-backend.js) and the bridge
// (tools/emby-bridge/run.js); each passes how to read. Runs in the browser
// (window.LibrarySync) and in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LibrarySync = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SYNC_FIELD = "_syncAt";
  const REMOVED_META = "removed";
  const FULL_EVERY_MS = 24 * 3600 * 1000;
  // Saved shows are asked for from a little before the last load, so a
  // clock a few minutes off, or a write committed during the last load,
  // isn't missed (re-reading a few shows costs next to nothing).
  const OVERLAP_MS = 5 * 60 * 1000;

  // A stored show as { data, syncMs }: the show without the stamp (the rest
  // of the app never sees it), and the stamp in milliseconds (null if none).
  // `toMs` reads the database's timestamp type.
  function splitStamp(stored, toMs = t => (t && typeof t.toMillis === "function" ? t.toMillis() : null)) {
    if (!stored) return { data: stored, syncMs: null };
    if (!(SYNC_FIELD in stored)) return { data: stored, syncMs: null };
    const { [SYNC_FIELD]: stamp, ...data } = stored;
    return { data, syncMs: toMs(stamp) };
  }

  // createIncrementalLoad({ fetchAll, fetchChanged, fetchRemoved, readCopy,
  //   writeCopy, state, now }) -> loadAll() resolving to { docs, full,
  //   changed } (changed: how many shows a quick load read)
  // - fetchAll(): every show, as [{ id, data, syncMs }]
  // - fetchChanged(sinceMs): the shows stamped after sinceMs, same shape
  // - fetchRemoved(): meta "removed" as { [id]: ms } (or null)
  // - readCopy(): the copy from before, { [id]: { data, syncMs } }, or null
  // - writeCopy(copy): keeps it (the bridge's memory; the browser's database
  //   keeps its own, so it passes nothing)
  // - state: { get(), set(s) } - { cursorMs, fullAt } between loads
  function createIncrementalLoad({ fetchAll, fetchChanged, fetchRemoved, readCopy, writeCopy = () => {}, state, now = () => Date.now() }) {
    const toDocs = copy => Object.fromEntries(Object.entries(copy).map(([id, v]) => [id, v.data]));
    const maxStamp = (rows, from) => rows.reduce((m, r) => (r.syncMs != null && r.syncMs > m ? r.syncMs : m), from);

    async function full(startedAt) {
      const rows = await fetchAll();
      const copy = {};
      for (const r of rows) copy[r.id] = { data: r.data, syncMs: r.syncMs };
      state.set({ cursorMs: maxStamp(rows, startedAt), fullAt: startedAt });
      writeCopy(copy);
      return { docs: toDocs(copy), full: true, changed: rows.length };
    }

    return async function loadAll() {
      const startedAt = now();
      const st = state.get();
      if (!st || st.cursorMs == null || !(startedAt - st.fullAt < FULL_EVERY_MS)) return full(startedAt);
      const before = await Promise.resolve().then(readCopy).catch(() => null);
      if (!before || !Object.keys(before).length) return full(startedAt);
      const [changed, removed] = await Promise.all([fetchChanged(st.cursorMs - OVERLAP_MS), fetchRemoved()]);
      const copy = { ...before };
      for (const r of changed) copy[r.id] = { data: r.data, syncMs: r.syncMs };
      // A show removed after it was last saved is gone; one saved again after
      // its removal (added back) stays.
      for (const [id, removedMs] of Object.entries(removed || {})) {
        if (copy[id] && !((copy[id].syncMs || 0) > removedMs)) delete copy[id];
      }
      state.set({ cursorMs: Math.max(maxStamp(changed, st.cursorMs), startedAt - OVERLAP_MS), fullAt: st.fullAt });
      writeCopy(copy);
      return { docs: toDocs(copy), full: false, changed: changed.length };
    };
  }

  // A state kept in memory (the bridge: a restart reads everything again).
  function memoryState() {
    let s = null;
    return { get: () => s, set: v => { s = v; } };
  }

  // A state kept in the browser's storage, per user.
  function storageState(storage, key) {
    return {
      get() { try { return JSON.parse(storage.getItem(key) || "null"); } catch (e) { return null; } },
      set(v) { try { storage.setItem(key, JSON.stringify(v)); } catch (e) { /* the next load reads everything */ } },
    };
  }

  return { createIncrementalLoad, splitStamp, memoryState, storageState, SYNC_FIELD, REMOVED_META, FULL_EVERY_MS, OVERLAP_MS };
});
