// The air times the bridge takes from SIMKL, kept in the account (meta
// "airTimes") for browsers without a SIMKL sign-in of their own - the phone
// app (AirTimes.applySharedTimes in app.js). Each show's latest times replace
// its earlier ones; a time a week past is dropped. Written only when
// something changed. The document holds one JSON string (`json`), as
// "airingNext" does: { v: 1, updatedAt, shows: { [sharedKey]: { "s-e": ISO } } }
"use strict";

const DOC = "airTimes";
const KEEP_PAST_MS = 7 * 86400000;

function createSharedAirTimes({ AirTimes, backend, now = () => Date.now() }) {
  let shows = null;
  let savedJson = null;

  async function load() {
    if (shows) return;
    const saved = await backend.getMeta(DOC).catch(() => null);
    try {
      shows = (saved && typeof saved.json === "string" && JSON.parse(saved.json).shows) || {};
    } catch (e) {
      shows = {};
    }
    savedJson = JSON.stringify(shows);
  }

  // enrich(ids, episodes) that also notes the times it took.
  function recording(enrich) {
    return async (ids, eps) => {
      const out = await enrich(ids, eps);
      const key = AirTimes.sharedKey(ids);
      const taken = AirTimes.takenTimes(out);
      if (shows && key && taken) shows[key] = taken;
      return out;
    };
  }

  // Writes the times if they changed; true if it did.
  async function save() {
    if (!shows) return false;
    const cutoff = now() - KEEP_PAST_MS;
    for (const [key, times] of Object.entries(shows)) {
      for (const [ep, iso] of Object.entries(times)) if (!(Date.parse(iso) >= cutoff)) delete times[ep];
      if (!Object.keys(times).length) delete shows[key];
    }
    const json = JSON.stringify(shows);
    if (json === savedJson) return false;
    const updatedAt = new Date(now()).toISOString();
    await backend.setMeta(DOC, { json: JSON.stringify({ v: 1, updatedAt, shows }), updatedAt });
    savedJson = json;
    return true;
  }

  return { load, recording, save };
}

module.exports = { createSharedAirTimes };
