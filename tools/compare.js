// Side-by-side check of the site in both modes on the user's real data: the
// page is loaded once reading SIMKL and once reading the library (the mode is
// read once, as each page starts, from localStorage - so the two are loaded
// one after the other and the user's own choice is put back at the end).
// What each mode put on the panels is compared show by show; nothing is
// written by this tool.
"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const LS_DATA_SOURCE = "data_source";
  const MODE_LABEL = { simkl: "סימקל", library: "הספרייה" };

  async function loadMode(mode) {
    localStorage.setItem(LS_DATA_SOURCE, mode);
    const box = document.createElement("div");
    box.className = "frame-box";
    box.innerHTML = `<div class="label">${MODE_LABEL[mode]}</div>`;
    const frame = document.createElement("iframe");
    frame.src = "../index.html";
    box.prepend(frame);
    $("frames").appendChild(box);
    await new Promise(resolve => { frame.onload = resolve; });
    const w = frame.contentWindow;
    const started = Date.now();
    for (;;) {
      const doc = w.document;
      const sub = (doc.getElementById("subtitle") || {}).textContent || "";
      if (doc.querySelector(".series-panel-updated")) break;
      if (doc.getElementById("librarySignInBtn")) throw new Error("הספרייה מבקשת התחברות: התחבר בחלון הימני ואז הרץ שוב.");
      if (/^Error/.test(sub)) throw new Error(`האתר במצב ${MODE_LABEL[mode]} נכשל: ${(doc.querySelector(".error-box") || {}).textContent || ""}`);
      if (Date.now() - started > 6 * 60 * 1000) throw new Error(`האתר במצב ${MODE_LABEL[mode]} לא סיים להיטען תוך 6 דקות.`);
      $("progress").textContent = `טוען את האתר במצב ${MODE_LABEL[mode]}… ${sub}`;
      await sleep(500);
    }
    return w;
  }

  function collect(w) {
    const g = name => w.eval(name) || [];
    return {
      myList: g("lastRows"), recently: g("lastRecentlyWatched"), plan: g("lastPlanToWatch"), airing: g("airingRows"),
      totals: { eps: w.eval("lastTotalEps"), minutes: Math.round(w.eval("lastTotalMinutes")) },
    };
  }

  // Two air dates are the same if they're the same moment; a date-only one
  // matches any time on that calendar day.
  function sameAirDate(a, b) {
    if (!a || !b) return !a && !b;
    if (a.length > 10 && b.length > 10) return Date.parse(a) === Date.parse(b);
    const day = s => (s.length > 10 ? new Date(s).toLocaleDateString("en-CA") : s);
    return day(a) === day(b);
  }
  const fmtDate = s => (!s ? "—" : s.length > 10 ? new Date(s).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : `${s} (תאריך בלבד)`);

  function compare(a, b) {
    const diffs = [];
    const add = (panel, title, field, x, y) => diffs.push({ panel, title, field, simkl: x, library: y });
    const byTitle = list => new Map(list.map(r => [r.title, r]));

    const panel = (name, listA, listB, fields) => {
      const ma = byTitle(listA), mb = byTitle(listB);
      for (const t of new Set([...ma.keys(), ...mb.keys()])) {
        const x = ma.get(t), y = mb.get(t);
        if (!x || !y) { add(name, t, "מופיעה", x ? "כן" : "לא", y ? "כן" : "לא"); continue; }
        for (const [label, get, same] of fields) {
          const vx = get(x), vy = get(y);
          if (!(same ? same(vx, vy) : vx === vy)) add(name, t, label, vx, vy);
        }
      }
      const order = l => l.map(r => r.title).filter(t => ma.has(t) && mb.has(t)).join("|");
      return { count: [listA.length, listB.length], sameOrder: order(listA) === order(listB) };
    };

    const stats = {};
    stats.myList = panel("הרשימה שלי", a.myList, b.myList, [
      ["הפרק הבא", r => r.nextLabel],
      ["שם הפרק", r => r.episodeTitle || "—"],
      ["פרקים שנשארו", r => r.remaining],
      ["פרקים ששודרו", r => r.available],
      ["פרקים שנצפו", r => r.watched],
      ["תג", r => r.badge || "—"],
      ["שידור הפרק הבא", r => r.nextAirDate, sameAirDate],
      ["זמן צפייה שנשאר (דקות)", r => r.hours * 60 + r.mins],
    ]);
    stats.airing = panel("הפרקים הקרובים", a.airing, b.airing, [
      ["הפרק", r => r.nextLabel],
      ["מועד השידור", r => r.airDate, sameAirDate],
      ["תג", r => r.badge || "—"],
      ["שם הפרק", r => r.nextEpisodeTitle || "—"],
    ]);
    stats.plan = panel("תוכניות לצפייה", a.plan, b.plan, [
      ["מצב השידור", r => r.airedLabel || "—"],
    ]);
    stats.recently = { count: [a.recently.length, b.recently.length] };
    const rec = l => l.map(r => `${r.title} S${String(r.season).padStart(2, "0")}E${String(r.episode).padStart(2, "0")}${r.badge ? ` (${r.badge})` : ""}`);
    const ra = rec(a.recently), rb = rec(b.recently);
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
      if (ra[i] !== rb[i]) add("נצפו לאחרונה", `מקום ${i + 1}`, "פרק", ra[i] || "—", rb[i] || "—");
    }
    if (a.totals.eps !== b.totals.eps) add("סיכום", "", "פרקים שנשארו בסך הכל", a.totals.eps, b.totals.eps);
    if (a.totals.minutes !== b.totals.minutes) add("סיכום", "", "זמן צפייה שנשאר (דקות)", a.totals.minutes, b.totals.minutes);
    // IMDb scores come from a different place (MDBList instead of SIMKL's copy).
    const imdb = list => new Map(list.map(r => [r.title, r.imdbRating]));
    let imdbDiffers = 0;
    for (const [list, other] of [[a.myList, b.myList], [a.plan, b.plan], [a.airing, b.airing]]) {
      const mb = imdb(other);
      for (const r of list) if (mb.has(r.title) && mb.get(r.title) !== r.imdbRating) imdbDiffers++;
    }
    return { diffs, stats, imdbDiffers };
  }

  function render({ diffs, stats, imdbDiffers }) {
    const line = (name, s) => `<li>${esc(name)}: ${esc(s.count[0])} בסימקל, ${esc(s.count[1])} בספרייה${s.sameOrder === false ? " <span class=\"warn\">(הסדר שונה)</span>" : ""}</li>`;
    const show = v => (typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v) ? fmtDate(v) : v);
    $("result").innerHTML = `
      <div class="card">
        <h2>סיכום</h2>
        <ul>
          ${line("הרשימה שלי", stats.myList)}${line("הפרקים הקרובים", stats.airing)}${line("תוכניות לצפייה", stats.plan)}${line("נצפו לאחרונה", stats.recently)}
        </ul>
        <p class="${diffs.length ? "warn" : "ok"}">${diffs.length ? `נמצאו ${diffs.length} הבדלים, מפורטים למטה.` : "אין אף הבדל בקוביות."}</p>
        <p class="muted">ציון IMDb שונה ב־${esc(imdbDiffers)} מקומות: בספרייה הוא מגיע מ־MDBList ולא מהעותק של סימקל, וזה צפוי. הסדר בקוביית "תוכניות לצפייה" נקבע לפי הציון הזה.</p>
      </div>
      ${diffs.length ? `<div class="card"><table><thead><tr><th>קובייה</th><th>סדרה</th><th>מה</th><th>סימקל</th><th>הספרייה</th></tr></thead><tbody>
        ${diffs.map(d => `<tr><td>${esc(d.panel)}</td><td class="ltr">${esc(d.title)}</td><td>${esc(d.field)}</td><td class="ltr">${esc(show(d.simkl))}</td><td class="ltr">${esc(show(d.library))}</td></tr>`).join("")}
      </tbody></table></div>` : ""}`;
  }

  $("runBtn").addEventListener("click", async () => {
    $("runBtn").disabled = true;
    $("result").innerHTML = "";
    $("frames").innerHTML = "";
    const original = localStorage.getItem(LS_DATA_SOURCE);
    try {
      const simkl = collect(await loadMode("simkl"));
      const library = collect(await loadMode("library"));
      $("progress").textContent = "";
      const result = compare(simkl, library);
      render(result);
      window.__compareResult = result;
    } catch (e) {
      $("progress").textContent = "";
      $("result").innerHTML = `<p class="bad">${esc(e.message)}</p>`;
    } finally {
      if (original == null) localStorage.removeItem(LS_DATA_SOURCE); else localStorage.setItem(LS_DATA_SOURCE, original);
      $("runBtn").disabled = false;
    }
  });
})();
