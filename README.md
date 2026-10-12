# TV Series — My List

A small static site for tracking the TV shows you watch: **for the shows
you're watching, how many episodes are left and how much time it will
take to catch up**, what airs next, what you watched recently and what's
waiting in Plan to Watch, plus a built-in search to add shows, change
their status or remove them.

Everything runs as JavaScript **in your browser**: no server of its own
and no build step. The files sit side by side and load like any static
page.

- **Your library** (which shows, their status, which episodes you
  watched and when) is yours: it lives in your own private
  [Firebase](https://firebase.google.com) database (Firestore, free
  plan), behind a Google sign-in. Only your Google account can read or
  write it.
- **Everything about the shows themselves** comes from public sources:
  episode lists and air times from [TVMaze](https://www.tvmaze.com)
  (with [TMDB](https://www.themoviedb.org) as the fallback), artwork,
  runtimes and details from TMDB, ratings from
  [MDBList](https://mdblist.com) and TMDB.
- **SIMKL is optional.** If something marks episodes watched on SIMKL
  for you (e.g. the Emby plugin), the site copies them into your library
  automatically. Nothing else depends on SIMKL, and nothing is ever
  written to it.

## Setup

1. Open the site and sign in with your Google account.
2. The first run shows a **Setup** screen. Paste in a **TMDB API key**
   (free at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)).
   Optional:
   - **MDBList API key**: IMDb, Rotten Tomatoes and Trakt ratings.
   - **Fanart.tv API key**: more posters and banners in the image picker.
   - **SIMKL Client ID** plus **Connect SIMKL**: the auto-marking below.
     Only one device needs it, since what it copies goes into the
     shared library.

   Keys are saved only in your browser's `localStorage`, never in the
   files, so the repo is safe to keep public.

The Firebase project (`tv-library-c29bd`) and its security rules are
already set up. Its config in `firebase-backend.js` is meant to be
public: it grants nothing by itself; the rules allow only the owner's
signed-in account.

## Features

- **Single-page dashboard**: a top bar (logo, live clock and date, Switch
  to Banners, Search Show, Settings, greeting and avatar), the **My
  List** carousel, and three panels below it: **Recently Watched**,
  **Airing Next** and **Plan to Watch**.
- **My List cards**: poster or banner, a progress bar, total / available
  / watched / remaining episodes, time left (*next episode / all
  remaining*), the next episode with its title, and premiere / finale
  ribbons. Click the time-left line for a breakdown of every remaining
  episode.
- Every card's **⋮** menu: mark the next episode watched, change status
  (Watching / Plan to Watch / On Hold / Completed / Dropped), or remove
  the show.
- **Search Show**: TMDB in English and in Hebrew at once, merged. A
  result's page shows its status in your library, lets you set or change
  it, shows ratings, and opens the **episodes manager** (mark or unmark
  single episodes or whole seasons, then Save).
- **Images**: click any poster or banner to pick another one (TMDB,
  TVMaze, Metahub, and Fanart.tv with a key). The pick is remembered on
  this device. Only English or no-language artwork is used, with a
  Hebrew fallback for shows that have nothing else.
- **Network logos** from TMDB, with a small local set for Israeli
  networks TMDB has no logo for.
- **Save status** in the top bar: *Saving…*, *Offline – N waiting*,
  *Not saved – retry*, *Conflict – choose*. Hidden while everything is
  saved.
- **Settings**: keys, dark mode, the one-page layout, and for the
  library: who's signed in, **Download backup**, **Restore from
  backup**, **Sign out**.
- Responsive, installable as an app (PWA), and fast on repeat visits:
  TMDB answers are cached in `localStorage`, episode lists in IndexedDB.

## How it works

| File | What it does |
|---|---|
| `library-core.js` | The library model and every rule computed from it (no network, runs in Node too). |
| `episode-source.js` | Episode lists from TVMaze / TMDB, cached, rate-limited, linked across sources. |
| `library-store.js` | All changes: an outbox, retries, conflict checks, backups. |
| `firebase-backend.js` | Google sign-in and Firestore (`users/{uid}/shows/{id}`, `users/{uid}/meta/{name}`). |
| `library-adapter.js` | Answers the page's questions from the library, in the item shape the row builders were written against. |
| `simkl-bridge.js` | The optional SIMKL auto-marking. |
| `app.js` | The page itself. |

A show's document id is its TMDB id; a show TMDB doesn't know is kept
under `imdb:<id>` or `tvdb:<id>`. A show stores only what you know:
status, when it was added, which episodes you watched and when, and a
few marks (e.g. `autoStarted`). Everything else is fetched.

## The rules

**Episodes and "aired"**
- An episode with an exact air time has aired once that moment has
  passed. A date-only episode counts as aired **from the next day** (on
  the day itself its time is unknown). An episode with no date has not
  aired, unless you've watched it.
- Specials (season 0) are kept but never counted.
- **Episode list per show**: TVMaze by default (it has air times), or
  TMDB when its numbering fits the show's history better, or a fixed
  snapshot of SIMKL's list for shows the outside sources don't cover
  (both decided at import), followed by every episode the outside source
  lists after the snapshot's end, aired or not. Upcoming episodes the main source doesn't
  list yet are added from the other one, but never one dated before the
  main source's last episode. A TMDB-numbered episode takes TVMaze's
  exact time when both agree it's the same episode. Placeholder titles
  ("TBA", "Episode 3") count as no title.

**Counts and the next episode**
- *Available* = aired episodes (plus any you watched). *Remaining* =
  available − watched.
- *Next to watch* = the first aired, unwatched episode after the latest
  one you watched (in season / episode order). Gaps before it still
  count as remaining.
- My List shows Watching shows that have a next episode, ordered by the
  later of its air time and the last time you watched the show.

**Status**
- A Plan to Watch show whose first episode aired in the last 30 days,
  with nothing watched, moves to Watching once. The mark is kept on the
  show (`autoStarted`), so a show moved back by hand stays there, on
  every device.

**Saving**
- A change counts as saved only once the database confirmed it. Until
  then it's shown as pending, never as done.
- Each change carries an id, so a retry or a second device never applies
  it twice.
- Changes that don't collide merge (e.g. different episodes marked on
  two devices). A real conflict (e.g. a status changed on both) is never
  overwritten blindly: you choose which version stays.
- No connection: changes wait on the device (they survive a reload) and
  go out when it's back.

**SIMKL auto-marking** (`simkl-bridge.js`), when connected
- Runs on load, on every refresh, every 15 minutes while open, and when
  the page returns to the foreground. Asks SIMKL what changed since the
  last pass (one small request), then copies newly watched episodes,
  with their real watch times.
- Only episodes watched after the last pass are taken, so an episode
  you unmarked in the library never comes back.
- Plan to Watch / On Hold move to Watching; a show not in the library is
  added as Watching; Completed and Dropped keep their status.
- How far it has read is kept in the library, shared by every device.

## Backups and recovery

- **Settings → Download backup** saves the whole library as a JSON file;
  **Restore from backup** replaces the library with one (a backup of
  what was there is downloaded first).
- The import tool (below) also downloads backups before it writes
  anything.

## Tools (local, not linked from the site)

- `tools/migrate.html`: read-only preview of an import from SIMKL, with
  a report of every gap.
- `tools/import.html`: copies the SIMKL library into the library: SIMKL
  backup first, a confirmation (and a backup) before replacing an
  existing library, and a full read-back check afterwards.
- `tools/store-check.html`: checks the database, sign-in and security
  rules with a temporary test show.

They read your SIMKL sign-in and TMDB key from the browser, so open them
on the same address as the site.

## Tests

- `node --test "tests/*.test.js"`: the core rules, the episode source,
  the store, the adapter, the SIMKL bridge and the database writes.
- In a browser, through a local web server at the project root:
  - `tests/compare-modes.harness.html`: the real page against a fake
    world, compared with `tests/golden/panels.json` (what the
    SIMKL-backed site showed for the same world).
    `?scenario=writes|ui|bridge` covers changes, the surrounding
    screens, and the auto-marking.
  - `tests/migrate-tool.harness.html` and
    `tests/import-tool.harness.html`: the two tools.

## Install it on your phone (PWA)

Open the site in Chrome or Brave on Android, then **⋮ → Install app**.
`manifest.json`, `service-worker.js` (caches the app files for fast or
offline loads; bump `CACHE_NAME` on every deploy) and `icons/` make
this work.

## Publishing

The site is served by GitHub Pages from `main` at
[elad-navon.github.io/simkl_my_list_update](https://elad-navon.github.io/simkl_my_list_update/).
A snapshot of an older UI stays at
[/legacy/](https://elad-navon.github.io/simkl_my_list_update/legacy/).
