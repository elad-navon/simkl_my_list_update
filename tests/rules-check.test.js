const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { compareRules, RULES_FILE } = require("../tools/emby-bridge/rules-check.js");
const { createHeartbeat, summarizeBridgeStatus } = require("../bridge-status.js");

const repo = fs.readFileSync(RULES_FILE, "utf8");

test("the repo's rules: only the owner's verified account, only under users/{their uid}", () => {
  assert.match(repo, /match \/users\/\{uid\}\/\{document=\*\*\}/);
  assert.match(repo, /request\.auth\.uid == uid/);
  assert.match(repo, /request\.auth\.token\.email_verified == true/);
  assert.equal((repo.match(/allow /g) || []).length, 1, "one allow rule, nothing else opened");
});

test("the same rules, line ends and trailing spaces aside: same", async () => {
  const r = await compareRules({ getLive: async () => repo.replace(/\n/g, "  \r\n") });
  assert.deepEqual(r, { same: true, firstDifference: null });
});

test("a changed line: different, and which line", async () => {
  const live = repo.replace("email_verified == true", "email_verified == false");
  const r = await compareRules({ getLive: async () => live });
  assert.equal(r.same, false);
  assert.match(r.firstDifference, /^line 8: repo ".*== true;" \| live ".*== false;"$/);
});

test("rules that differ show in the pulse as a problem", async () => {
  const writes = [];
  const hb = createHeartbeat({ backend: { async setMeta(n, d) { writes.push(d); } }, now: () => Date.parse("2026-11-06T20:00:00Z") });
  hb.simkl("signedIn");
  hb.rulesDiffer(true);
  await hb.tick();
  const s = summarizeBridgeStatus(writes[0], Date.parse("2026-11-06T20:01:00Z"));
  assert.equal(s.level, "warn");
  assert.match(s.problems[0], /security rules/);
});
