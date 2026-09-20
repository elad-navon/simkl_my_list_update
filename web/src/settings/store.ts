/**
 * The settings store.
 *
 * Reads synchronously at module load, so the theme is known before the first
 * paint and there is no flash of the wrong colours. Writes are wrapped, because
 * a private window can throw on `localStorage.setItem` and a settings save
 * failing is not a reason to lose the session - the old app learned the same
 * lesson the hard way and wrapped every write (`safeSetItem`, app.js:63-68).
 */

import { create } from "zustand";
import {
  defaultSettings,
  isConfigured,
  LEGACY_KEYS,
  parseSettings,
  SETTINGS_KEY,
  type Settings,
} from "./schema";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Reads the old app's keys, so the rewrite starts already configured. */
function readLegacy(): Partial<Record<keyof Settings, unknown>> {
  return {
    tmdbApiKey: readString(LEGACY_KEYS.tmdbApiKey),
    theme: readString(LEGACY_KEYS.theme),
    imageMode: readString(LEGACY_KEYS.imageMode),
    simklClientId: readString(LEGACY_KEYS.simklClientId),
    simklToken: readString(LEGACY_KEYS.simklToken),
  };
}

export function loadSettings(): Settings {
  return parseSettings(readJson(SETTINGS_KEY), readLegacy());
}

function persist(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private window, or storage disabled. The in-memory store still works for
    // this session; nothing is lost that cannot be re-entered.
  }
}

/**
 * Applies the theme to the document.
 *
 * Kept as a class on `body` rather than as inline styles because `style.css`
 * already carries a complete `body.light-theme` block (1,009 lines of it), and
 * the port reuses that wholesale.
 */
export function applyTheme(theme: Settings["theme"]): void {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("light-theme", theme === "light");
}

export type SettingsState = {
  settings: Settings;
  /** True once a TMDB key exists; false shows the setup screen instead. */
  configured: boolean;

  update: (patch: Partial<Settings>) => void;
  toggleTheme: () => void;
  toggleImageMode: () => void;
  reset: () => void;
};

export const useSettings = create<SettingsState>((set, get) => ({
  settings: loadSettings(),
  configured: isConfigured(loadSettings()),

  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings, configured: isConfigured(settings) });
    persist(settings);
    if (patch.theme) applyTheme(patch.theme);
  },

  toggleTheme: () => {
    get().update({ theme: get().settings.theme === "dark" ? "light" : "dark" });
  },

  toggleImageMode: () => {
    get().update({ imageMode: get().settings.imageMode === "poster" ? "banner" : "poster" });
  },

  reset: () => {
    const settings = defaultSettings();
    set({ settings, configured: false });
    persist(settings);
    applyTheme(settings.theme);
  },
}));
