# TV Series — SIMKL My List Summary

A single self-contained HTML page for your SIMKL "My List": **for the
shows you're watching, how many episodes are left and how much time
will it take to catch up** — plus a built-in search so you can add
shows, change their status, or remove them from your list without
leaving the page or opening simkl.com.

Everything runs as JavaScript **in your browser** — no server, no
backend, nothing to keep running in the background. Episode/watch
status and list management go through [SIMKL](https://simkl.com)'s
API; poster/backdrop artwork and episode runtimes come from
[TMDB](https://www.themoviedb.org).

## Setup

1. Open `index.html` in your browser (double-click it, or host it
   anywhere — see [Publishing it](#publishing-it-eg-for-a-shortcut)
   below).
2. First run shows a **Setup** screen — paste in:
   - **SIMKL Client ID** — create a free app at
     [simkl.com/settings/developer](https://simkl.com/settings/developer/)
     (any redirect_uri value works, this uses the PIN flow).
   - **TMDB API Key** — get a free key at
     [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).

   These are saved only in your browser's `localStorage` — **never**
   written into the HTML file itself, so it's safe to keep this file
   in a public git repo.
3. You'll then see a one-time SIMKL PIN code — approve it at the link
   shown. The access token is also cached in `localStorage`.
4. From then on, every time you open the page (or hit **Refresh**), it
   fetches live data and renders the current state.

## Features

- **Single-page dashboard** with a dark sidebar (Refresh, My List,
  Poster/Banner toggle, Search Show, Settings) — everything lives on
  one screen now, including what used to be a separate Airing Next
  tab.
- **My List carousel** at the top: one card per show with poster or
  banner, progress bar, total / available / watched / remaining
  episode counts, time left (shown as *next episode time / total
  remaining time* when more than one episode is left, e.g.
  `0h 45m / 3h 23m left`), and the next episode to watch (e.g.
  `S03E01`) with its title when known. Left/right arrows scroll the
  carousel.
- Three panels below the carousel, each with its own vertical
  scrolling list of up to 5 shows: **Recently Watched** (last 10
  watched episodes), **Airing Next** (upcoming episodes for shows
  you're watching, plus true future premieres from Plan to Watch —
  soonest first, using SIMKL's exact date+time so day labels like
  "Today"/"Tomorrow" match simkl.com), and **Plan to Watch** (every
  show in that status). Season/series premiere and season finale
  badges are shown where relevant.
- Every card's **⋮** menu lets you mark the next episode watched
  (synced straight to SIMKL), change status (Watching / Hold /
  Completed / Dropped), or remove the show from your list — with a
  toast on success or failure.
- **Poster ↔ Banner** toggle (sidebar) — the icon shown reflects what
  you'll switch to. Per-card **⟳** cycles to another available image
  of the current type, if TMDB has more than one.
- **IMDb pill** on each card/row — opens the show's IMDb page, with
  its SIMKL rating shown alongside when available.
- Remaining-episode count badge (bottom-right of each poster) is
  colored to match the IMDb rating style.
- Only **English or no-language** artwork is used (no foreign-text
  posters), except shows that have **no English/no-language image at
  all** (some Israeli shows only have Hebrew-text artwork on TMDB) —
  those fall back to Hebrew rather than showing no image.
- **Light/dark theme toggle** (moon icon + switch at the bottom of the
  sidebar), persisted across visits.
- **Settings** (gear icon) — edit your SIMKL/TMDB keys any time; a
  **×** lets you back out without saving, returning to My List.

## Managing your list (search, add, status, remove)

Click **Search Show** in the sidebar to open a search box (TV shows
only). Click a result to open its detail view, which:

- Checks whether the show is already anywhere in your SIMKL list
  (Watching / Plan to Watch / Hold / Completed / Dropped) and shows
  its current status, including watched/total episode progress if
  it's already there.
- Lets you set (or change) its status with one click — the change is
  written straight to SIMKL and the page refreshes to reflect it.

Every card already in **My List** also has a **⋮** menu for the same
status change, plus **mark the next episode watched** and **Remove
from list** (with a confirmation, since it deletes the show's SIMKL
history along with it). All of these show a toast on success or
failure.

## How the numbers are kept accurate

- **Remaining episode count** always comes straight from SIMKL's own
  aggregate fields (`total - not_aired - watched`) — exactly what
  simkl.com itself would show, never second-guessed by TMDB (a show
  that's very new may have episodes SIMKL knows about before TMDB has
  added them at all — the count still comes out right either way).
- **Time estimates** use TMDB's exact per-episode runtime for the
  specific episodes SIMKL says are remaining, falling back to the
  show's average runtime only for episodes TMDB doesn't have — this
  avoids a misleading series-wide average for shows whose episode
  length changes a lot across seasons.
- **Air dates/times** in Airing Next come from SIMKL's own episode
  data (exact date+time with timezone offset), not TMDB — falling
  back to TMDB (date only, no relative day label since it can't be
  verified precisely) only if SIMKL has nothing for a show.

## A known limitation

A brand-new episode may occasionally have a poster/episode-title gap
if TMDB hasn't caught up yet — the episode count and air-status are
unaffected either way, since those come from SIMKL directly.

## A note on CORS

This relies on your browser being allowed to call `api.simkl.com` and
`api.themoviedb.org` directly — for both reading your list and, now,
writing to it (search, add, status change, remove). Both are
documented as CORS-enabled for browser apps; if you still see a
"Network/CORS error reaching SIMKL" message, your browser is blocking
it.

## Publishing it (e.g. for a shortcut)

Since your API keys are never stored *in* the file, you can safely put
`index.html` in a git repo:

```
git add index.html
git commit -m "update"
git push
```

To view it as a rendered page (not raw code) from a link:
- **GitHub Pages** (free for public repos): enable it under
  *Settings → Pages*, then link to
  `https://<username>.github.io/<repo>/index.html`.
- **htmlpreview.github.io** (no setup, works for private repos too if
  you're logged in):
  `https://htmlpreview.github.io/?https://github.com/<username>/<repo>/blob/main/index.html`

Either way, since the page computes everything live on load, the link
always shows current data — no need to regenerate or re-push anything
after you watch more episodes.

This repo is published via GitHub Pages at
[elad-navon.github.io/simkl_my_list_update](https://elad-navon.github.io/simkl_my_list_update/).
A snapshot of the previous UI (before the sidebar-dashboard redesign)
stays permanently available at
[/legacy/](https://elad-navon.github.io/simkl_my_list_update/legacy/),
independent of ongoing changes to the root page.

## Version

Current: **v32**
