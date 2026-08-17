# SIMKL My List Update

A lightweight browser-based dashboard that shows the TV shows currently
being watched on SIMKL and calculates the remaining watch time using
episode data from TMDB.

## Overview

This project is a single-page HTML application. It runs entirely in the
user's browser and does not require a backend server.

The application:

-   Connects to SIMKL to retrieve the user's currently watching shows.
-   Uses SIMKL authentication through the PIN authorization flow.
-   Retrieves TV show and episode information from TMDB.
-   Calculates the number of remaining aired episodes.
-   Calculates estimated remaining watch time.
-   Displays posters, progress, next episode, episode counts, and total
    remaining watch time.
-   Stores configuration and the SIMKL access token in the browser's
    `localStorage`.
-   Keeps API credentials out of the HTML source file.

## Live Demo

GitHub Pages:

`https://elad-navon.github.io/simkl_my_list_update/`

## Requirements

You need:

1.  A SIMKL account.
2.  A SIMKL Client ID.
3.  A TMDB API key.
4.  A modern web browser with JavaScript enabled.

## First-Time Setup

When the application is opened for the first time, it displays a Setup
screen.

Enter:

### SIMKL Client ID

Create or obtain a SIMKL application from:

https://simkl.com/settings/developer/

### TMDB API Key

Obtain a TMDB API key from:

https://www.themoviedb.org/settings/api

Click **Save** after entering both values.

The values are stored only in the browser's `localStorage` and are not
written into `index.html`.

## SIMKL Authentication

After configuration, the application starts the SIMKL PIN authorization
flow.

The application:

1.  Requests a PIN from SIMKL.
2.  Displays the verification URL and authorization code.
3.  Waits for the user to approve the authorization.
4.  Stores the returned SIMKL access token in browser `localStorage`.
5.  Uses the token for subsequent SIMKL API requests.

If the token expires or is revoked, it is removed from local storage and
the user is asked to authenticate again.

## How Remaining Time Is Calculated

For each show currently marked as `watching`, the application:

1.  Reads the user's watched episode information from SIMKL.
2.  Retrieves the corresponding show data from TMDB.
3.  Retrieves season and episode data from TMDB.
4.  Ignores specials.
5.  Ignores episodes that have not aired yet.
6.  Ignores episodes already marked as watched.
7.  Counts the remaining aired episodes.
8.  Uses the episode runtime from TMDB when available.
9.  Falls back to the show's average episode runtime when an episode
    runtime is unavailable.

The application then displays:

-   Total shows
-   Total episodes remaining
-   Total estimated watch time
-   Watched episodes
-   Available episodes
-   Next episode to watch
-   Progress
-   Show poster

## Data Sources

### SIMKL

Used for:

-   User authentication
-   Currently watching list
-   Watched episode information
-   Next episode to watch
-   Show and episode identifiers

API base URL:

`https://api.simkl.com`

### TMDB

Used for:

-   Show details
-   Season information
-   Episode information
-   Episode air dates
-   Episode runtimes
-   Poster images

API base URL:

`https://api.themoviedb.org/3`

## Architecture

The project intentionally has no backend.

``` text
Browser
   |
   +-- SIMKL API
   |     +-- Authentication
   |     +-- My List
   |     +-- Watched episodes
   |
   +-- TMDB API
         +-- Show metadata
         +-- Seasons
         +-- Episodes
         +-- Runtime
         +-- Posters
```

Everything is implemented in a single `index.html` file containing:

-   HTML markup
-   CSS styling
-   JavaScript application logic

## Local Storage

The application uses browser `localStorage` for:

-   SIMKL Client ID
-   TMDB API key
-   SIMKL access token

The keys are defined internally as:

-   `simkl_client_id`
-   `tmdb_api_key`
-   `simkl_access_token`

The credentials are therefore not hardcoded into the source file and are
not committed to GitHub.

## Caching

A small in-memory TMDB cache is used during each refresh.

Show and season requests are cached so the same TMDB resource is not
requested repeatedly during a single calculation.

The cache is not persisted between page reloads.

## User Interface

The interface provides:

-   Dark themed dashboard
-   Responsive show grid
-   Show posters
-   Watch progress bars
-   Remaining episode counts
-   Estimated remaining watch time
-   Refresh button
-   Settings button
-   Setup and authorization screens
-   Error handling

## Refreshing Data

Click **Refresh** to run the application again and retrieve the latest
information from SIMKL and TMDB.

The application does not use a background server or scheduled process.

## Limitations

### Browser / CORS

The application makes API requests directly from the browser.

If the browser or an API blocks cross-origin requests, the application
may display a CORS/network error. In that case, a server-side or
local-server version may be required.

### Runtime Accuracy

Remaining watch time is an estimate.

The calculation prefers the runtime reported for each TMDB episode. If
that value is unavailable, the application's average show runtime is
used.

### API Availability

The application depends on SIMKL and TMDB being reachable and returning
the expected API responses.

## Project Structure

``` text
simkl_my_list_update/
└── index.html
```

## Deployment

The project can be hosted as a static site using GitHub Pages.

Because the application consists of a single HTML file and runs entirely
in the browser, no server-side deployment is required.

## Version

Current application version:

`1.0`

## License

No license has been specified yet.
