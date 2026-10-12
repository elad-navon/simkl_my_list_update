// Import: copies the SIMKL library into the app's own library (Firestore),
// as the documents the migration engine built - exactly what the preview
// checked. SIMKL itself is only read. In order:
// 1. the raw SIMKL lists are downloaded as a backup before anything else;
// 2. the import is refused while any show failed its analysis, has no id
//    at all, or would land on the same document as another show (nothing
//    is merged or dropped by guesswork), or while SIMKL's daily limit cut
//    the date checks short;
// 3. a library that already has shows is downloaded as a backup first, and
//    replacing it needs an explicit OK that lists what would change;
// 4. after writing, everything is read back and compared document by
//    document - success is reported only if all of it matches.
"use strict";
(function () {
  const { STATUS_LABEL } = MigrationEngine;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const backend = FirebaseBackend.create();
  let analysis = null; // { rawLists, records, report, docs, blockers }
  let importing = false;

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  // JSON with every object's keys sorted: the database hands documents back
  // with their keys in any order.
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
  }

  // What will be written, and what stops the import.
  function plan(records, report) {
    const docs = {}, blockers = [], byDoc = new Map();
    if (report.summary.simklEpisodesStopped) {
      blockers.push("המכסה היומית של סימקל נגמרה באמצע, אז חלק מהסדרות לא אומתו לפי תאריך. אפשר להריץ שוב אחרי שהיא מתאפסת.");
    }
    for (const r of records) {
      const failed = r.issues.find(i => i.startsWith("הבדיקה נכשלה"));
      if (failed) { blockers.push(`${r.title}: ${failed}`); continue; }
      if (!r.libraryDoc) { blockers.push(`${r.title}: אין לסדרה שום מזהה, ולכן אין איפה לשמור אותה`); continue; }
      if (byDoc.has(r.docId)) {
        const other = byDoc.get(r.docId);
        blockers.push(`"${r.title}" (${STATUS_LABEL[r.status]}) ו־"${other.title}" (${STATUS_LABEL[other.status]}) הן אותה סדרה בטי־אם־די־בי, ${r.docId}`);
        continue;
      }
      byDoc.set(r.docId, r);
      docs[r.docId] = r.libraryDoc;
    }
    return { docs, blockers };
  }

  function rate(s) {
    return s.compared ? `${s.match} מתוך ${s.compared}` : "—";
  }

  function renderAnalysis() {
    const { report, records, docs, blockers } = analysis;
    const s = report.summary;
    const count = Object.keys(docs).length;
    const byStatus = LibraryCore.STATUSES.map(st => `${STATUS_LABEL[st]}: ${Object.values(docs).filter(d => d.status === st).length}`).join(" · ");
    const attention = records.filter(r => r.issues.length || r.uncertain);
    const html = [];
    html.push(`<p>נקראו ${esc(records.length)} סדרות. ייובאו ${esc(count)}: ${esc(byStatus)}.</p>`);
    html.push(`<p>השוואה למה שהאתר מציג היום: פרקים שנצפו ${esc(rate(s.checks.watched))}, פרקים ששודרו ${esc(rate(s.checks.available))},
      פרקים שנשארו ${esc(rate(s.checks.remaining))}, הפרק הבא ${esc(rate(s.checks.next))}, הפרק הבא לשידור ${esc(rate(s.checks.airing))}.</p>`);
    html.push(`<p>פרקים שנצפו ולא הותאמו (יישמרו בצד, לא יימחקו): ${esc(s.mapping.unmapped + s.mapping.duplicates)}. ספיישלים שנשמרים: ${esc(s.mapping.specials)}.</p>`);
    if (attention.length) {
      html.push(`<details><summary class="warn">${esc(attention.length)} סדרות עם הערות (ייובאו, ומופיעות בדוח)</summary><ul>
        ${attention.map(r => `<li>${esc(r.title)} (${esc(STATUS_LABEL[r.status])}): ${esc([r.uncertain ? `לבדיקה: ${r.uncertain}` : null, ...r.issues].filter(Boolean).join(" · "))}</li>`).join("")}
      </ul></details>`);
    }
    if (blockers.length) {
      html.push(`<p class="bad">אי אפשר לייבא עדיין:</p><ul class="bad">${blockers.map(b => `<li>${esc(b)}</li>`).join("")}</ul>`);
    } else {
      html.push(`<p class="ok">הבדיקה עברה. אפשר לייבא.</p>`);
    }
    $("analyzeResult").innerHTML = html.join("\n");
  }

  function updateSteps() {
    const user = backend.currentUser();
    const analyzed = !!analysis && !analysis.blockers.length;
    $("step2").classList.toggle("off", !analysis);
    $("step3").classList.toggle("off", !(analyzed && user));
    $("importBtn").disabled = !(analyzed && user) || importing;
  }

  function showUser() {
    const user = backend.currentUser();
    $("who").textContent = user ? `מחובר כ־${user.email}` : "לא מחובר";
    $("signInBtn").hidden = !!user;
    updateSteps();
  }

  async function runImport() {
    const { docs, records, report } = analysis;
    const ids = Object.keys(docs);
    const progress = text => { $("importProgress").textContent = text; };
    $("importResult").innerHTML = "";

    progress("קורא את הספרייה הקיימת…");
    const { docs: existing } = await backend.loadAll();
    const existingIds = Object.keys(existing);
    if (existingIds.length) {
      download(`tv-library-before-import-${stamp()}.json`, {
        kind: LibraryStore.BACKUP_KIND, schemaVersion: LibraryCore.SCHEMA_VERSION, exportedAt: new Date().toISOString(), shows: existing,
      });
      const added = ids.filter(id => !(id in existing));
      const changed = ids.filter(id => id in existing && canonical(existing[id]) !== canonical(docs[id]));
      const removed = existingIds.filter(id => !(id in docs));
      const names = list => list.slice(0, 10).map(id => (existing[id] || docs[id]).title).join(", ") + (list.length > 10 ? "…" : "");
      const ok = confirm(`בספרייה כבר יש ${existingIds.length} סדרות, וגיבוי שלהן ירד עכשיו.\n\n` +
        `הייבוא יחליף את הספרייה כולה:\n` +
        `• ${added.length} סדרות חדשות\n` +
        `• ${changed.length} סדרות יוחלפו בגרסה מסימקל${changed.length ? `: ${names(changed)}` : ""}\n` +
        `• ${removed.length} סדרות שאינן בסימקל יימחקו${removed.length ? `: ${names(removed)}` : ""}\n\nלהמשיך?`);
      if (!ok) { progress("הייבוא בוטל. לא נכתב דבר."); return; }
    }

    progress("כותב לספרייה…");
    await backend.replaceAll(docs, (done, total) => progress(`כותב לספרייה: ${done} מתוך ${total}`));

    progress("קורא בחזרה את מה שנכתב ומשווה…");
    const { docs: after } = await backend.loadAll();
    const missing = ids.filter(id => !(id in after));
    const differ = ids.filter(id => id in after && canonical(after[id]) !== canonical(docs[id]));
    const extra = Object.keys(after).filter(id => !(id in docs));
    const verified = !missing.length && !differ.length && !extra.length;
    const title = id => (docs[id] || after[id]).title;

    download(`import-report-${stamp()}.json`, {
      importedAt: new Date().toISOString(),
      verified,
      written: ids.length,
      readBack: Object.keys(after).length,
      replacedExistingShows: existingIds.length,
      problems: {
        missing: missing.map(id => ({ id, title: title(id) })),
        differ: differ.map(id => ({ id, title: title(id) })),
        extra: extra.map(id => ({ id, title: title(id) })),
      },
      // Every place the new library differs from what SIMKL shows today.
      differences: records.flatMap(r => [
        ...(r.checks || []).filter(c => !c.ok).map(c => ({ title: r.title, status: r.status, field: c.field, simkl: c.simkl, library: c.derived })),
        ...(r.airing && !r.airing.ok ? [{ title: r.title, status: r.status, field: "airing", simkl: r.airing.simkl, library: r.airing.derived }] : []),
      ]),
      exceptions: records.filter(r => r.issues.length || r.uncertain)
        .map(r => ({ title: r.title, status: r.status, docId: r.docId, uncertain: r.uncertain, issues: r.issues })),
      summary: report.summary,
    });

    if (verified) {
      // SIMKL auto-marking (simkl-bridge.js) picks up from the import, not
      // from wherever it had read to before it.
      const importedAt = Object.values(docs).map(d => d.importedAt).filter(Boolean).sort()[0];
      if (importedAt) await backend.setMeta("simklBridge", { since: importedAt, checkedAt: new Date().toISOString() });
      progress("");
      $("importResult").innerHTML = `<p class="ok">הייבוא הושלם ואומת: ${esc(ids.length)} סדרות נכתבו, נקראו בחזרה, וכולן זהות למה שנבדק. הדוח ירד.</p>
        <p><a href="../index.html?source=library">פתיחת האתר מהספרייה החדשה</a> (רק בדפדפן הזה; בכל מקום אחר האתר ממשיך לעבוד מסימקל עד המעבר)</p>`;
    } else {
      progress("");
      const list = (label, arr) => (arr.length ? `<li>${esc(label)}: ${esc(arr.slice(0, 20).map(title).join(", "))}${arr.length > 20 ? "…" : ""}</li>` : "");
      $("importResult").innerHTML = `<p class="bad">הכתיבה הסתיימה, אבל הבדיקה שאחריה מצאה פערים. אל תעבור לספרייה החדשה עד שנבין אותם. הדוח ירד.</p>
        <ul class="bad">${list("חסרות", missing)}${list("שונות ממה שנבדק", differ)}${list("מיותרות", extra)}</ul>`;
    }
  }

  $("analyzeBtn").addEventListener("click", async () => {
    $("analyzeBtn").disabled = true;
    $("analyzeResult").innerHTML = "";
    analysis = null;
    updateSteps();
    try {
      const result = await MigrationEngine.analyzeAll({
        onProgress: text => { $("analyzeProgress").textContent = text; },
        onListsRead: lists => download(`simkl-backup-before-import-${stamp()}.json`, {
          exportedAt: new Date().toISOString(),
          source: "SIMKL /sync/all-items/shows/{status}?extended=full&episode_watched_at=yes&include_all_episodes=original&episode_tvdb_id=yes&memos=yes",
          lists,
        }),
      });
      analysis = { ...result, ...plan(result.records, result.report) };
      $("analyzeProgress").textContent = "";
      renderAnalysis();
    } catch (e) {
      $("analyzeProgress").textContent = "";
      $("analyzeResult").innerHTML = `<p class="bad">${esc(e.message)}</p>`;
    }
    $("analyzeBtn").disabled = false;
    updateSteps();
  });

  $("signInBtn").addEventListener("click", async () => {
    try { await backend.signIn(); } catch (e) { $("who").textContent = `ההתחברות נכשלה: ${e.message}`; return; }
    showUser();
  });

  $("importBtn").addEventListener("click", async () => {
    importing = true;
    updateSteps();
    $("analyzeBtn").disabled = true;
    try {
      await runImport();
    } catch (e) {
      $("importProgress").textContent = "";
      $("importResult").innerHTML = `<p class="bad">הייבוא נעצר: ${esc(e.message)}</p>
        <p class="muted">אפשר להריץ שוב. הרצה חוזרת משלימה את מה שלא נכתב.</p>`;
    }
    importing = false;
    $("analyzeBtn").disabled = false;
    updateSteps();
  });

  (async () => {
    try { await backend.ready(); } catch (e) { $("who").textContent = `טעינת שירות ההתחברות נכשלה: ${e.message}`; return; }
    showUser();
  })();
})();
