/**
 * Raw SIMKL export - run this BEFORE the migration, and keep the file.
 *
 * Your watch history is the only thing in this project that cannot be
 * rebuilt from somewhere else. Artwork, ratings and air dates can always be
 * re-fetched; which episodes you have seen exists only in your SIMKL account
 * until this file exists.
 *
 * HOW TO RUN
 *   1. Open the live app (the one whose localStorage holds your SIMKL token):
 *      https://elad-navon.github.io/simkl_my_list_update/
 *   2. Open DevTools -> Console (F12).
 *   3. Paste this entire file, press Enter, wait for the download.
 *
 * It only reads. No POST, no mutation, nothing written back to SIMKL.
 *
 * Output: simkl-export-YYYY-MM-DD.json
 *   { exportedAt, lists: { watching, plantowatch, hold, completed, dropped },
 *     episodes: { [simklId]: Episode[] }, errors: [...] }
 */
(async () => {
  const BASE = "https://api.simkl.com";
  const clientId = localStorage.getItem("simkl_client_id");
  const token = localStorage.getItem("simkl_access_token");

  if (!clientId || !token) {
    console.error(
      "%cNo SIMKL credentials in this origin's localStorage.",
      "color:#f55;font-weight:bold",
      "\nRun this on the page you normally use the app from, while logged in.",
    );
    return;
  }

  const STATUSES = ["watching", "plantowatch", "hold", "completed", "dropped"];
  const errors = [];

  const get = async (path, extra = {}) => {
    const params = new URLSearchParams({
      client_id: clientId,
      "app-name": "my-list-summary-web",
      "app-version": "1.0",
      ...extra,
    });
    const res = await fetch(`${BASE}${path}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  const asArray = (data) => (Array.isArray(data) ? data : data?.shows || []);

  // --- 1. the five lists: this is the irreplaceable part -------------------
  console.log("%cFetching your lists...", "color:#38bdf8;font-weight:bold");
  const lists = {};
  for (const status of STATUSES) {
    try {
      lists[status] = asArray(
        await get(`/sync/all-items/shows/${status}`, {
          extended: "full",
          episode_watched_at: "yes",
        }),
      );
      // SIMKL returns per-episode `seasons` data for `watching` and `hold`
      // only - never for `completed` or `dropped`, whatever
      // episode_watched_at is set to. Those shows' history has to be rebuilt
      // from `watched_episodes_count` (see library/migrate/simkl.ts), so the
      // coverage is printed rather than left to be discovered later.
      const withEpisodes = lists[status].filter((i) => i?.seasons?.length).length;
      console.log(
        `  ${status}: ${lists[status].length} shows, ${withEpisodes} with per-episode watch data`,
      );
    } catch (e) {
      lists[status] = [];
      errors.push({ what: `list:${status}`, message: String(e) });
      console.warn(`  ${status}: FAILED - ${e}`);
    }
  }

  // --- 2. per-show episode data, for the parity harness --------------------
  // Not strictly part of the backup (TVmaze/TMDB can supply it again), but
  // having SIMKL's own numbers on disk is what lets the migration be checked
  // show by show without hitting SIMKL again.
  const ids = [
    ...new Set(
      Object.values(lists)
        .flat()
        .map((item) => item?.show?.ids?.simkl)
        .filter(Boolean),
    ),
  ];

  console.log(`%cFetching episode data for ${ids.length} shows...`, "color:#38bdf8;font-weight:bold");
  const episodes = {};
  const CONCURRENCY = 4;
  let done = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const id = ids.shift();
        if (id === undefined) return;
        try {
          episodes[id] = await get(`/tv/episodes/${id}`, { extended: "full" });
        } catch (e) {
          errors.push({ what: `episodes:${id}`, message: String(e) });
        }
        if (++done % 10 === 0) console.log(`  ${done} done`);
        await new Promise((r) => setTimeout(r, 120)); // stay polite
      }
    }),
  );

  // --- 3. download ---------------------------------------------------------
  const payload = {
    exportedAt: new Date().toISOString(),
    source: "simkl",
    counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])),
    lists,
    episodes,
    errors,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `simkl-export-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  const totalShows = Object.values(lists).flat().length;
  console.log(
    `%cDone: ${totalShows} shows, ${Object.keys(episodes).length} episode lists, ${errors.length} errors.`,
    "color:#4ade80;font-weight:bold",
  );
  if (errors.length) console.table(errors);
  const perEpisode = Object.values(lists).flat().filter((i) => i?.seasons?.length).length;
  console.log(
    `${perEpisode} of ${totalShows} shows carry per-episode watch data; the rest are rebuilt from SIMKL's watched count.`,
  );
  console.log("Keep simkl-export-" + stamp + ".json somewhere safe before migrating.");
})();
