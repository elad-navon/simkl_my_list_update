import { describe, expect, it } from "vitest";
import { canUseSimkl, defaultSettings, isConfigured, parseSettings } from "./schema";

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

  it("defaults to dark with posters, local mode and no personalization", () => {
    expect(parseSettings({})).toEqual({
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
    });
  });
});

describe("backendMode", () => {
  it("keeps an explicit choice", () => {
    expect(parseSettings({ backendMode: "local", simklToken: "tok" }).backendMode).toBe("local");
    expect(parseSettings({ backendMode: "simkl" }).backendMode).toBe("simkl");
  });

  it("stays on SIMKL when the browser already holds a token", () => {
    // Defaulting a working setup to `local` would silently show an empty list.
    expect(parseSettings({}, { simklToken: "tok" }).backendMode).toBe("simkl");
  });

  it("is local when there is no token and nothing was chosen", () => {
    expect(parseSettings({}).backendMode).toBe("local");
  });

  it("rejects a mode it does not recognise", () => {
    expect(parseSettings({ backendMode: "trakt" }).backendMode).toBe("local");
  });

  it("adopts the old app's SIMKL credentials so no re-authorizing is needed", () => {
    const settings = parseSettings({}, { simklClientId: "cid", simklToken: "tok" });
    expect(settings).toMatchObject({ simklClientId: "cid", simklToken: "tok" });
  });
});

describe("canUseSimkl", () => {
  it("needs both the client id and the token", () => {
    expect(canUseSimkl(parseSettings({ simklClientId: "c", simklToken: "t" }))).toBe(true);
    expect(canUseSimkl(parseSettings({ simklClientId: "c" }))).toBe(false);
    expect(canUseSimkl(parseSettings({ simklToken: "t" }))).toBe(false);
  });

  it("is independent of the selected mode, so a 401 can be reported honestly", () => {
    // Being on SIMKL and needing to authorize again is a real state; it must not
    // read as though the setting had flipped.
    const settings = parseSettings({ backendMode: "simkl", simklClientId: "c" });
    expect(settings.backendMode).toBe("simkl");
    expect(canUseSimkl(settings)).toBe(false);
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
