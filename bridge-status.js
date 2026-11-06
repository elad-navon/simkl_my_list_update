// The computer bridge's pulse (tools/emby-bridge): what it last did and
// whether its outside sign-ins still work, kept in the account (meta
// "bridgeStatus") and shown in the site's Settings - so a bridge that
// stopped, or lost its SIMKL sign-in (it ran a week without one, unnoticed,
// in October 2026), shows up where it's seen, not only in the computer's log.
//
// createHeartbeat (the bridge) keeps the state and writes it every 10
// minutes, or at once when something that matters changes;
// summarizeBridgeStatus (the site) turns the document into one line and a
// level: ok, warn (running, with a problem) or down (not heard from).
// Runs in the browser (window.BridgeStatus) and in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BridgeStatus = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const META = "bridgeStatus";
  const WRITE_EVERY_MS = 10 * 60 * 1000;
  // Not heard from for this long: the bridge (or the computer) is down. Three
  // missed writes, so one slow pass or a restart isn't flagged.
  const DOWN_AFTER_MS = 35 * 60 * 1000;

  // createHeartbeat({ backend, now, startedAt, host })
  // - backend.setMeta(name, data)
  // Returns { pass, airing, simkl, tvdbRejected, tick }:
  // - pass(error|null), airing(error|null): how the last Emby pass / Airing
  //   Next pass went
  // - simkl(state, error|null): "signedIn" | "signedOut", and the last SIMKL
  //   failure (e.g. the sign-in expired), or null after a good answer
  // - tvdbRejected(bool): TheTVDB refused the key
  // - tick(): writes the document if it's due or something changed;
  //   resolves to true when it wrote
  function createHeartbeat({ backend, now = () => Date.now(), startedAt = now(), host = null }) {
    const iso = ms => new Date(ms).toISOString();
    const state = {
      v: 1, startedAt: iso(startedAt), host,
      lastPass: null, lastAiring: null,
      simkl: "signedOut", simklError: null, tvdbRejected: false,
    };
    let lastWrite = 0;
    let lastKey = null;
    // What a write is due for at once: the problems, not the times.
    const keyOf = s => JSON.stringify([s.simkl, s.simklError, s.tvdbRejected,
      s.lastPass && s.lastPass.error, s.lastAiring && s.lastAiring.error]);
    const message = e => (e ? String((e && e.message) || e).slice(0, 200) : null);

    return {
      pass(error) { state.lastPass = { at: iso(now()), error: message(error) }; },
      airing(error) { state.lastAiring = { at: iso(now()), error: message(error) }; },
      simkl(signedIn, error = null) { state.simkl = signedIn; state.simklError = message(error); },
      tvdbRejected(rejected) { state.tvdbRejected = !!rejected; },
      async tick() {
        const key = keyOf(state);
        if (now() - lastWrite < WRITE_EVERY_MS && key === lastKey) return false;
        await backend.setMeta(META, { ...state, at: iso(now()) });
        lastWrite = now();
        lastKey = key;
        return true;
      },
      state: () => ({ ...state }),
    };
  }

  // A short "how long ago": "just now", "12 min ago", "3 h ago", "2 days ago".
  function ago(ms) {
    if (!isFinite(ms)) return "a while";
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.floor(h / 24)} days ago`;
  }

  // summarizeBridgeStatus(doc, now) -> { level, text, problems }
  // - level: "ok" | "warn" | "down" | "none" (never reported)
  // - text: the one line ("Computer bridge: 4 min ago · SIMKL signed in")
  // - problems: what's wrong, one line each
  function summarizeBridgeStatus(doc, now = Date.now()) {
    if (!doc || !doc.at) {
      return { level: "none", text: "Computer bridge: hasn't reported yet", problems: [] };
    }
    const since = now - Date.parse(doc.at);
    const problems = [];
    if (doc.simkl !== "signedIn") problems.push("SIMKL isn't signed in - on the computer: node run.js --simkl-login");
    else if (doc.simklError) problems.push(`SIMKL: ${doc.simklError}`);
    if (doc.tvdbRejected) problems.push("TheTVDB refused the key in Settings");
    if (doc.lastPass && doc.lastPass.error) problems.push(`Emby: ${doc.lastPass.error}`);
    if (doc.lastAiring && doc.lastAiring.error) problems.push(`Airing Next for the widget: ${doc.lastAiring.error}`);
    const simkl = doc.simkl === "signedIn" && !doc.simklError ? "SIMKL signed in" : "SIMKL not working";
    if (!(since < DOWN_AFTER_MS)) {
      return { level: "down", text: `Computer bridge: not heard from since ${ago(since)} - is the computer on?`, problems };
    }
    return { level: problems.length ? "warn" : "ok", text: `Computer bridge: ${ago(since)} · ${simkl}`, problems };
  }

  return { createHeartbeat, summarizeBridgeStatus, META, WRITE_EVERY_MS, DOWN_AFTER_MS };
});
