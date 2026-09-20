/**
 * Registering the service worker, and checking for updates often enough.
 *
 * Ported from app.js:3611-3628, where the reasoning is worth keeping: browsers
 * only re-check a registered worker's script once every 24 hours at most. That is
 * fine for a site that rarely changes and far too slow for one that sits open on
 * a TV for a week without a navigation. So `updateViaCache: "none"` stops the
 * browser's HTTP cache from ever answering that check, and `update()` is called
 * explicitly - on load, and again whenever the app comes back to the foreground.
 *
 * The caching strategy itself moves into `vite.config.ts`, because
 * `vite-plugin-pwa` generates the worker. What could not move is the reason the
 * old one fetched with a cache-busting query string, which is written up there.
 */

const UPDATE_POLL_MS = 60 * 60 * 1000;

export type ServiceWorkerHandle = {
  /** Asks the browser to look for a new worker now. */
  checkForUpdate: () => void;
  unregisterListeners: () => void;
};

/**
 * @param onUpdateReady Called when a new version has been installed and is
 *   waiting. The caller decides what to say - a reload is the user's to make,
 *   since one mid-action would lose whatever they were doing.
 */
export function registerServiceWorker(options: {
  onUpdateReady?: (() => void) | undefined;
} = {}): ServiceWorkerHandle {
  const noop: ServiceWorkerHandle = {
    checkForUpdate: () => undefined,
    unregisterListeners: () => undefined,
  };

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return noop;

  // Not in dev. The plugin does not emit a worker there (devOptions.enabled is off,
  // deliberately - a worker caching a dev server's output is a way to spend an
  // afternoon debugging a stale bundle), so this would fetch /sw.js, get the dev
  // server's HTML fallback back, and log "unsupported MIME type" on every load.
  if (import.meta.env.DEV) return noop;

  let registration: ServiceWorkerRegistration | null = null;

  const check = () => {
    registration?.update().catch(() => {
      // Offline, or the worker's script is momentarily unreachable. The existing
      // worker keeps serving; there is nothing to report and nothing to do.
    });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") check();
  };

  const timer = setInterval(check, UPDATE_POLL_MS);
  document.addEventListener("visibilitychange", onVisible);

  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
      check();

      // `waiting` means a new worker is installed and sitting behind this one.
      // Reported rather than activated: skipping the wait would swap the app's
      // code out from under whatever the user is in the middle of.
      if (reg.waiting && options.onUpdateReady) options.onUpdateReady();

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            options.onUpdateReady?.();
          }
        });
      });
    })
    .catch(() => {
      // No worker means no offline shell. Everything else still works, so this is
      // not worth telling the user about.
    });

  return {
    checkForUpdate: check,
    unregisterListeners: () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
