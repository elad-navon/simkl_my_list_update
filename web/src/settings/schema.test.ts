import { describe, expect, it } from "vitest";
import { defaultSettings, isConfigured, parseSettings } from "./schema";

describe("parseSettings", () => {
  it("reads a stored blob", () => {
    const settings = parseSettings({ tmdbApiKey: "abc", theme: "light", imageMode: "banner" });
    expect(settings).toMatchObject({ tmdbApiKey: "abc", theme: "light", imageMode: "banner" });
  });

  it("falls back to the old app's keys field by field", () => {
    // Both apps share one GitHub Pages origin, so the rewrite starts already
    // holding the TMDB key rather than asking for it again.
    const settings = parseSettings({}, { tmdbApiKey: "legacy-key", theme: "light" });
    expect(settings.tmdbApiKey).toBe("legacy-key");
    expect(settings.theme).toBe("light");
  });

  it("prefers its own value over the old app's", () => {
    const settings = parseSettings({ tmdbApiKey: "new" }, { tmdbApiKey: "old" });
    expect(settings.tmdbApiKey).toBe("new");
  });

  it("trims whitespace, which a pasted key usually carries", () => {
    expect(parseSettings({ tmdbApiKey: "  abc  " }).tmdbApiKey).toBe("abc");
  });

  it("treats a blank string as absent", () => {
    expect(parseSettings({ tmdbApiKey: "   " }, { tmdbApiKey: "legacy" }).tmdbApiKey).toBe("legacy");
  });

  it("rejects a theme or image mode it does not recognise", () => {
    const settings = parseSettings({ theme: "neon", imageMode: "hologram" });
    expect(settings.theme).toBe("dark");
    expect(settings.imageMode).toBe("poster");
  });

  it("returns defaults for junk rather than throwing", () => {
    // Settings failing to parse must never be why the app will not start.
    expect(parseSettings(null)).toEqual(defaultSettings());
    expect(parseSettings("not an object")).toEqual(defaultSettings());
    expect(parseSettings(42)).toEqual(defaultSettings());
  });

  it("ignores a non-string value in a string field", () => {
    expect(parseSettings({ tmdbApiKey: 12345 }).tmdbApiKey).toBe("");
  });

  it("defaults to dark with posters and no personalization", () => {
    expect(parseSettings({})).toEqual({
      tmdbApiKey: "",
      omdbApiKey: "",
      gistToken: "",
      gistId: "",
      theme: "dark",
      imageMode: "poster",
      displayName: "",
      avatarUrl: "",
    });
  });
});

describe("isConfigured", () => {
  it("needs only the TMDB key", () => {
    expect(isConfigured(parseSettings({ tmdbApiKey: "abc" }))).toBe(true);
  });

  it("is false without it, whatever else is set", () => {
    expect(isConfigured(parseSettings({ omdbApiKey: "x", gistToken: "y" }))).toBe(false);
  });
});
