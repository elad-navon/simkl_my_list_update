const test = require("node:test");
const assert = require("node:assert/strict");
const { FirebaseBackend } = require("../firebase-backend.js");

// A stand-in for the Firebase modules, just what sign-in touches.
function fakeSdk(calls) {
  return {
    initializeApp: () => ({}), getAuth: () => ({}),
    initializeFirestore: () => ({}), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    onAuthStateChanged: (auth, cb) => { setTimeout(() => cb(null), 0); return () => {}; },
    GoogleAuthProvider: Object.assign(function GoogleAuthProvider() {}, {
      credential: idToken => ({ idToken }),
    }),
    signInWithCredential: async (auth, cred) => {
      calls.push(["credential", cred.idToken]);
      return { user: { uid: "u1", email: "a@b.c", displayName: "A" } };
    },
    signInWithPopup: async () => {
      calls.push(["popup"]);
      return { user: { uid: "u2", email: "p@b.c", displayName: "P" } };
    },
    signOut: async () => { calls.push(["signOut"]); },
  };
}

// Like a real Capacitor plugin: a proxy that answers every property, `then`
// included - awaiting the plugin itself would never end.
function fakePlugin(handlers, calls) {
  return new Proxy({}, {
    get(_, prop) {
      if (prop in handlers) return (...args) => { calls.push(["plugin." + String(prop)]); return handlers[prop](...args); };
      return () => Promise.resolve();
    },
  });
}

test("in the app: the phone's Google sign-in token signs in to Firebase", async () => {
  const calls = [];
  const plugin = fakePlugin({ signInWithGoogle: async () => ({ credential: { idToken: "tok-1" } }) }, calls);
  const backend = FirebaseBackend.create(undefined, { sdk: fakeSdk(calls), nativeAuth: async () => ({ plugin }) });
  const who = await backend.signIn();
  assert.deepEqual(who, { uid: "u1", email: "a@b.c", name: "A" });
  assert.deepEqual(calls, [["plugin.signInWithGoogle"], ["credential", "tok-1"]]);
});

test("in the app: a dismissed account picker is a cancellation, Firebase never called", async () => {
  const calls = [];
  const plugin = fakePlugin({ signInWithGoogle: async () => { throw new Error("The user canceled the sign-in flow."); } }, calls);
  const backend = FirebaseBackend.create(undefined, { sdk: fakeSdk(calls), nativeAuth: async () => ({ plugin }) });
  await assert.rejects(backend.signIn(), e => e.cancelled === true && /cancelled/.test(e.message));
  assert.deepEqual(calls, [["plugin.signInWithGoogle"]]);
});

test("in the app: no token is an error, and Firebase is never called", async () => {
  const calls = [];
  const plugin = fakePlugin({ signInWithGoogle: async () => ({ credential: {} }) }, calls);
  const backend = FirebaseBackend.create(undefined, { sdk: fakeSdk(calls), nativeAuth: async () => ({ plugin }) });
  await assert.rejects(backend.signIn(), /sign-in token/);
  assert.deepEqual(calls, [["plugin.signInWithGoogle"]]);
});

test("in the app: sign-out signs out of the phone's Google sign-in too, and its failure isn't fatal", async () => {
  const calls = [];
  const plugin = fakePlugin({ signOut: async () => { throw new Error("plugin down"); } }, calls);
  const backend = FirebaseBackend.create(undefined, { sdk: fakeSdk(calls), nativeAuth: async () => ({ plugin }) });
  await backend.signOut();
  assert.deepEqual(calls, [["signOut"], ["plugin.signOut"]]);
});

test("in a browser: the Google popup, as before - no plugin", async () => {
  const calls = [];
  const backend = FirebaseBackend.create(undefined, { sdk: fakeSdk(calls), nativeAuth: null });
  const who = await backend.signIn();
  assert.equal(who.uid, "u2");
  await backend.signOut();
  assert.deepEqual(calls, [["popup"], ["signOut"]]);
});
