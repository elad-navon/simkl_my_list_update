// The site's version: one number up for every deploy (push to main), with
// that day's date. The settings screen shows it (and whether a newer one is
// live); the service worker names its cache after it, so every deploy
// replaces the files kept for offline use.
self.SITE_VERSION = { number: 26, date: "2026-10-29" };
