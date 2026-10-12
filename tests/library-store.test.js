const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../library-core.js");
const { createLibraryStore, memoryBackend } = require("../library-store.js");

const NOW = Date.parse("2026-10-12T12:00:00Z");
const iso = ms => new Date(ms).toISOString();

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}
function baseShow(id, status = "watching") {
  return core.createShow({ ids: { tmdb: id }, title: `Show ${id}`, status, now: NOW - 86400000 });
}
const E = n => ({ key: `tvmaze:${n}`, keys: [`tvmaze:${n}`], season: 1, episode: n });
let seq = 0;
const ids = () => `op-${++seq}`;

function setup({ initial = { 1: baseShow(1) }, storage = memStorage(), ...opts } = {}) {
  const backend = memoryBackend(initial);
  const sleeps = [];
  const states = [];
  const store = createLibraryStore({
    core, backend, storage, newId: ids,
    sleep: async ms => { sleeps.push(ms); },
    onChange: s => states.push(s.state),
    ...opts,
  });
  return { backend, store, storage, sleeps, states };
}

test("load, then a change is 'saved' only once the backend has it", async () => {
  const { backend, store } = setup();
  await store.load();
  assert.equal(store.view().get("1").status, "watching");
  const outcome = await store.apply("1", { type: "setStatus", status: "hold", at: iso(NOW) });
  assert.equal(outcome, "saved");
  assert.equal(backend.docs.get("1").status, "hold");
  assert.equal(store.status().state, "saved");
  assert.equal(store.status().pending, 0);
});

test("create adds a new show", async () => {
  const { backend, store } = setup({ initial: {} });
  await store.load();
  const fresh = baseShow(7, "plantowatch");
  assert.equal(await store.apply("7", { type: "create", show: fresh }), "saved");
  assert.equal(backend.docs.get("7").status, "plantowatch");
  assert.equal(backend.docs.get("7").rev, 1);
});

test("several changes to one show in a row are never a false conflict", async () => {
  const { backend, store } = setup();
  await store.load();
  const a = store.apply("1", { type: "setWatched", watched: true, at: iso(NOW), episodes: [E(1)] });
  const b = store.apply("1", { type: "setWatched", watched: false, at: iso(NOW), episodes: [E(1)] });
  const c = store.apply("1", { type: "setWatched", watched: true, at: iso(NOW), episodes: [E(2)] });
  assert.deepEqual(await Promise.all([a, b, c]), ["saved", "saved", "saved"]);
  assert.deepEqual(Object.keys(backend.docs.get("1").watched), ["tvmaze:2"]);
});

test("a dropped connection is retried with growing pauses", async () => {
  const { backend, store, sleeps } = setup();
  await store.load();
  backend.failTimes(2);
  assert.equal(await store.apply("1", { type: "setStatus", status: "hold", at: iso(NOW) }), "saved");
  assert.deepEqual(sleeps, [1000, 2000]);
});

test("offline: the change waits in the outbox (also across a reload) and goes out on retry", async () => {
  const storage = memStorage();
  const first = setup({ storage });
  await first.store.load();
  first.backend.setOffline(true);
  const outcome = await first.store.apply("1", { type: "setWatched", watched: true, at: iso(NOW), episodes: [E(1)] });
  assert.equal(outcome, "queued");
  assert.equal(first.store.status().state, "offline");
  assert.equal(first.store.status().pending, 1);
  assert.ok(first.store.view().get("1").watched["tvmaze:1"], "visible locally while pending");
  assert.equal(first.backend.docs.get("1").watched["tvmaze:1"], undefined, "not on the server yet");

  // The page is reloaded: a new store, same browser storage, same backend.
  const second = createLibraryStore({ core, backend: first.backend, storage, newId: ids, sleep: async () => {} });
  first.backend.setOffline(false);
  await second.load();
  await second.flush();
  assert.ok(first.backend.docs.get("1").watched["tvmaze:1"]);
  assert.equal(second.status().pending, 0);
  assert.equal(storage.getItem("library_outbox_v1"), null);
});

test("a write whose answer was lost is not applied twice on retry", async () => {
  const { backend, store } = setup();
  await store.load();
  backend.loseResponseTimes(1);
  assert.equal(await store.apply("1", { type: "setWatched", watched: true, at: iso(NOW), episodes: [E(1)] }), "saved");
  const doc = backend.docs.get("1");
  assert.equal(doc.rev, 1, "written once");
  assert.equal(Object.keys(doc.watched).length, 1);
});

test("another device's change in between merges when it doesn't collide", async () => {
  const { backend, store } = setup();
  await store.load();
  backend.beforeNextCommit(docs => {
    const other = core.applyOp(docs.get("1"), { id: "other", type: "setWatched", watched: true, at: iso(NOW), episodes: [E(2)] }).show;
    docs.set("1", other);
  });
  assert.equal(await store.apply("1", { type: "setWatched", watched: true, at: iso(NOW), episodes: [E(1)] }), "saved");
  assert.deepEqual(Object.keys(backend.docs.get("1").watched).sort(), ["tvmaze:1", "tvmaze:2"]);
});

test("a real conflict waits for the user: 'theirs' drops the change", async () => {
  const { backend, store } = setup();
  await store.load();
  backend.docs.set("1", core.applyOp(backend.docs.get("1"), { id: "x", type: "setStatus", status: "dropped", at: iso(NOW) }).show);
  assert.equal(await store.apply("1", { type: "setStatus", status: "hold", at: iso(NOW) }), "conflict");
  assert.equal(store.status().state, "conflict");
  assert.match(store.status().conflict.reason, /dropped/);
  assert.equal(backend.docs.get("1").status, "dropped", "nothing overwritten");
  assert.equal(await store.resolveConflict("theirs"), "dropped");
  assert.equal(store.view().get("1").status, "dropped");
  assert.equal(store.status().pending, 0);
});

test("a real conflict waits for the user: 'mine' applies it on top", async () => {
  const { backend, store } = setup();
  await store.load();
  backend.docs.set("1", core.applyOp(backend.docs.get("1"), { id: "x", type: "setStatus", status: "dropped", at: iso(NOW) }).show);
  await store.apply("1", { type: "setStatus", status: "hold", at: iso(NOW) });
  assert.equal(await store.resolveConflict("mine"), "saved");
  assert.equal(backend.docs.get("1").status, "hold");
});

test("a permanent error is reported, and the change is kept for a later retry", async () => {
  const backend = memoryBackend({ 1: baseShow(1) });
  const real = backend.transact.bind(backend);
  let deny = true;
  backend.transact = (...a) => (deny ? Promise.reject(new Error("Missing or insufficient permissions")) : real(...a));
  const store = createLibraryStore({ core, backend, storage: memStorage(), newId: ids, sleep: async () => {} });
  await store.load();
  assert.equal(await store.apply("1", { type: "setStatus", status: "hold", at: iso(NOW) }), "error");
  assert.equal(store.status().state, "error");
  assert.match(store.status().error, /permissions/);
  assert.equal(store.status().pending, 1);
  deny = false;
  await store.retry();
  assert.equal(backend.docs.get("1").status, "hold");
});

test("backup and restore round-trip; restore returns what was there before", async () => {
  const { backend, store } = setup({ initial: { 1: baseShow(1), 2: baseShow(2, "completed") } });
  await store.load();
  const backup = store.exportBackup(NOW);
  assert.equal(backup.kind, "tv-library-backup");
  await store.apply("2", { type: "remove" });
  assert.equal(backend.docs.has("2"), false);
  const before = await store.restoreBackup(backup);
  assert.equal(backend.docs.get("2").status, "completed");
  assert.deepEqual(Object.keys(before.shows), ["1"]);
  await assert.rejects(store.restoreBackup({ kind: "something else" }));
});

test("restore is refused while changes are still waiting", async () => {
  const { backend, store } = setup();
  await store.load();
  backend.setOffline(true);
  await store.apply("1", { type: "setStatus", status: "hold", at: iso(NOW) });
  await assert.rejects(store.restoreBackup(store.exportBackup()), /aren't saved yet/);
});
