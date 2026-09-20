/**
 * The top bar. Ported from index.html:18-58.
 *
 * Structure and class names are kept exactly, because `style.css` came across
 * whole and its rules target these names - including the one that pins `--text`
 * and `--muted` locally so the bar stays dark in both themes without a
 * `body.light-theme` override per rule (style.css:24-34).
 *
 * The greeting and the avatar were hardcoded into the markup, which meant anyone
 * else running this copy was greeted as Elad. They come from settings now, and
 * the block is simply absent when no name is set.
 */

import { useEffect, useState } from "react";
import type { ImageMode } from "../settings/schema";

export type TopBarProps = {
  imageMode: ImageMode;
  onToggleImageMode: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  settingsActive: boolean;
  displayName: string;
  avatarUrl: string;
};

/**
 * The clock, ticking once a second.
 *
 * Its own component so the rest of the bar does not re-render with it - the old
 * page updated two text nodes directly, and a naive port would have re-rendered
 * the whole header sixty times a minute.
 */
function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="topbar-clock" id="topbarClock">
      {/* The date shrinks and ellipsizes first on a narrow screen; the time is
          never the part that gets clipped (style.css:47-56). */}
      <span id="topbarDateText">
        {now.toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      </span>
      <span className="topbar-clock-sep">&bull;</span>
      <span id="topbarClockText">{now.toLocaleTimeString(undefined, { hour12: false })}</span>
    </div>
  );
}

const IconGrid = (
  <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

const IconSearch = (
  <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const IconSettings = (
  <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export function TopBar({
  imageMode,
  onToggleImageMode,
  onOpenSearch,
  onOpenSettings,
  settingsActive,
  displayName,
  avatarUrl,
}: TopBarProps): React.JSX.Element {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="navbar-logo">
          <span className="logo-icon">
            <svg viewBox="0 0 24 24" width="50" height="50" aria-hidden="true">
              <polygon points="4,3 4,21 21,12" fill="var(--gold)" />
            </svg>
          </span>
          <span className="logo-text">
            <span className="logo-tv">TV</span>
            <span className="logo-accent">SERIES</span>
          </span>
        </div>
        <span className="topbar-slogan-sep">&bull;</span>
        <span className="topbar-slogan">Never Lose Track</span>
      </div>

      <Clock />

      <div className="topbar-controls">
        <nav className="navbar-nav">
          <button type="button" className="nav-item" onClick={onToggleImageMode}>
            <span className="nav-icon">{IconGrid}</span>
            {/* Labels the destination, not the current state - unchanged from
                the old bar, which read "Switch to Banners" while on posters. */}
            Switch to {imageMode === "poster" ? "Banners" : "Posters"}
          </button>
          <button type="button" className="nav-item" onClick={onOpenSearch}>
            <span className="nav-icon">{IconSearch}</span>
            Search Show
          </button>
          <button
            type="button"
            className={settingsActive ? "nav-item active" : "nav-item"}
            onClick={onOpenSettings}
          >
            <span className="nav-icon">{IconSettings}</span>
            Settings
          </button>

          {displayName ? (
            <div className="profile-greeting-inline">
              <span className="profile-greeting-hi">Hi {displayName} &#128075;</span>
              {avatarUrl ? <img className="profile-pic-small" src={avatarUrl} alt="" /> : null}
            </div>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
