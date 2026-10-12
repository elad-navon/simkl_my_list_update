// Library store: keeps the user's library in a backend (Firestore in the
// app, an in-memory stand-in in tests) and is the only way it changes.
// Runs in the browser (window.LibraryStore) and in Node for tests.
//
// Guarantees:
// - A change counts as saved only once the backend confirmed it.
// - Each change is an operation (see LibraryCore.applyOp) with an id, kept
//   in a small outbox (survives a reload) until confirmed. Retrying one -
//   even after a write whose answer was lost - never applies it twice.
// - Every write is checked against what this device last saw
//   (LibraryCore.checkConflict): changes that don't collide merge; a real
//   conflict stops and waits for the user's choice - nothing is overwritten
//   blindly.
// - Network failures retry a few times with growing pauses; still failing,
//   the outbox waits ("offline") and goes out on retry().
//
// Backend contract:
//   loadAll() -> { docs: { [docId]: show } }
//   transact(docId, update) -> { doc }   update(current|null) returns
//     { write: show | null } (null deletes) or { skip: true }, or throws to
//     abort. Atomic: if the stored copy changes between read and write, the
//     backend re-runs update on the fresh copy (as Firestore transactions do).
//   replaceAll({ [docId]: show })        (restore from a backup)
// A network-type failure rejects with err.transient = true.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LibraryStore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const OUTBOX_KEY = "library_outbox_v1";
  const BACKUP_KIND = "tv-library-backup";
  const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
  const defaultId = () => `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  function transientError(message) {
    const e = new Error(message || "Network unavailable");
    e.transient = true;
    return e;
  }

  function createLibraryStore({ core, backend, storage, sleep = defaultSleep, newId = defaultId, onChange, maxAttempts = 3, baseDelayMs = 1000 }) {
    let confirmed = new Map();
    let outbox = readOutbox();
    let conflict = null;   // { item, reason, remote }
    let lastError = null;
    let state = "idle";
    let flushing = null;
    const waiters = new Map(); // op id -> resolve

    function readOutbox() {
      try { return JSON.parse((storage && storage.getItem(OUTBOX_KEY)) || "[]"); } catch (e) { return []; }
    }
    function writeOutbox() {
      if (!storage) return;
      if (outbox.length) storage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
      else storage.removeItem(OUTBOX_KEY);
    }
    function setState(next) {
      state = next;
      if (onChange) onChange(status());
    }
    function status() {
      return {
        state, pending: outbox.length,
        conflict: conflict ? { opId: conflict.item.op.id, docId: conflict.item.docId, reason: conflict.reason } : null,
        error: lastError ? lastError.message : null,
      };
    }
    function settle(opId, outcome) {
      const w = waiters.get(opId);
      if (w) { waiters.delete(opId); w(outcome); }
    }

    // What the app shows: confirmed copies with not-yet-confirmed changes
    // applied on top, so a change made offline is visible right away (and
    // marked pending in status()).
    function view() {
      const out = new Map(confirmed);
      for (const item of outbox) {
        try {
          const r = core.applyOp(out.get(item.docId) || null, item.op);
          if (r.show) out.set(item.docId, r.show); else out.delete(item.docId);
        } catch (e) { /* the conflict check will report it */ }
      }
      return out;
    }

    async function load() {
      setState("loading");
      try {
        const { docs } = await backend.loadAll();
        confirmed = new Map(Object.entries(docs || {}));
        setState(outbox.length ? "saving" : "idle");
      } catch (e) {
        lastError = e;
        setState(e.transient ? "offline" : "error");
        throw e;
      }
      if (outbox.length) flush();
      return view();
    }

    // Queues one operation for a show. Resolves to "saved" once confirmed,
    // "queued" if it's waiting for the network, "conflict" or "error".
    function apply(docId, op) {
      const item = { docId, op: { ...op, id: op.id || newId() }, base: clone(view().get(docId) || null) };
      outbox.push(item);
      writeOutbox();
      const done = new Promise(resolve => waiters.set(item.op.id, resolve));
      setState("saving");
      flush();
      return done;
    }

    async function sendOne(item) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const { doc } = await backend.transact(item.docId, current => {
            const check = core.checkConflict(item.base, current, item.op);
            if (!check.ok) {
              const e = new Error(check.reason);
              e.conflict = true;
              e.remote = current;
              throw e;
            }
            if (item.op.type === "remove") return current ? { write: null } : { skip: true };
            const r = core.applyOp(current, item.op);
            return r.changed ? { write: r.show } : { skip: true };
          });
          if (doc) confirmed.set(item.docId, doc); else confirmed.delete(item.docId);
          return "saved";
        } catch (e) {
          if (e.conflict) { conflict = { item, reason: e.message, remote: clone(e.remote) }; return "conflict"; }
          if (e.transient) {
            if (attempt < maxAttempts - 1) await sleep(baseDelayMs * 2 ** attempt);
            continue;
          }
          lastError = e;
          return "error";
        }
      }
      return "offline";
    }

    // One send loop at a time. A flush() asked for while one is finishing
    // (e.g. right after a conflict was resolved) runs again once it ends,
    // so nothing waits in the outbox unnoticed.
    let rerun = false;
    function flush() {
      if (flushing) { rerun = true; return flushing; }
      flushing = (async () => {
        do {
          rerun = false;
          await drain();
        } while (rerun && outbox.length && !conflict);
      })().finally(() => { flushing = null; });
      return flushing;
    }

    async function drain() {
      {
        while (outbox.length && !conflict) {
          const item = outbox[0];
          const outcome = await sendOne(item);
          if (outcome === "saved") {
            outbox.shift();
            writeOutbox();
            lastError = null;
            settle(item.op.id, "saved");
            continue;
          }
          if (outcome === "conflict") { setState("conflict"); settle(item.op.id, "conflict"); return; }
          for (const it of outbox) settle(it.op.id, outcome === "offline" ? "queued" : "error");
          setState(outcome === "offline" ? "offline" : "error");
          return;
        }
        if (!outbox.length && !conflict) setState("saved");
      }
    }

    // The user's answer to a conflict: "mine" re-applies the change on top
    // of the other device's version; "theirs" drops it.
    async function resolveConflict(choice) {
      if (!conflict) return;
      const { item, remote } = conflict;
      conflict = null;
      if (remote) confirmed.set(item.docId, remote); else confirmed.delete(item.docId);
      if (choice === "mine") {
        item.base = clone(remote);
        writeOutbox();
        const done = new Promise(resolve => waiters.set(item.op.id, resolve));
        setState("saving");
        flush();
        return done;
      }
      outbox.shift();
      writeOutbox();
      setState(outbox.length ? "saving" : "saved");
      if (outbox.length) flush();
      return "dropped";
    }

    function retry() {
      if (!outbox.length || conflict) return Promise.resolve();
      setState("saving");
      return flush();
    }

    // ---- Backups ----------------------------------------------------------
    function exportBackup(nowMs = Date.now()) {
      return { kind: BACKUP_KIND, schemaVersion: core.SCHEMA_VERSION, exportedAt: new Date(nowMs).toISOString(), shows: Object.fromEntries(confirmed) };
    }

    // Replaces the whole library with a backup. Refused while changes are
    // still waiting to be saved. Returns a backup of what was there before.
    async function restoreBackup(backup) {
      if (!backup || backup.kind !== BACKUP_KIND || typeof backup.shows !== "object") throw new Error("This file isn't a library backup");
      if (backup.schemaVersion !== core.SCHEMA_VERSION) throw new Error(`Backup schema ${backup.schemaVersion} doesn't match ${core.SCHEMA_VERSION}`);
      if (outbox.length) throw new Error("Some changes aren't saved yet - restore once they are");
      const before = exportBackup();
      await backend.replaceAll(clone(backup.shows));
      confirmed = new Map(Object.entries(clone(backup.shows)));
      setState("saved");
      return before;
    }

    return { load, view, apply, retry, resolveConflict, status, exportBackup, restoreBackup, flush };
  }

  // ---- An in-memory backend (tests, and a dry run of the import) ----------
  // Extra hooks to simulate trouble: setOffline(bool), failTimes(n) (next n
  // calls fail like a dropped connection), loseResponseTimes(n) (the write
  // happens but the answer is lost), beforeNextCommit(fn) (another device
  // writes between this read and this write).
  function memoryBackend(initial = {}) {
    const docs = new Map(Object.entries(clone(initial)));
    let offline = false, fails = 0, lose = 0, interleave = null;
    const calls = { transact: 0, attempts: 0 };
    return {
      docs, calls,
      setOffline(v) { offline = v; },
      failTimes(n) { fails = n; },
      loseResponseTimes(n) { lose = n; },
      beforeNextCommit(fn) { interleave = fn; },
      async loadAll() {
        if (offline) throw transientError();
        return { docs: Object.fromEntries([...docs].map(([k, v]) => [k, clone(v)])) };
      },
      async transact(id, update) {
        calls.transact++;
        if (offline) throw transientError();
        if (fails > 0) { fails--; throw transientError(); }
        for (;;) {
          calls.attempts++;
          const current = docs.has(id) ? clone(docs.get(id)) : null;
          const out = update(clone(current));
          if (interleave) { const f = interleave; interleave = null; f(docs); }
          const now = docs.has(id) ? docs.get(id) : null;
          if ((now ? now.rev : null) !== (current ? current.rev : null)) continue; // changed meanwhile: re-run
          if (!out.skip) {
            if (out.write === null) docs.delete(id); else docs.set(id, clone(out.write));
          }
          if (lose > 0) { lose--; throw transientError("Answer lost"); }
          return { doc: docs.has(id) ? clone(docs.get(id)) : null };
        }
      },
      async replaceAll(map, onProgress) {
        if (offline) throw transientError();
        docs.clear();
        for (const [k, v] of Object.entries(map)) docs.set(k, clone(v));
        if (onProgress) onProgress(docs.size, docs.size);
      },
    };
  }

  return { createLibraryStore, memoryBackend, transientError, OUTBOX_KEY, BACKUP_KIND };
});
