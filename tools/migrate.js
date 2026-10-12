// Read-only migration preview: runs the migration engine
// (migrate-engine.js) and shows its report - every show mapped to TMDB /
// TVMaze, the new library rules checked against what the site shows today,
// and every gap. It changes nothing anywhere: nothing is written to
// localStorage or to a library. The two downloads are the only output.
"use strict";
(function () {
  const { STATUS_LABEL, SOURCE_LABEL } = MigrationEngine;
  const STATUSES = LibraryCore.STATUSES;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let rawLists = null;
  let report = null;

  // ---- Render ---------------------------------------------------------------------
  function stat(n, label, cls) {
    return `<div class="stat"><div class="n ${cls || ""}">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
  }
  function rate(s) {
    if (!s.compared) return "—";
    return `${s.match}/${s.compared} (${Math.round((s.match / s.compared) * 100)}%)`;
  }
  const cls = (n, bad) => (n ? (bad ? "bad" : "warn") : "ok");
  const FIELD_LABEL = { watched: "פרקים שנצפו", available: "פרקים ששודרו", remaining: "פרקים שנשארו", next: "הפרק הבא לצפייה" };

  function render(rep) {
    const s = rep.summary;
    const shows = rep.shows;
    const html = [];
    if (s.simklEpisodesStopped) html.push(`<p class="bad">${esc(s.simklEpisodesStopped)} חלק מהסדרות לא אומתו לפי תאריך.</p>`);
    const fallbackLists = Object.entries(s.listModes).filter(([, m]) => m !== "full").map(([st]) => STATUS_LABEL[st]);
    if (fallbackLists.length) html.push(`<p class="warn">רשימות שנקראו בדרך החלופית, כי היו גדולות מדי: ${esc(fallbackLists.join(", "))}</p>`);

    html.push(`<h2>סיכום</h2><div class="grid">
      ${stat(s.shows, "סדרות בסך הכל")}
      ${STATUSES.map(st => stat(s.byStatus[st], STATUS_LABEL[st])).join("")}
    </div>`);

    html.push(`<h2>היסטוריית צפייה</h2><div class="grid">
      ${stat(s.watched.simklCount, "פרקים שנצפו, לפי המונה של סימקל")}
      ${stat(s.watched.recorded, "פרקים שנצפו, מפורטים אחד אחד")}
      ${stat(s.watched.withDate, "פרקים עם תאריך צפייה")}
      ${stat(s.watched.bulkMarkedShows, `סדרות שסומנו כנצפו בבת אחת (${s.watched.bulkMarkedEpisodes} פרקים בלי פירוט)`, s.watched.bulkMarkedShows ? "warn" : "ok")}
      ${stat(s.watched.inferredCompletedShows, `מתוכן הושלמו במלואן: ${s.watched.inferredEpisodes} פרקים יסומנו כנצפו, בלי תאריך`)}
      ${stat(s.watched.countHintShows, "סדרות שבהן יישמר רק המונה של סימקל", cls(s.watched.countHintShows))}
      ${stat(s.watched.partialShows, "סדרות שידוע עליהן רק הפרק האחרון", cls(s.watched.partialShows))}
    </div>`);

    html.push(`<h2>נתונים אישיים שיישמרו</h2><div class="grid">
      ${stat(s.personal.rated, "סדרות עם דירוג שלך")}
      ${stat(s.personal.withMemo, "סדרות עם הערה שלך")}
      ${stat(s.personal.withAddedDate, "סדרות עם תאריך הוספה")}
    </div>`);

    html.push(`<h2>זיהוי הסדרות</h2><div class="grid">
      ${stat(s.ids.fromSimkl, "המזהה הגיע מסימקל", "ok")}
      ${stat(s.ids.foundOther, "המזהה נמצא בדרך אחרת", cls(s.ids.foundOther))}
      ${stat(s.ids.unresolved, "בלי מזהה (יישמרו תחת מזהה חלופי)", cls(s.ids.unresolved))}
      ${stat(s.ids.uncertain, "התאמות לבדיקה (שנה שונה או מזהה עקיף)", cls(s.ids.uncertain))}
      ${stat(s.ids.translatedNames, "שם מתורגם בלבד (אותו מזהה כמו היום)")}
      ${stat(s.ids.duplicates, "כפילויות אפשריות", cls(s.ids.duplicates))}
    </div>`);

    html.push(`<h2>התאמת פרקים שנצפו</h2><div class="grid">
      ${stat(s.mapping.byNumber, "לפי מספר, והתאריך תואם", "ok")}
      ${stat(s.mapping.byDate, "לפי תאריך שידור", "ok")}
      ${stat(s.mapping.byTitle, "לפי שם הפרק", "ok")}
      ${stat(s.mapping.byDayOrder, "לפי הסדר באותו יום", "ok")}
      ${stat(s.mapping.bySeasonMatch, "לפי מספר, כשהעונה זהה בגודלה", "ok")}
      ${stat(s.mapping.byPosition, "לפי המיקום בסדרה, כשהחלוקה לעונות שונה", "ok")}
      ${stat(s.mapping.unmapped + s.mapping.duplicates, "לא הותאמו (יישמרו כמו שהם)", cls(s.mapping.unmapped + s.mapping.duplicates, true))}
      ${stat(s.mapping.specials, "ספיישלים (יישמרו, לא נספרים)")}
      ${stat(s.mapping.verifiedByDateShows, "סדרות שאומתו גם לפי תאריך")}
    </div>`);

    html.push(`<h2>מקור הפרקים שנבחר</h2><div class="grid">
      ${stat(s.sources.tvmaze, "טיוי־מייז")}
      ${stat(s.sources.withTimes, "מתוכן עם שעת שידור מדויקת", "ok")}
      ${stat(s.sources.tmdb, "טי־אם־די־בי (תאריך בלבד)")}
      ${stat(s.sources.pinnedToTmdb, "מתוכן נבחרו כי המספור שלהן מתאים יותר")}
      ${stat(s.sources.snapshot, "תמונת מצב מסימקל (המקורות החיצוניים חסרים פרקים)", cls(s.sources.snapshot))}
      ${stat(s.sources.none, "בלי רשימת פרקים", cls(s.sources.none, true))}
      ${stat(s.sources.recentDisagreements, "פרקים מהזמן האחרון עם תאריך שונה בשני המקורות", cls(s.sources.recentDisagreements))}
    </div>`);

    html.push(`<h2>השוואה למה שהאתר מציג היום</h2><div class="grid">
      ${["watched", "available", "remaining", "next"].map(f => stat(rate(s.checks[f]), FIELD_LABEL[f])).join("")}
      ${stat(rate(s.checks.airing), "הפרק הבא לשידור (קוביית הפרקים הקרובים)")}
    </div>
    <p class="lead">לידיעה בלבד, בלי השפעה על המסך: סך הפרקים שונה ב־${esc(s.info.totalDiffers)} סדרות, ומספר הפרקים שעוד לא שודרו שונה ב־${esc(s.info.notAiredDiffers)}. אלה בעיקר פרקים עתידיים שסימקל כבר מכיר.</p>`);

    const failed = shows.flatMap(r => (r.checks || []).filter(c => !c.ok).map(c => ({ r, label: FIELD_LABEL[c.field], a: c.simkl, b: c.derived })))
      .concat(shows.filter(r => r.airing && !r.airing.ok).map(r => ({ r, label: "הפרק הבא לשידור", a: r.airing.simkl, b: r.airing.derived })));
    if (failed.length) {
      html.push(`<div class="card"><table><thead><tr><th>סדרה</th><th>סטטוס</th><th>מה</th><th>היום</th><th>אחרי המעבר</th></tr></thead><tbody>
        ${failed.map(x => `<tr><td>${esc(x.r.title)}</td><td>${esc(STATUS_LABEL[x.r.status])}</td><td>${esc(x.label)}</td><td class="ltr">${esc(x.a)}</td><td class="ltr">${esc(x.b)}</td></tr>`).join("")}
      </tbody></table></div>`);
    }

    if (rep.duplicates.length) html.push(`<h2>כפילויות אפשריות</h2><div class="card"><ul class="issues">${rep.duplicates.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div>`);

    const attention = shows.filter(r => r.issues.length || r.uncertain);
    html.push(`<h2>סדרות שדורשות תשומת לב (${attention.length})</h2>`);
    if (attention.length) {
      html.push(`<div class="card"><table><thead><tr><th>סדרה</th><th>סטטוס</th><th>מה נמצא</th></tr></thead><tbody>
        ${attention.map(r => `<tr><td>${esc(r.title)}${r.year ? ` (${esc(r.year)})` : ""}</td><td>${esc(STATUS_LABEL[r.status])}</td><td><ul class="issues">
          ${r.uncertain ? `<li class="warn">לבדיקה: ${esc(r.uncertain)}</li>` : ""}
          ${r.issues.map(i => `<li>${esc(i)}</li>`).join("")}
        </ul></td></tr>`).join("")}
      </tbody></table></div>`);
    } else {
      html.push(`<p class="ok">לא נמצאו בעיות.</p>`);
    }

    html.push(`<h2>כל הסדרות</h2><details class="card"><summary>הצגת הטבלה המלאה (${shows.length})</summary><table><thead><tr>
      <th>סדרה</th><th>סטטוס</th><th>מקור</th><th>פרקים (עם שעה / תאריך בלבד)</th><th>נצפו (מפורט / מונה סימקל)</th></tr></thead><tbody>
      ${shows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(STATUS_LABEL[r.status])}</td><td>${esc(SOURCE_LABEL[r.source] || r.source)}${r.pinnedToTmdb ? " ★" : ""}</td><td class="ltr">${esc(r.episodes)} (${esc(r.timed)} / ${esc(r.dateOnly)})</td><td class="ltr">${esc(r.watchedRecorded)} / ${esc(r.simklWatchedCount ?? "—")}</td></tr>`).join("")}
    </tbody></table></details>`);

    $("report").innerHTML = html.join("\n");
  }

  // ---- Downloads ------------------------------------------------------------------
  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  async function run() {
    $("error").textContent = "";
    $("report").innerHTML = "";
    const result = await MigrationEngine.analyzeAll({
      onProgress: text => { $("progress").textContent = text; },
      onListsRead: lists => { rawLists = lists; $("backupBtn").disabled = false; },
    });
    report = result.report;
    render(report);
    $("reportBtn").disabled = false;
    $("progress").textContent = `הבדיקה הסתיימה: ${report.shows.length} סדרות.`;
  }

  $("runBtn").addEventListener("click", async () => {
    $("runBtn").disabled = true;
    try { await run(); } catch (e) { $("error").textContent = e.message; $("progress").textContent = ""; }
    $("runBtn").disabled = false;
  });
  $("backupBtn").addEventListener("click", () => {
    download(`simkl-backup-${stamp()}.json`, {
      exportedAt: new Date().toISOString(),
      source: "SIMKL /sync/all-items/shows/{status}?extended=full&episode_watched_at=yes&include_all_episodes=original&episode_tvdb_id=yes&memos=yes",
      lists: rawLists,
    });
  });
  $("reportBtn").addEventListener("click", () => download(`migration-report-${stamp()}.json`, report));
})();
