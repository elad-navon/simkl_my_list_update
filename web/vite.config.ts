import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Deployed to GitHub Pages under https://elad-navon.github.io/simkl_my_list_update/,
// so every built asset URL has to carry that prefix.
const PAGES_BASE = "/simkl_my_list_update/";

export default defineConfig(({ command }) => ({
  // The dev server serves from the root, decided here rather than by an env var
  // the developer has to remember - and BASE_PATH=/ is actively a trap on
  // Windows, where Git Bash rewrites a lone slash into a Windows path and the
  // base silently becomes "/Program Files/Git/".
  base: command === "serve" ? "/" : (process.env.BASE_PATH ?? PAGES_BASE),
  plugins: [
    react(),
    VitePWA({
      // The worker is registered by hand in src/pwa/register.ts rather than by the
      // plugin's helper, because the old app's update behaviour has to be kept:
      // updateViaCache "none" plus an explicit update() on load and on every
      // return to the foreground. See that file for why 24 hours is too slow here.
      injectRegister: null,
      registerType: "prompt",
      filename: "sw.js",

      manifest: {
        name: "My Watch List",
        short_name: "My Watch List",
        description: "Personal TV watch-list dashboard",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#111820",
        theme_color: "#111820",
        orientation: "portrait-primary",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },

      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],

        // Navigations go to the network first and fall back to the cached shell,
        // which is what the hand-written worker did for everything
        // (service-worker.js:27-56). Kept because of a specific problem it was
        // written for: GitHub Pages sits behind a CDN that serves stale responses
        // for minutes regardless of cache-control, so a device that did not
        // publish the deploy can keep getting the old copy. Network-first means
        // it gets the new one as soon as the edge does, instead of whenever the
        // worker happens to decide its cache is old.
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // The app's own files. NetworkFirst rather than the usual
            // StaleWhileRevalidate for the same CDN reason: revalidating in the
            // background means one more load on the previous version, and this
            // app gets deployed often enough for that to be noticeable.
            urlPattern: ({ sameOrigin, request }) => sameOrigin && request.method === "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "tvseries-shell",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 80 },
            },
          },
          {
            // Artwork, which is immutable per URL: TMDB paths include a hash, so a
            // cached image is never the wrong one and can be served straight from
            // the cache. This is the one thing the old worker did NOT cache -
            // it ignored cross-origin requests entirely (service-worker.js:31),
            // so every poster was re-fetched on every load, offline included.
            urlPattern: /^https:\/\/image\.tmdb\.org\//,
            handler: "CacheFirst",
            options: {
              cacheName: "tmdb-images",
              expiration: { maxEntries: 600, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: {
        // Off in dev: a worker caching a dev server's output is a way to spend an
        // afternoon debugging a stale bundle.
        enabled: false,
      },
    }),
  ],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    // Node by default: most of this codebase is pure functions, and a DOM would
    // only make them slower. Component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
}));
