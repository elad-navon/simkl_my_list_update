// Whether the database's live security rules are the ones in the repo
// (firestore.rules). They're the whole of the site's access control - only
// the owner's verified Google account reads or writes - and live only in the
// Firebase console, where a change leaves no history; the bridge compares
// them at start and once a day, and a difference shows in its pulse
// (bridge-status.js) and in `node run.js --check`.
"use strict";

const fs = require("fs");
const path = require("path");

const RULES_FILE = path.join(__dirname, "..", "..", "firestore.rules");

// Line ends and trailing spaces aside, the same text.
const normalize = text => String(text || "").replace(/\r\n/g, "\n").split("\n").map(l => l.replace(/\s+$/, "")).join("\n").trim();

// compareRules({ getLive, file }) -> { same, firstDifference }
// - getLive(): resolves to the live rules' text
// - firstDifference: "line 5: <repo> | <live>", or null when the same
async function compareRules({ getLive, file = RULES_FILE, readFile = f => fs.readFileSync(f, "utf8") }) {
  const local = normalize(readFile(file)).split("\n");
  const live = normalize(await getLive()).split("\n");
  for (let i = 0; i < Math.max(local.length, live.length); i++) {
    if (local[i] !== live[i]) {
      return { same: false, firstDifference: `line ${i + 1}: repo "${(local[i] || "").trim()}" | live "${(live[i] || "").trim()}"` };
    }
  }
  return { same: true, firstDifference: null };
}

// The live rules' text, through the Admin SDK's security-rules API.
function liveRulesGetter(admin) {
  return async () => {
    const ruleset = await admin.securityRules().getFirestoreRuleset();
    return ruleset.source.map(s => s.content).join("\n");
  };
}

module.exports = { compareRules, liveRulesGetter, normalize, RULES_FILE };
