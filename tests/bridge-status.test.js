const test = require("node:test");
const assert = require("node:assert/strict");
const { createHeartbeat, summarizeBridgeStatus, META, DOWN_AFTER_MS } = require("../bridge-status.js");

const NOW = Date.parse("2026-11-06T20:00:00Z");
const MIN = 60000;

function setup() {
  let t = NOW;
  const writes = [];
  const backend = { async setMeta(name, data) { writes.push({ name, data }); } };
  const hb = createHeartbeat({ backend, now: () => t, host: "PC" });
  return { hb, writes, advance: ms => { t += ms; } };
}

// ---- The bridge's side --------------------------------------------------------
test("writes at once, then only every 10 minutes while nothing changes", async () => {
  const { hb, writes, advance } = setup();
  hb.simkl("signedIn");
  hb.pass(null);
  assert.equal(await hb.tick(), true);
  for (let i = 0; i < 9; i++) { advance(MIN); hb.pass(null); await hb.tick(); }
  assert.equal(writes.length, 1, "a pass a minute doesn't write each time");
  advance(MIN);
  await hb.tick();
  assert.equal(writes.length, 2);
  assert.equal(writes[0].name, META);
  assert.equal(writes[1].data.at, new Date(NOW + 10 * MIN).toISOString());
});

test("a problem appearing or going away is written at once", async () => {
  const { hb, writes, advance } = setup();
  hb.simkl("signedIn");
  await hb.tick();
  advance(MIN);
  hb.simkl("signedIn", new Error("SIMKL sign-in expired - run: node run.js --simkl-login"));
  await hb.tick();
  assert.equal(writes.length, 2);
  assert.match(writes[1].data.simklError, /expired/);
  advance(MIN);
  hb.simkl("signedIn", null);
  await hb.tick();
  assert.equal(writes.length, 3);
  assert.equal(writes[2].data.simklError, null);
  advance(MIN);
  hb.pass(new Error("Emby /Sessions: 500"));
  await hb.tick();
  assert.equal(writes.length, 4);
  assert.equal(writes[3].data.lastPass.error, "Emby /Sessions: 500");
});

// ---- The site's side ----------------------------------------------------------
const doc = (over = {}) => ({
  v: 1, at: new Date(NOW - 4 * MIN).toISOString(), simkl: "signedIn", simklError: null, tvdbRejected: false,
  lastPass: { at: new Date(NOW - MIN).toISOString(), error: null }, lastAiring: null, ...over,
});

test("all well: green, how long ago, SIMKL signed in", () => {
  const s = summarizeBridgeStatus(doc(), NOW);
  assert.equal(s.level, "ok");
  assert.equal(s.text, "Computer bridge: 4 min ago · SIMKL signed in");
  assert.deepEqual(s.problems, []);
});

test("SIMKL not signed in - what happened in October - is a problem, with what to do", () => {
  const s = summarizeBridgeStatus(doc({ simkl: "signedOut" }), NOW);
  assert.equal(s.level, "warn");
  assert.match(s.text, /SIMKL not working/);
  assert.match(s.problems[0], /node run\.js --simkl-login/);
});

test("Emby failing, TheTVDB refusing the key, the widget's pass failing: each listed", () => {
  const s = summarizeBridgeStatus(doc({ tvdbRejected: true, lastPass: { at: doc().at, error: "fetch failed" }, lastAiring: { at: doc().at, error: "TMDB 500" } }), NOW);
  assert.equal(s.level, "warn");
  assert.deepEqual(s.problems, ["TheTVDB refused the key in Settings", "Emby: fetch failed", "Airing Next for the widget: TMDB 500"]);
});

test("not heard from for over 35 minutes: down, whatever it last said", () => {
  assert.equal(summarizeBridgeStatus(doc({ at: new Date(NOW - DOWN_AFTER_MS + MIN).toISOString() }), NOW).level, "ok");
  const s = summarizeBridgeStatus(doc({ at: new Date(NOW - 3 * 3600000).toISOString() }), NOW);
  assert.equal(s.level, "down");
  assert.equal(s.text, "Computer bridge: not heard from since 3 h ago - is the computer on?");
});

test("never reported, or an unreadable time", () => {
  assert.equal(summarizeBridgeStatus(null, NOW).level, "none");
  const bad = summarizeBridgeStatus(doc({ at: "nonsense" }), NOW);
  assert.equal(bad.level, "down");
  assert.equal(bad.text, "Computer bridge: not heard from since a while - is the computer on?");
});
