// The library store's backend on Firebase: Google sign-in + Firestore, one
// document per show under users/{uid}/shows/{docId}. Implements the
// contract in library-store.js (loadAll / transact / replaceAll) plus
// sign-in. The Firebase SDK is loaded on first use, from Google's CDN.
//
// The config below is meant to be public (it identifies the project, it
// grants nothing): access is enforced by the project's Firestore security
// rules, which only let the signed-in owner read or write their own data.
(function (root) {
  "use strict";

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyADIe3PN581o6MYWg06TJvXo7DeogVbeLk",
    authDomain: "tv-library-c29bd.firebaseapp.com",
    projectId: "tv-library-c29bd",
    storageBucket: "tv-library-c29bd.firebasestorage.app",
    messagingSenderId: "680461200363",
    appId: "1:680461200363:web:210430a6e9953e49fd87ae",
  };
  const SDK = "https://www.gstatic.com/firebasejs/10.14.1";

  // Network-type failures (worth retrying); anything else - e.g. the rules
  // refusing access, or the day's free quota used up - is permanent.
  const TRANSIENT = ["unavailable", "deadline-exceeded", "aborted", "cancelled", "internal"];
  function classify(e) {
    const code = String((e && e.code) || "").replace(/^firestore\//, "");
    if (TRANSIENT.includes(code) || (typeof navigator !== "undefined" && navigator.onLine === false)) e.transient = true;
    if (code === "resource-exhausted") e.message = "The free daily database quota is used up - it resets tomorrow.";
    if (code === "permission-denied") e.message = "The database refused access (security rules).";
    return e;
  }

  // Every value in a document, nested ones included - roughly how many
  // index entries Firestore makes for it.
  function countFields(v) {
    if (Array.isArray(v)) return 1 + v.reduce((n, x) => n + countFields(x), 0);
    if (v && typeof v === "object") return Object.values(v).reduce((n, x) => n + countFields(x), 0);
    return 1;
  }

  // `sdk` (tests only) stands in for the Firebase modules.
  function create(config = FIREBASE_CONFIG, { sdk: testSdk } = {}) {
    let sdk = null;
    let auth = null, db = null, user = null;
    let readyPromise = null;

    function ready() {
      if (!readyPromise) {
        readyPromise = (async () => {
          const mods = testSdk ? [testSdk] : await Promise.all([
            import(`${SDK}/firebase-app.js`),
            import(`${SDK}/firebase-auth.js`),
            import(`${SDK}/firebase-firestore.js`),
          ]);
          sdk = Object.assign({}, ...mods);
          const app = sdk.initializeApp(config);
          auth = sdk.getAuth(app);
          db = sdk.initializeFirestore(app, {
            ignoreUndefinedProperties: true,
            localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }),
          });
          user = await new Promise(resolve => {
            const stop = sdk.onAuthStateChanged(auth, u => { stop(); resolve(u); });
          });
          sdk.onAuthStateChanged(auth, u => { user = u; });
        })();
      }
      return readyPromise;
    }

    function requireUser() {
      if (!user) throw new Error("Not signed in");
      return user.uid;
    }
    const showsCol = () => sdk.collection(db, "users", requireUser(), "shows");
    const showRef = id => sdk.doc(db, "users", requireUser(), "shows", id);

    return {
      ready,
      currentUser: () => (user ? { uid: user.uid, email: user.email, name: user.displayName } : null),
      async signIn() {
        await ready();
        const result = await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
        user = result.user;
        return this.currentUser();
      },
      async signOut() {
        await ready();
        await sdk.signOut(auth);
        user = null;
      },

      async loadAll() {
        await ready();
        try {
          const snap = await sdk.getDocs(showsCol());
          const docs = {};
          snap.forEach(d => { docs[d.id] = d.data(); });
          return { docs };
        } catch (e) { throw classify(e); }
      },

      // Firestore re-runs the function if the document changed between the
      // read and the write, so `update` always sees the latest copy.
      async transact(docId, update) {
        await ready();
        try {
          const doc = await sdk.runTransaction(db, async tx => {
            const ref = showRef(docId);
            const snap = await tx.get(ref);
            const current = snap.exists() ? snap.data() : null;
            const out = update(current);
            if (out.skip) return current;
            if (out.write === null) { tx.delete(ref); return null; }
            tx.set(ref, out.write);
            return out.write;
          });
          return { doc };
        } catch (e) {
          if (e && e.conflict) throw e;
          throw classify(e);
        }
      },

      // Replaces the whole library (restore from a backup, or the import),
      // a few documents per commit. Firestore limits a commit by its writes,
      // its bytes, and the index entries it creates - one or more per field,
      // and a viewing history has thousands of fields - and rejects a whole
      // commit that's over ("Transaction too big"). So batches stay small by
      // field count too, and a batch that's still refused is split in half
      // and retried. onProgress(done, total) after each commit. Not atomic
      // across commits: running it again finishes an interrupted run (every
      // write sets a whole document).
      async replaceAll(map, onProgress) {
        await ready();
        const existing = await sdk.getDocs(showsCol()).catch(e => { throw classify(e); });
        const ops = [];
        existing.forEach(d => { if (!(d.id in map)) ops.push({ id: d.id, size: 100, fields: 1, run: b => b.delete(d.ref) }); });
        for (const [id, data] of Object.entries(map)) {
          ops.push({ id, size: JSON.stringify(data).length + id.length, fields: countFields(data), run: b => b.set(showRef(id), data) });
        }
        let done = 0;
        const commit = async list => {
          const batch = sdk.writeBatch(db);
          list.forEach(op => op.run(batch));
          try {
            await batch.commit();
          } catch (e) {
            if (!/too big|too large|exceeds/i.test(String(e && e.message))) throw classify(e);
            if (list.length === 1) {
              e.message = `The show "${list[0].id}" is too big to save in one piece (${list[0].fields} fields).`;
              throw e;
            }
            const half = Math.ceil(list.length / 2);
            await commit(list.slice(0, half));
            await commit(list.slice(half));
            return;
          }
          done += list.length;
          if (onProgress) onProgress(done, ops.length);
          await new Promise(r => setTimeout(r, 0)); // let the page breathe
        };
        let i = 0;
        while (i < ops.length) {
          const list = [];
          let bytes = 0, fields = 0;
          while (i < ops.length && list.length < 100 &&
            (!list.length || (bytes + ops[i].size < 1000000 && fields + ops[i].fields < 8000))) {
            bytes += ops[i].size;
            fields += ops[i].fields;
            list.push(ops[i++]);
          }
          await commit(list);
        }
      },

      // Small shared settings next to the library (users/{uid}/meta/{name}),
      // e.g. how far the SIMKL auto-marking has read.
      async getMeta(name) {
        await ready();
        try {
          const snap = await sdk.getDoc(sdk.doc(db, "users", requireUser(), "meta", name));
          return snap.exists() ? snap.data() : null;
        } catch (e) { throw classify(e); }
      },
      async setMeta(name, data) {
        await ready();
        try {
          await sdk.setDoc(sdk.doc(db, "users", requireUser(), "meta", name), data);
        } catch (e) { throw classify(e); }
      },

      // For the self-check page only: whether another user's data is
      // readable (it must not be).
      async canReadOtherUser() {
        await ready();
        try {
          await sdk.getDocs(sdk.collection(db, "users", "someone-else-entirely", "shows"));
          return true;
        } catch (e) {
          return String(e.code || "").endsWith("permission-denied") ? false : Promise.reject(classify(e));
        }
      },
    };
  }

  root.FirebaseBackend = { create, FIREBASE_CONFIG };
})(typeof self !== "undefined" ? self : this);
