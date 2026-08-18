# SIMKL My List Summary

A single self-contained HTML page that answers one question: **for the
shows in my SIMKL "My List" (status *Watching*, with a new episode
waiting), how many episodes are left, and how much time will it take
to catch up?**

Everything runs as JavaScript **in your browser** — no server, no
backend, nothing to keep running in the background. Episode/watch
status comes from [SIMKL](https://simkl.com); per-episode runtimes and
poster/backdrop artwork come from [TMDB](https://www.themoviedb.org)
(more accurate than SIMKL's single show-level runtime value).

## Setup

1. Open `simkl_live.html` in your browser (double-click it, or host it
   anywhere — see [Publishing it](#publishing-it-eg-for-a-startme-shortcut)
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

- One card per show: poster/banner, progress bar, total / available /
  watched / remaining episode counts, time left, and the next episode
  to watch (e.g. `S03E01`).
- **My List ↔ Airing Next toggle** (top toolbar) — My List shows what
  you have left to watch; Airing Next shows upcoming (not-yet-aired)
  episodes for the shows you're actively watching, plus true future
  premieres (series you haven't started at all) from your Plan to
  Watch list — soonest first. Plan to Watch shows that already aired
  but you just haven't started ("backlog") are excluded.
- **Poster ↔ Banner toggle** (top toolbar) — banners are TMDB's
  landscape "backdrop" images.
- **⟳ icon** on each card — cycles to another available poster/banner
  for that show, if TMDB has more than one. Does nothing if there's
  only one.
- Only **English or no-language** artwork is used (no foreign-text
  posters), except shows that have **no English/no-language image at
  all** (some Israeli shows only have Hebrew-text artwork on TMDB) —
  those fall back to Hebrew rather than showing no image.
- **Settings** (⚙) — edit your SIMKL/TMDB keys any time.

## A known limitation

Air dates come from TMDB. SIMKL's own Airing Next/Calendar pulls from
**TheTVDB** instead, which tends to have better coverage of local and
international content (e.g. local-language reality shows). A show
that appears in SIMKL's Airing Next may not appear here if TMDB
doesn't have accurate episode air-date data for it.

## A note on CORS

This relies on your browser being allowed to call `api.simkl.com` and
`api.themoviedb.org` directly. TMDB is known to support this. SIMKL's
support is unconfirmed — if you see a "Network/CORS error reaching
SIMKL" message, your browser is blocking it.

## Publishing it (e.g. for a StartMe shortcut)

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

## Notes

- **Membership in "My List"** is taken directly from SIMKL's own
  `next_to_watch` field — this always matches what the site itself
  shows, rather than being re-derived from episode counts.
- **Remaining episode counts / time** are computed per-episode against
  TMDB (aired date ≤ today, not already marked watched), falling back
  to SIMKL's own aggregate counts only if a show has no TMDB match.
- Read-only — this never modifies your SIMKL data.

## Version

Current: **v10**
