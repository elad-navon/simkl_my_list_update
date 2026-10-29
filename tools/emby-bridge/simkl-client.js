// The bridge's own SIMKL sign-in, for air times only (read-only): SIMKL turns
// away any request without a user's token. Signed in once with
// `node run.js --simkl-login` (a code to enter at simkl.com/pin, as the site
// does it - SIMKL's device flow); the token is kept in simkl-token.json next
// to this file (never versioned) and renewed before it runs out. Separate
// from the browser's sign-in, so neither renewal undoes the other.
"use strict";

const fs = require("fs");

const SIMKL_BASE = "https://api.simkl.com";
const APP_NAME = "my-list-summary-web";
const APP_VERSION = "1.0";
const DAY_MS = 86400000;
const GAP_MS = 150; // SIMKL allows 10 GETs a second; the bridge needs far fewer
const TIMEOUT_MS = 15000;

function createSimklClient({ clientId, file, fetch = (...a) => globalThis.fetch(...a), log = console.log, now = () => Date.now() }) {
  let auth = read();
  let refreshing = null;
  let nextAt = 0;

  function read() {
    try {
      const a = JSON.parse(fs.readFileSync(file, "utf8"));
      return a && a.access ? a : null;
    } catch (e) {
      return null;
    }
  }

  // A token-endpoint answer: access tokens last 7 days, refresh tokens 180
  // (renewed on every use); one without a new refresh token keeps the old.
  function save(tok) {
    auth = {
      access: tok.access_token,
      refresh: tok.refresh_token || (auth && auth.refresh) || null,
      expiresAt: now() + (tok.expires_in || 7 * 86400) * 1000,
      refreshExpiresAt: now() + 180 * DAY_MS,
    };
    fs.writeFileSync(file, JSON.stringify(auth, null, 2));
  }

  async function timed(url, options) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try { return await fetch(url, { ...options, signal: ctl.signal }); } finally { clearTimeout(timer); }
  }

  async function oauthPost(path, fields) {
    const res = await timed(`${SIMKL_BASE}${path}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields),
    });
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    return { status: res.status, ok: res.ok, data };
  }

  function refresh() {
    if (!refreshing) {
      refreshing = (async () => {
        if (!auth || !auth.refresh || auth.refreshExpiresAt < now()) throw new Error("SIMKL sign-in expired - run: node run.js --simkl-login");
        const r = await oauthPost("/oauth2/token", { grant_type: "refresh_token", refresh_token: auth.refresh, client_id: clientId });
        if (r.ok && r.data && r.data.access_token) return save(r.data);
        if (r.status === 400 || r.status === 401) {
          auth = null;
          try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
        }
        throw new Error("SIMKL sign-in expired - run: node run.js --simkl-login");
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function token() {
    if (!auth) return null;
    if (auth.expiresAt - now() < DAY_MS) {
      try { await refresh(); } catch (e) { if (!auth || auth.expiresAt <= now()) return null; }
    }
    return auth ? auth.access : null;
  }

  // A SIMKL GET: the JSON, or null for a 404.
  async function get(path, params) {
    const at = Math.max(now(), nextAt);
    nextAt = at + GAP_MS;
    if (at > now()) await new Promise(r => setTimeout(r, at - now()));
    const qs = new URLSearchParams({ client_id: clientId, "app-name": APP_NAME, "app-version": APP_VERSION, ...(params || {}) });
    for (let attempt = 0; ; attempt++) {
      const tok = await token();
      if (!tok) throw new Error("Not signed in to SIMKL");
      const res = await timed(`${SIMKL_BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${tok}` } });
      if (res.status === 401 && attempt === 0) { await refresh(); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`SIMKL ${path}: ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }

  // The one-time sign-in: shows a code to enter at simkl.com/pin and waits.
  async function login() {
    const dev = await oauthPost("/oauth2/device", { client_id: clientId, scope: "media:read" });
    if (!dev.ok || !dev.data || !dev.data.device_code) {
      throw new Error(`SIMKL sign-in could not start (${dev.status}): ${(dev.data && (dev.data.error_description || dev.data.error)) || "no details"}`);
    }
    const { device_code: deviceCode, user_code: userCode } = dev.data;
    log(`Go to ${dev.data.verification_uri || "https://simkl.com/pin"} and enter the code: ${userCode}`);
    let intervalMs = (dev.data.interval || 5) * 1000;
    const deadline = now() + (dev.data.expires_in || 900) * 1000;
    while (now() < deadline) {
      await new Promise(r => setTimeout(r, intervalMs));
      let r;
      try {
        r = await oauthPost("/oauth2/token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: deviceCode });
      } catch (e) {
        continue; // the network: keep waiting
      }
      if (r.ok && r.data && r.data.access_token) { save(r.data); return; }
      const err = r.data && r.data.error;
      if (err === "authorization_pending") continue;
      if (err === "slow_down") { intervalMs += 5000; continue; }
      throw new Error(`SIMKL sign-in failed (${r.status}): ${(r.data && (r.data.error_description || r.data.error)) || "no details"}`);
    }
    throw new Error("Timed out waiting for the code to be entered.");
  }

  return { get, login, signedIn: () => !!auth };
}

module.exports = { createSimklClient };
