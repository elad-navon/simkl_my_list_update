const test = require("node:test");
const assert = require("node:assert/strict");
const { FirebaseBackend } = require("../firebase-backend.js");

// A stand-in for the Firebase modules: one signed-in user, a document store,
// and a commit that - like Firestore - refuses a batch over a size limit
// ("Transaction too big"), here counted in fields.
function fakeSdk({ fieldLimit }) {
  const store = new Map();
  const commits = [];
  const fields = v => (Array.isArray(v) ? 1 + v.reduce((n, x) => n + fields(x), 0)
    : v && typeof v === "object" ? Object.values(v).reduce((n, x) => n + fields(x), 0) : 1);
  return {
    store, commits,
    initializeApp: () => ({}), getAuth: () => ({}),
    initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    onAuthStateChanged: (auth, cb) => { setTimeout(() => cb({ uid: "u1", email: "a@b.c" }), 0); return () => {}; },
    collection: () => ({}),
    doc: (db, ...path) => ({ id: path[path.length - 1] }),
    getDocs: async () => ({ forEach: fn => [...store].forEach(([id, data]) => fn({ id, ref: { id }, data: () => data })) }),
    writeBatch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push(["set", ref.id, data]),
        delete: ref => ops.push(["delete", ref.id]),
        commit: async () => {
          const size = ops.reduce((n, op) => n + (op[2] ? fields(op[2]) : 1), 0);
          if (size > fieldLimit) throw Object.assign(new Error("Transaction too big. Decrease transaction size."), { code: "invalid-argument" });
          commits.push(ops.length);
          for (const [kind, id, data] of ops) kind === "set" ? store.set(id, data) : store.delete(id);
        },
      };
    },
  };
}

const show = (id, watchedCount) => ({
  title: `Show ${id}`,
  watched: Object.fromEntries(Array.from({ length: watchedCount }, (_, k) => [`tvmaze:${id}${k}`, { s: 1, e: k + 1, at: null, keys: [`tvmaze:${id}${k}`] }])),
});

test("replaceAll writes everything in batches the database accepts, splitting any it refuses", async () => {
  const sdk = fakeSdk({ fieldLimit: 3000 });
  sdk.store.set("old", { title: "gone" });
  const backend = FirebaseBackend.create(undefined, { sdk });
  const map = {};
  for (let i = 0; i < 60; i++) map[String(i)] = show(i, i < 5 ? 300 : 20);
  const progress = [];
  await backend.replaceAll(map, (done, total) => progress.push([done, total]));
  assert.equal(sdk.store.size, 60);
  assert.equal(sdk.store.has("old"), false, "a show that isn't in the new library is removed");
  assert.deepEqual(sdk.store.get("3"), map["3"]);
  assert.deepEqual(progress[progress.length - 1], [61, 61]);
  assert.ok(sdk.commits.length > 1);
});

test("a single show too big for the database is named in the error", async () => {
  const sdk = fakeSdk({ fieldLimit: 100 });
  const backend = FirebaseBackend.create(undefined, { sdk });
  await assert.rejects(backend.replaceAll({ small: show("s", 2), huge: show("h", 200) }), /"huge" is too big/);
  assert.ok(sdk.store.has("small"), "what fits is written");
});
