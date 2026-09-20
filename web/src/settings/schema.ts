/**
 * Settings: API keys and display preferences.
 *
 * Separate from the library on purpose. The library is irreplaceable and gets
 * backed up; settings are two API keys and a couple of toggles that take
 * seconds to re-enter, so they stay local and out of the backup. Putting a
 * GitHub token in the file that the GitHub token uploads would also be a poor
 * idea on its own.
 *
 * They live in localStorage rather than IndexedDB, which is the opposite of the
 * decision made for the library, for two reasons. Theme has to be readable
 * synchronously during the first paint or the page flashes the wrong colours,
 * and IndexedDB cannot do that. And the quota pressure that made localStorage
 * the wrong home for watch history came from the API response cache sharing the
 * same budget (app.js:349-399) - with that cache gone to IndexedDB, what is
 * left here is a few hundred bytes.
 */

export const SETTINGS_KEY = "tv_settings";

/**
 * Keys the old app wrote, read once so the rewrite starts with the TMDB key
 * and preferences already in place.
 *
 * Both apps are served from the same GitHub Pages origin, so they genuinely
 * share this storage. That is why the rewrite writes under its OWN key and only
 * ever READS these: the old app stays usable, unchanged, for as long as the two
 * run side by side.
 */
export const LEGACY_KEYS = {
  tmdbApiKey: "tmdb_api_key",
  theme: "simkl_theme",
  imageMode: "simkl_image_mode",
  imageOverrides: "simkl_image_overrides",
} as const;

export type Theme = "dark" | "light";

/** Which artwork shape the cards use. Ported from app.js:44. */
export type ImageMode = "poster" | "banner";

export type Settings = {
  /** TMDB is the only key the app genuinely needs. */
  tmdbApiKey: string;
  /** Optional: without it the IMDb rating badge is simply absent. */
  omdbApiKey: string;
  /** Optional: fine-grained, `gist` scope only. Phase 5. */
  gistToken: string;
  /** The gist holding the backup, once one exists. */
  gistId: string;
  theme: Theme;
  imageMode: ImageMode;
  /**
   * The greeting and avatar, which the old app hardcoded into its markup
   * (index.html:47-50). Anyone else running this copy should not be greeted as
   * Elad.
   */
  displayName: string;
  /** A data URL or a path under the app base. Empty means no avatar. */
  avatarUrl: string;
};

export function defaultSettings(): Settings {
  return {
    tmdbApiKey: "",
    omdbApiKey: "",
    gistToken: "",
    gistId: "",
    theme: "dark",
    imageMode: "poster",
    displayName: "",
    avatarUrl: "",
  };
}

const THEMES: readonly string[] = ["dark", "light"];
const IMAGE_MODES: readonly string[] = ["poster", "banner"];

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Builds settings from whatever is in storage, falling back field by field.
 *
 * Deliberately tolerant: a corrupt or half-written blob yields defaults for the
 * fields it cannot read rather than throwing, because settings failing to parse
 * must never be the reason the app will not start.
 */
export function parseSettings(stored: unknown, legacy: Partial<Record<keyof Settings, unknown>> = {}): Settings {
  const raw = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  const defaults = defaultSettings();

  const pick = (field: keyof Settings): string | null => str(raw[field]) ?? str(legacy[field]);

  const theme = pick("theme");
  const imageMode = pick("imageMode");

  return {
    tmdbApiKey: pick("tmdbApiKey") ?? defaults.tmdbApiKey,
    omdbApiKey: pick("omdbApiKey") ?? defaults.omdbApiKey,
    gistToken: pick("gistToken") ?? defaults.gistToken,
    gistId: pick("gistId") ?? defaults.gistId,
    theme: theme && THEMES.includes(theme) ? (theme as Theme) : defaults.theme,
    imageMode:
      imageMode && IMAGE_MODES.includes(imageMode) ? (imageMode as ImageMode) : defaults.imageMode,
    displayName: pick("displayName") ?? defaults.displayName,
    avatarUrl: pick("avatarUrl") ?? defaults.avatarUrl,
  };
}

/** True once the app has the one key it cannot work without. */
export function isConfigured(settings: Settings): boolean {
  return settings.tmdbApiKey !== "";
}
