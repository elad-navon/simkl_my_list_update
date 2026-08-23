# TV Series — SIMKL My List Summary

A single self-contained HTML page that answers one question: **for the
shows in my SIMKL "My List" (status *Watching*, with a new episode
waiting), how many episodes are left, and how much time will it take
to catch up?**

Everything runs as JavaScript **in your browser** — no server, no
backend, nothing to keep running in the background. Episode/watch
status comes from [SIMKL](https://simkl.com); poster/backdrop artwork
and episode runtimes come from [TMDB](https://www.themoviedb.org).

## Setup

1. Open `simkl_live.html` in your browser (double-click it, or host it
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

- **My List / Airing Next** nav tabs — My List shows what you have
  left to watch; Airing Next shows upcoming (not-yet-aired) episodes
  for the shows you're actively watching, plus true future premieres
  (series you haven't started at all) from your Plan to Watch list —
  soonest first. Uses SIMKL's own exact date+time per episode, so day
  labels ("Today"/"Tomorrow") match what simkl.com itself shows.
  Plan to Watch shows that already aired but you just haven't started
  ("backlog") are excluded.
- One card per show: poster or banner, progress bar, total /
  available / watched / remaining episode counts, time left (shown as
  *next episode time / total remaining time* when more than one
  episode is left, e.g. `0h 45m / 3h 23m left`), and the next episode
  to watch (e.g. `S03E01`) with its title when known.
- **Poster ↔ Banner** toggle (nav bar) — the icon shown reflects what
  you'll switch to. Per-card **⟳** cycles to another available image
  of the current type, if TMDB has more than one.
- **IMDb button** (bottom-left of each poster) — opens the show's
  IMDb page, with its SIMKL rating shown alongside when available.
- Remaining-episode count badge (bottom-right of each poster) is
  colored to match the IMDb rating style.
- Only **English or no-language** artwork is used (no foreign-text
  posters), except shows that have **no English/no-language image at
  all** (some Israeli shows only have Hebrew-text artwork on TMDB) —
  those fall back to Hebrew rather than showing no image.
- **Recently Watched** row at the bottom of My List — your last 10
  watched episodes (small posters, title + season/episode), including
  shows you've fully caught up on and no longer appear above.
- **Light/dark theme toggle** (moon/sun icon in the nav bar),
  persisted across visits.
- **Settings** (gear icon) — edit your SIMKL/TMDB keys any time.

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
`api.themoviedb.org` directly. TMDB is known to support this. SIMKL's
support is unconfirmed — if you see a "Network/CORS error reaching
SIMKL" message, your browser is blocking it.

## Publishing it (e.g. for a shortcut)

Since your API keys are never stored *in* the file, you can safely put
`simkl_live.html` in a git repo:

```
git add simkl_live.html
git commit -m "update"
git push
```

To view it as a rendered page (not raw code) from a link:
- **GitHub Pages** (free for public repos): enable it under
  *Settings → Pages*, then link to
  `https://<username>.github.io/<repo>/simkl_live.html`.
- **htmlpreview.github.io** (no setup, works for private repos too if
  you're logged in):
  `https://htmlpreview.github.io/?https://github.com/<username>/<repo>/blob/main/simkl_live.html`

Either way, since the page computes everything live on load, the link
always shows current data — no need to regenerate or re-push anything
after you watch more episodes.

## Version

Current: **v32**
