/**
 * Settings. Ported from app.js:100-157, with what the rewrite added.
 *
 * The new part is the source switch. Everything else the plan called for lands
 * here too: the greeting and avatar that used to be baked into the markup, the
 * OMDb key that replaces the IMDb rating SIMKL supplied, and the Gist token for
 * the backup.
 *
 * The note about storage is kept word for word, because it is the reason this
 * repo can be public: nothing entered here is ever written into a file.
 */

import { useState } from "react";
import { canUseSimkl, type BackendMode, type Settings } from "../settings/schema";
import styles from "./SettingsScreen.module.css";

export type SettingsScreenProps = {
  settings: Settings;
  onSave: (patch: Partial<Settings>) => void;
  onToggleTheme: () => void;
  /** Absent on first run, when there is no view to go back to. */
  onClose: (() => void) | null;
  /** Starts the SIMKL PIN flow; the caller owns the dialog it opens. */
  onAuthorizeSimkl: () => void;
  /** Runs the one-time import of SIMKL's lists into the local library. */
  onImportFromSimkl: (() => void) | null;
  onExportLibrary: () => void;
  onImportLibrary: (file: File) => void;
};

export function SettingsScreen({
  settings,
  onSave,
  onToggleTheme,
  onClose,
  onAuthorizeSimkl,
  onImportFromSimkl,
  onExportLibrary,
  onImportLibrary,
}: SettingsScreenProps): React.JSX.Element {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState<string | null>(null);

  const field = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = () => {
    if (!draft.tmdbApiKey.trim()) {
      setError("A TMDB key is required - it is the only thing the app cannot work without.");
      return;
    }
    if (draft.backendMode === "simkl" && !canUseSimkl(draft)) {
      setError("SIMKL mode needs a client ID and an authorization. Authorize below, or choose the local library.");
      return;
    }
    setError(null);
    onSave(draft);
  };

  return (
    <div className="center-box" style={{ position: "relative" }}>
      {onClose ? (
        <button
          type="button"
          className="modal-close-btn"
          style={{ position: "absolute", top: 14, right: 14 }}
          title="Back"
          // A `title` alone does not name a button whose content is "×" - the
          // content wins, and a screen reader announces "times".
          aria-label="Back"
          onClick={onClose}
        >
          &times;
        </button>
      ) : null}

      <h2>Setup</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
        These are stored only in this browser&apos;s local storage - never written into this
        HTML file, so it&apos;s safe to keep this file in a public repo.
      </p>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Where your list lives</legend>
        <p className={styles.help}>
          SIMKL keeps being the source of truth and your list is mirrored here as you go, so
          switching to the local library later needs no migration. The local library is fully
          independent - it is backed up to a private Gist instead.
        </p>

        {(["simkl", "local"] as BackendMode[]).map((mode) => (
          <label key={mode} className={styles.radio}>
            <input
              type="radio"
              name="backendMode"
              value={mode}
              checked={draft.backendMode === mode}
              onChange={() => field("backendMode", mode)}
            />
            <span>
              {mode === "simkl" ? "SIMKL, mirrored locally" : "Local library only"}
              {mode === "simkl" && !canUseSimkl(draft) ? (
                <em className={styles.warn}> - not authorized yet</em>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>

      <label>
        TMDB API Key{" "}
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
          (get a free key)
        </a>
      </label>
      <input
        type="text"
        value={draft.tmdbApiKey}
        onChange={(e) => field("tmdbApiKey", e.target.value)}
      />

      <label>
        OMDb API Key{" "}
        <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer">
          (optional - supplies the IMDb rating)
        </a>
      </label>
      <input
        type="text"
        value={draft.omdbApiKey}
        onChange={(e) => field("omdbApiKey", e.target.value)}
      />

      <fieldset className={styles.group}>
        <legend className={styles.legend}>SIMKL</legend>
        <label>
          SIMKL Client ID{" "}
          <a href="https://simkl.com/settings/developer/" target="_blank" rel="noreferrer">
            (create an app)
          </a>
        </label>
        <input
          type="text"
          value={draft.simklClientId}
          onChange={(e) => field("simklClientId", e.target.value)}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.pill} onClick={onAuthorizeSimkl}>
            {settings.simklToken ? "Re-authorize" : "Authorize"}
          </button>
          {onImportFromSimkl ? (
            <button type="button" className={styles.pill} onClick={onImportFromSimkl}>
              Import everything into the local library
            </button>
          ) : null}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Backup</legend>
        <label>
          GitHub token{" "}
          <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
            (fine-grained, gist scope only)
          </a>
        </label>
        <input
          type="password"
          value={draft.gistToken}
          onChange={(e) => field("gistToken", e.target.value)}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.pill} onClick={onExportLibrary}>
            Export a JSON file
          </button>
          <label className={styles.fileButton}>
            Import a JSON file
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportLibrary(file);
              }}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>This is you</legend>
        <label>Name for the greeting</label>
        <input
          type="text"
          value={draft.displayName}
          onChange={(e) => field("displayName", e.target.value)}
          placeholder="Leave blank to hide the greeting"
        />
        <label>Avatar URL</label>
        <input
          type="text"
          value={draft.avatarUrl}
          onChange={(e) => field("avatarUrl", e.target.value)}
        />
      </fieldset>

      <div className="theme-toggle-wrap" style={{ marginTop: 18 }}>
        <span className="nav-icon">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </span>
        <span style={{ flex: "1 1 auto", textAlign: "left" }}>Dark Mode</span>
        <button
          type="button"
          className={settings.theme === "dark" ? "theme-toggle on" : "theme-toggle"}
          title="Toggle light/dark"
          aria-pressed={settings.theme === "dark"}
          aria-label="Toggle dark mode"
          onClick={onToggleTheme}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <button type="button" className={styles.pill} onClick={save}>
          Save
        </button>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
    </div>
  );
}
