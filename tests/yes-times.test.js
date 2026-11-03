const test = require("node:test");
const assert = require("node:assert/strict");
const { createYesAirTimes, applyYesTimes, nameKeys, episodeNumber, israelDate } = require("../yes-times.js");
const { memoryCache } = require("../episode-source.js");

const DAY = 86400000;
// Noon in Israel on 2026-11-01 (UTC+2).
const NOW = Date.parse("2026-11-01T10:00:00Z");
const TOMORROW = "2026-11-02";

const dateOnly = (season, episode, date) => ({ season, episode, date, hasTime: false, title: `E${episode}` });
const item = (title, starts, description = "") => ({ title, starts, description });

test("nameKeys: Israel left out, in English and Hebrew; too short is no key", () => {
  assert.deepEqual(nameKeys(["The Voice Israel", "דה וויס ישראל"]), ["the voice", "דה וויס"]);
  assert.deepEqual(nameKeys(["Fauda", "פאודה"]), ["fauda", "פאודה"]);
  assert.deepEqual(nameKeys(["Ha", null]), []);
});

test("episodeNumber: from the title, else the description", () => {
  assert.equal(episodeNumber(item("The Voice All Stars - פרק 9", "x")), 9);
  assert.equal(episodeNumber(item("פאודה", "x", "עונה 5, פרק 3: ...")), 3);
  assert.equal(episodeNumber(item("חדשות", "x")), null);
});

test("applyYesTimes: The Voice Israel takes the 21:15 of 'The Voice All Stars - פרק 9'", () => {
  const eps = [dateOnly(1, 8, "2026-10-26"), dateOnly(1, 9, TOMORROW)];
  const out = applyYesTimes(eps, {
    [TOMORROW]: [
      item("חדשות 12", "2026-11-02T20:00:00+02:00"),
      item("The Voice All Stars - פרק 9", "2026-11-02T21:15:00+02:00"),
    ],
  }, ["The Voice Israel", "The Voice ישראל"]);
  assert.equal(out[0], eps[0]);
  assert.equal(out[1].hasTime, true);
  assert.equal(out[1].date, "2026-11-02T19:15:00.000Z");
  assert.equal(out[1].timeFrom, "yes");
  assert.equal(out[1].title, "E9");
});

test("applyYesTimes: the broadcast with the episode's number wins over a rerun", () => {
  const out = applyYesTimes([dateOnly(2, 5, TOMORROW)], {
    [TOMORROW]: [
      item("פאודה - פרק 4", "2026-11-02T15:00:00+02:00"),
      item("פאודה - פרק 5", "2026-11-02T21:00:00+02:00"),
    ],
  }, ["Fauda", "פאודה"]);
  assert.equal(out[0].date, "2026-11-02T19:00:00.000Z");
});

test("applyYesTimes: reruns never count; the same episode twice takes the earliest", () => {
  const out = applyYesTimes([dateOnly(1, 9, TOMORROW)], {
    [TOMORROW]: [
      item("The Voice All Stars - פרק 9", "2026-11-02T23:40:00+02:00"),
      item("The Voice All Stars - פרק 9", "2026-11-02T21:15:00+02:00"),
      item("The Voice All Stars - פרק 9 (ש.ח)", "2026-11-02T14:00:00+02:00"),
    ],
  }, ["The Voice Israel"]);
  assert.equal(out[0].date, "2026-11-02T19:15:00.000Z");
  const onlyRerun = applyYesTimes([dateOnly(1, 3, TOMORROW)], {
    [TOMORROW]: [item("פאודה", "2026-11-02T21:00:00+02:00", "שידור חוזר")],
  }, ["Fauda", "פאודה"]);
  assert.equal(onlyRerun[0].hasTime, false);
});

test("applyYesTimes: without a number, a single daytime broadcast is no answer", () => {
  const out = applyYesTimes([dateOnly(1, 3, TOMORROW)], {
    [TOMORROW]: [item("פאודה", "2026-11-02T13:00:00+02:00")],
  }, ["Fauda", "פאודה"]);
  assert.equal(out[0].hasTime, false);
});

test("applyYesTimes: without a number, only a single broadcast that day is taken", () => {
  const one = applyYesTimes([dateOnly(1, 3, TOMORROW)], {
    [TOMORROW]: [item("פאודה", "2026-11-02T21:00:00+02:00")],
  }, ["Fauda", "פאודה"]);
  assert.equal(one[0].hasTime, true);
  const two = applyYesTimes([dateOnly(1, 3, TOMORROW)], {
    [TOMORROW]: [item("פאודה", "2026-11-02T15:00:00+02:00"), item("פאודה", "2026-11-02T21:00:00+02:00")],
  }, ["Fauda", "פאודה"]);
  assert.equal(two[0].hasTime, false);
  const otherNumber = applyYesTimes([dateOnly(1, 3, TOMORROW)], {
    [TOMORROW]: [item("פאודה - פרק 7", "2026-11-02T21:00:00+02:00")],
  }, ["Fauda", "פאודה"]);
  assert.equal(otherNumber[0].hasTime, false);
});

test("applyYesTimes: a name inside another word, or another day, is no match", () => {
  const eps = [dateOnly(1, 1, TOMORROW)];
  const out = applyYesTimes(eps, {
    [TOMORROW]: [
      item("Thevoiceover", "2026-11-02T21:00:00+02:00"),
      item("The Voice - פרק 1", "2026-11-03T00:30:00+02:00"),
    ],
  }, ["The Voice Israel"]);
  assert.equal(out, eps);
});

test("israelDate: the day in Israel, not in UTC", () => {
  assert.equal(israelDate(Date.parse("2026-11-01T23:30:00Z")), "2026-11-02");
});

function fakeFetch(byUrl, calls) {
  return async url => {
    calls.push(url);
    const body = byUrl(url);
    return body == null ? { ok: false, status: 500 } : { ok: true, json: async () => body };
  };
}

test("enrich: reads the three channels for the episode's day, once, for an Israeli show", async () => {
  const calls = [];
  const enrich = createYesAirTimes({
    fetch: fakeFetch(url => url.includes("CH34") && url.includes("date=2026-11-2")
      ? { items: [{ title: "The Voice All Stars - פרק 9", starts: "2026-11-02T21:15:00+02:00" }] }
      : { items: [] }, calls),
    cache: memoryCache(),
    showInfo: async () => ({ israeli: true, names: ["The Voice Israel"] }),
    now: () => NOW,
  });
  const out = await enrich({ tmdb: 1 }, [dateOnly(1, 9, TOMORROW)]);
  assert.equal(out[0].date, "2026-11-02T19:15:00.000Z");
  assert.equal(calls.length, 3);
  await enrich({ tmdb: 1 }, [dateOnly(1, 9, TOMORROW)]);
  assert.equal(calls.length, 3, "the day's schedules come from the cache");
});

test("enrich: a show not from Israel, or no episode near, asks nothing", async () => {
  const calls = [];
  const opts = { fetch: fakeFetch(() => ({ items: [] }), calls), cache: memoryCache(), now: () => NOW };
  const foreign = createYesAirTimes({ ...opts, showInfo: async () => ({ israeli: false, names: ["Slow Horses"] }) });
  const eps = [dateOnly(1, 1, TOMORROW)];
  assert.equal(await foreign({ tmdb: 2 }, eps), eps);
  const israeli = createYesAirTimes({ ...opts, showInfo: async () => ({ israeli: true, names: ["Fauda"] }) });
  const far = [dateOnly(1, 1, "2026-11-20")];
  assert.equal(await israeli({ tmdb: 3 }, far), far);
  assert.equal(calls.length, 0);
});

test("enrich: yes failing leaves the list as it was", async () => {
  const enrich = createYesAirTimes({
    fetch: async () => { throw new Error("offline"); },
    cache: memoryCache(),
    showInfo: async () => ({ israeli: true, names: ["Fauda"] }),
    now: () => NOW,
  });
  const eps = [dateOnly(1, 1, TOMORROW)];
  assert.deepEqual(await enrich({ tmdb: 3 }, eps), eps);
});

test("applyYesTimes: yes's time wins over a time the episode already had", () => {
  const timed = { season: 1, episode: 5, date: "2026-11-02T19:30:00.000Z", hasTime: true, timeFrom: "simkl", title: "E5" };
  const out = applyYesTimes([timed], {
    [TOMORROW]: [item("זהו זה - פרק 5", "2026-11-02T20:50:00+02:00")],
  }, ["Zehu Ze", "זהו זה"]);
  assert.equal(out[0].date, "2026-11-02T18:50:00.000Z");
  assert.equal(out[0].timeFrom, "yes");
});

test("applyYesTimes: a timed episode with no broadcast in yes keeps its time", () => {
  const timed = { season: 1, episode: 5, date: "2026-11-02T19:30:00.000Z", hasTime: true, timeFrom: "tvmaze", title: "E5" };
  const eps = [timed];
  const out = applyYesTimes(eps, { [TOMORROW]: [item("חדשות 12", "2026-11-02T20:00:00+02:00")] }, ["Zehu Ze", "זהו זה"]);
  assert.equal(out, eps);
});

test("enrich: a timed episode near today is looked up too", async () => {
  const asked = [];
  const enrich = createYesAirTimes({
    fetch: async url => { asked.push(url); return { ok: true, json: async () => ({ items: url.includes("CH34") ? [{ title: "זהו זה - פרק 5", starts: "2026-11-02T20:50:00+02:00" }] : [] }) }; },
    cache: memoryCache(),
    showInfo: async () => ({ israeli: true, names: ["Zehu Ze", "זהו זה"] }),
    now: () => NOW,
  });
  const out = await enrich({ tmdb: 1 }, [{ season: 1, episode: 5, date: "2026-11-02T19:30:00.000Z", hasTime: true, timeFrom: "simkl" }]);
  assert.equal(asked.length, 3);
  assert.equal(out[0].date, "2026-11-02T18:50:00.000Z");
  assert.equal(out[0].timeFrom, "yes");
});
