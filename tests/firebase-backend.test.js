const test = require("node:test");
const assert = require("node:assert/strict");
const { FirebaseBackend } = require("../firebase-backend.js");

// A stand-in for the Firebase modules: one signed-in user, the shows and the
// meta documents, a server clock for serverTimestamp(), queries on the
// stamp, the offline copy (getDocsFromCache), transactions, and a commit
// that - like Firestore - refuses a batch over a size limit ("Transaction
// too big"), here counted in fields. `reads` counts billed document reads
// (an empty query result still costs one, as on Firestore).
function fakeSdk({ fieldLimit = Infinity } = {}) {
  let clock = Date.parse("2026-11-07T10:00:00Z");
  const store = new Map();   // show id -> data (as stored, stamp included)
  const meta = new Map();    // meta name -> data
  const cache = new Map();   // the offline copy of the shows
  const commits = [];
  const counter = { reads: 0 };
  const STAMP = { serverTimestamp: true };
  const ts = ms => ({ ms, toMillis: () => ms });
  const fields = v => (Array.isArray(v) ? 1 + v.reduce((n, x) => n + fields(x), 0)
    : v && typeof v === "object" ? Object.values(v).reduce((n, x) => n + fields(x), 0) : 1);
  const resolve = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === STAMP ? ts(clock) : v]));
  const kind = ref => (ref.path.includes("meta") ? "meta" : "show");
  const snapOf = (id, data) => ({ id, ref: { id, path: ["shows", id] }, data: () => data, exists: () => data != null });
  const list = entries => ({ forEach: fn => entries.forEach(([id, data]) => fn(snapOf(id, data))) });
  function write(ref, data, opts) {
    if (kind(ref) === "meta") {
      meta.set(ref.id, opts && opts.merge ? { ...(meta.get(ref.id) || {}), ...resolve(data) } : resolve(data));
    } else {
      store.set(ref.id, resolve(data));
      cache.set(ref.id, store.get(ref.id));
    }
  }
  function remove(ref) { store.delete(ref.id); cache.delete(ref.id); }
  return {
    store, meta, cache, commits, counter,
    tick: ms => { clock += ms; },
    initializeApp: () => ({}), getAuth: () => ({}),
    initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    onAuthStateChanged: (auth, cb) => { setTimeout(() => cb({ uid: "u1", email: "a@b.c" }), 0); return () => {}; },
    serverTimestamp: () => STAMP,
    Timestamp: { fromMillis: ts },
    collection: () => ({ all: true }),
    doc: (db, ...path) => ({ id: path[path.length - 1], path }),
    where: (field, op, value) => ({ field, op, value }),
    query: (col, cond) => ({ cond }),
    async getDocs(q) {
      let entries = [...store];
      if (q && q.cond) entries = entries.filter(([, d]) => d[q.cond.field] && d[q.cond.field].ms > q.cond.value.ms);
      counter.reads += Math.max(1, entries.length);
      for (const [id, d] of entries) cache.set(id, d);
      return list(entries);
    },
    async getDocsFromCache() { return list([...cache]); },
    async getDoc(ref) { counter.reads++; return snapOf(ref.id, kind(ref) === "meta" ? meta.get(ref.id) : store.get(ref.id)); },
    async setDoc(ref, data) { write(ref, data); },
    async runTransaction(db, fn) {
      const tx = {
        get: async ref => { counter.reads++; return snapOf(ref.id, store.get(ref.id)); },
        set: (ref, data, opts) => write(ref, data, opts),
        delete: ref => remove(ref),
      };
      return fn(tx);
    },
    writeBatch: () => {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(["set", ref, data, opts]),
        delete: ref => ops.push(["delete", ref]),
        commit: async () => {
          const size = ops.reduce((n, op) => n + (op[2] ? fields(op[2]) : 1), 0);
          if (size > fieldLimit) throw Object.assign(new Error("Transaction too big. Decrease transaction size."), { code: "invalid-argument" });
          commits.push(ops.length);
          for (const [k, ref, data, opts] of ops) k === "set" ? write(ref, data, opts) : remove(ref);
        },
      };
    },
  };
}

const show = (id, watchedCount) => ({
  title: `Show ${id}`,
  watched: Object.fromEntries(Array.from({ length: watchedCount }, (_, k) => [`tvmaze:${id}${k}`, { s: 1, e: k + 1, at: null, keys: [`tvmaze:${id}${k}`] }])),
});
const withoutStamp = ({ _syncAt, ...rest }) => rest;
function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

test("replaceAll writes everything in batches the database accepts, splitting any it refuses", async () => {
  const sdk = fakeSdk({ fieldLimit: 3000 });
  sdk.store.set("old", { title: "gone" });
  const backend = FirebaseBackend.create(undefined, { sdk, storage: memoryStorage() });
  const map = {};
  for (let i = 0; i < 60; i++) map[String(i)] = show(i, i < 5 ? 300 : 20);
  const progress = [];
  await backend.replaceAll(map, (done, total) => progress.push([done, total]));
  assert.equal(sdk.store.size, 60);
  assert.equal(sdk.store.has("old"), false, "a show that isn't in the new library is removed");
  assert.deepEqual(withoutStamp(sdk.store.get("3")), map["3"]);
  assert.ok(sdk.store.get("3")._syncAt, "stamped with the server's time");
  assert.ok(sdk.meta.get("removed").old, "the removal is noted for other devices");
  assert.deepEqual(progress[progress.length - 1], [61, 61]);
  assert.ok(sdk.commits.length > 1);
});

test("a single show too big for the database is named in the error", async () => {
  const sdk = fakeSdk({ fieldLimit: 100 });
  const backend = FirebaseBackend.create(undefined, { sdk, storage: memoryStorage() });
  await assert.rejects(backend.replaceAll({ small: show("s", 2), huge: show("h", 200) }), /"huge" is too big/);
  assert.ok(sdk.store.has("small"), "what fits is written");
});

// ---- Loading only what changed (library-sync.js) ------------------------------
async function libraryOf(n) {
  const sdk = fakeSdk();
  const backend = FirebaseBackend.create(undefined, { sdk, storage: memoryStorage(), now: () => Date.parse("2026-11-07T10:00:00Z") + sdkTime(sdk) });
  for (let i = 0; i < n; i++) sdk.store.set(String(i), { ...show(i, 1), rev: 1 });
  return { sdk, backend };
}
// The test's "now" follows the fake server clock.
const sdkTimes = new WeakMap();
function sdkTime(sdk) { return sdkTimes.get(sdk) || 0; }
function advance(sdk, ms) { sdk.tick(ms); sdkTimes.set(sdk, sdkTime(sdk) + ms); }

test("the first load reads everything; the next only what changed, plus the removals note", async () => {
  const { sdk, backend } = await libraryOf(100);
  let r = await backend.loadAll();
  assert.equal(Object.keys(r.docs).length, 100);
  assert.equal(sdk.counter.reads, 100);
  advance(sdk, 60000);
  sdk.counter.reads = 0;
  r = await backend.loadAll();
  assert.equal(Object.keys(r.docs).length, 100, "the rest from the offline copy");
  assert.ok(sdk.counter.reads <= 2, `a quick load: ${sdk.counter.reads} reads`);
});

test("a show changed elsewhere comes in on the next quick load, without its stamp", async () => {
  const { sdk, backend } = await libraryOf(20);
  await backend.loadAll();
  advance(sdk, 60000);
  // Another device (or the bridge) saves show 7.
  const other = FirebaseBackend.create(undefined, { sdk, storage: memoryStorage() });
  await other.transact("7", current => ({ write: { ...current, title: "Changed", rev: 2 } }));
  sdk.cache.set("7", { ...show(7, 1), rev: 1 }); // this device's copy still has the old one
  advance(sdk, 60000);
  sdk.counter.reads = 0;
  const r = await backend.loadAll();
  assert.equal(r.docs["7"].title, "Changed");
  assert.equal("_syncAt" in r.docs["7"], false, "the rest of the app never sees the stamp");
  assert.ok(sdk.counter.reads <= 3, `${sdk.counter.reads} reads`);
});

test("a show removed elsewhere is gone on the next quick load; one added back stays", async () => {
  const { sdk, backend } = await libraryOf(10);
  await backend.loadAll();
  advance(sdk, 60000);
  const other = FirebaseBackend.create(undefined, { sdk, storage: memoryStorage() });
  await other.transact("3", () => ({ write: null }));
  await other.transact("4", () => ({ write: null }));
  advance(sdk, 1000);
  await other.transact("4", () => ({ write: { ...show(4, 2), rev: 1 } }));
  sdk.cache.set("3", { ...show(3, 1), rev: 1 }); // still in this device's copy
  advance(sdk, 60000);
  const r = await backend.loadAll();
  assert.equal(r.docs["3"], undefined);
  assert.ok(r.docs["4"], "saved again after its removal");
});

test("after a day, or with no offline copy, everything is read again", async () => {
  const { sdk, backend } = await libraryOf(30);
  await backend.loadAll();
  advance(sdk, 25 * 3600 * 1000);
  sdk.counter.reads = 0;
  await backend.loadAll();
  assert.equal(sdk.counter.reads, 30, "the daily full load");
  advance(sdk, 60000);
  sdk.cache.clear();
  sdk.counter.reads = 0;
  await backend.loadAll();
  assert.equal(sdk.counter.reads, 30, "no copy to build on");
});

test("a transaction never hands the stamp to the store, and stamps what it writes", async () => {
  const sdk = fakeSdk();
  const backend = FirebaseBackend.create(undefined, { sdk, storage: memoryStorage() });
  sdk.store.set("1", { title: "A", rev: 1, _syncAt: { ms: 1, toMillis: () => 1 } });
  let seen;
  const { doc } = await backend.transact("1", current => { seen = current; return { write: { ...current, rev: 2 } }; });
  assert.equal("_syncAt" in seen, false);
  assert.equal("_syncAt" in doc, false);
  assert.ok(sdk.store.get("1")._syncAt.ms > 1, "the new server time");
});
