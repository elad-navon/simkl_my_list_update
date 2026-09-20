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
  /**
   * Reading these means the rewrite starts already authorized against SIMKL,
   * rather than sending you through the PIN flow for an account the browser is
   * already holding a token for.
   */
  simklClientId: "simkl_client_id",
  simklToken: "simkl_access_token",
} as const;

export type Theme = "dark" | "light";

/**
 * Who owns the list.
 *
 * `simkl` keeps SIMKL as the source of truth with the local library mirroring
 * it; `local` cuts the dependency and makes the library itself the truth. See
 * `library/backend.ts` - the point of the setting is that the second is always
 * available without a migration.
 */
export type BackendMode = "simkl" | "local";

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
  /** Which source owns the list. Defaults to SIMKL when a token is present. */
  backendMode: BackendMode;
  /** SIMKL app credentials, needed only in SIMKL mode. */
  simklClientId: string;
  /** The PIN flow's access token. No refresh token exists, so a 401 is final. */
  simklToken: string;
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
    backendMode: "local",
    simklClientId: "",
    simklToken: "",
    theme: "dark",
    imageMode: "poster",
    displayName: "",
    avatarUrl: "",
  };
}

const THEMES: readonly string[] = ["dark", "light"];
const IMAGE_MODES: readonly string[] = ["poster", "banner"];
const BACKEND_MODES: readonly string[] = ["simkl", "local"];

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
  const simklClientId = pick("simklClientId") ?? defaults.simklClientId;
  const simklToken = pick("simklToken") ?? defaults.simklToken;

  // An explicit choice always wins. With none recorded, a browser that already
  // holds a SIMKL token was using SIMKL, so that is where it should carry on -
  // defaulting a working setup to `local` would silently show an empty list.
  const storedMode = pick("backendMode");
  const backendMode: BackendMode =
    storedMode && BACKEND_MODES.includes(storedMode)
      ? (storedMode as BackendMode)
      : simklToken
        ? "simkl"
        : defaults.backendMode;

  return {
    tmdbApiKey: pick("tmdbApiKey") ?? defaults.tmdbApiKey,
    omdbApiKey: pick("omdbApiKey") ?? defaults.omdbApiKey,
    gistToken: pick("gistToken") ?? defaults.gistToken,
    gistId: pick("gistId") ?? defaults.gistId,
    backendMode,
    simklClientId,
    simklToken,
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

/**
 * Whether SIMKL mode can actually run.
 *
 * Selecting the mode is not the same as being able to use it: the client id and
 * the token are both required, and a 401 clears the token without changing the
 * mode - so the UI has to be able to say "still on SIMKL, needs authorizing
 * again" rather than silently behaving as though the setting had flipped.
 */
export function canUseSimkl(settings: Settings): boolean {
  return settings.simklClientId !== "" && settings.simklToken !== "";
}
