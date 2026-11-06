// Runs every scenario of tests/compare-modes.harness.html in a headless
// Chrome and prints a summary: node tests/run-browser.mjs [scenario ...]
//
// Serves the project itself (a small static server on a free port), starts
// Chrome with its debugging port, and reads each run's result off the page
// in real time - "onair" waits for real moments an episode starts and ends,
// so the whole run takes a few minutes. Exits 1 if anything failed.
// CHROME=<path> picks the browser (default: Chrome's usual Windows place).
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALL = ["main", "ui", "writes", "onair", "airtimes", "posters", "nowwatching", "order", "stats"];
const scenarios = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TIMEOUT_MS = 6 * 60 * 1000;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

// ---- A static server for the project ----------------------------------------
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(data);
  });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- Chrome, driven through its debugging port --------------------------------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "harness-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsBase = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", d => { buf += d; const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf); if (m) resolve(m[1]); });
  chrome.on("exit", () => reject(new Error(`Chrome didn't start (${CHROME})`)));
});
const debugPort = new URL(wsBase).port;

async function runScenario(name) {
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push(((d.exception && d.exception.description) || d.text || "").split("\n")[0]);
    }
  };
  await new Promise(r => (ws.onopen = r));
  await send("Runtime.enable");
  const query = name === "main" ? "" : `?scenario=${name}`;
  await send("Page.navigate", { url: `${base}/tests/compare-modes.harness.html${query}` });
  const start = Date.now();
  let text = null;
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 2000));
    const r = await send("Runtime.evaluate", { expression: `(() => { const o = document.getElementById("result"); return o && o.dataset.done ? o.textContent : null; })()`, returnByValue: true });
    if (r && r.result && r.result.value) { text = r.result.value; break; }
  }
  ws.close();
  const secs = Math.round((Date.now() - start) / 1000);
  if (!text) return { name, ok: false, secs, lines: ["did not finish in time"], errors };
  const data = JSON.parse(text);
  if (data.harnessError) return { name, ok: false, secs, lines: [data.harnessError.split("\n")[0]], errors };
  // "main": the page against tests/golden/panels.json - "diffs" lists what differs.
  if (!data.writes) {
    const diffs = data.diffs || [];
    return { name, ok: !diffs.length, secs, lines: diffs.map(d => `differs from the golden file: ${d}`), errors, count: 1 };
  }
  const failed = data.writes.filter(c => !c.ok);
  return { name, ok: !failed.length, secs, lines: failed.map(c => `${c.name}  ${JSON.stringify(c.detail).slice(0, 300)}`), errors, count: data.writes.length };
}

let allOk = true;
try {
  for (const name of scenarios) {
    const r = await runScenario(name);
    const ok = r.ok && !r.errors.length;
    allOk = allOk && ok;
    const passed = r.count != null ? `${r.count - (r.ok ? 0 : r.lines.length)}/${r.count}` : "";
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(12)} ${passed.padEnd(7)} ${r.secs}s`);
    for (const l of r.lines) console.log(`        - ${l}`);
    for (const e of r.errors) console.log(`        ! page error: ${e}`);
  }
} finally {
  chrome.kill();
  server.close();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1000);
}
console.log(allOk ? "\nAll browser scenarios passed." : "\nSome browser scenarios failed.");
process.exitCode = allOk ? 0 : 1;
