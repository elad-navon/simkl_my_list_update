// Loads named top-level functions straight out of app.js (without running
// the rest of it, which needs a browser), so tests can check new data
// against the exact code the UI uses today.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_SRC = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8").replace(/\r\n/g, "\n");

function extractFunction(name) {
  const re = new RegExp(`\\n((?:async )?function ${name}\\([\\s\\S]*?\\n}\\n)`);
  const m = re.exec(APP_SRC);
  if (!m) throw new Error(`function ${name} not found in app.js`);
  return m[1];
}

function loadAppFunctions(names) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(names.map(extractFunction).join("\n"), context);
  const out = {};
  for (const n of names) out[n] = vm.runInContext(n, context);
  return out;
}

module.exports = { loadAppFunctions };
