// Loads named top-level functions straight out of the page script (app/*.js,
// in index.html's order) without running the rest of it, which needs a
// browser, so tests can check new data against the exact code the UI uses
// today.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const APP_FILES = [...fs.readFileSync(path.join(ROOT, "index.html"), "utf8").matchAll(/<script src="(app\/[\w-]+\.js)">/g)].map(m => m[1]);
const APP_SRC = "\n" + APP_FILES.map(f => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n").replace(/\r\n/g, "\n");

function extractFunction(name) {
  const re = new RegExp(`\\n((?:async )?function ${name}\\([\\s\\S]*?\\n}\\n)`);
  const m = re.exec(APP_SRC);
  if (!m) throw new Error(`function ${name} not found in app/*.js`);
  return m[1];
}

function loadAppFunctions(names, globals = {}) {
  const context = { ...globals };
  vm.createContext(context);
  vm.runInContext(names.map(extractFunction).join("\n"), context);
  const out = {};
  for (const n of names) out[n] = vm.runInContext(n, context);
  return out;
}

module.exports = { loadAppFunctions };
