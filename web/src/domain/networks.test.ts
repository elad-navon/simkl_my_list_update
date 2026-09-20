import { describe, expect, it } from "vitest";
import {
  findLocalNetworkLogo,
  latestNetwork,
  normalizeNetworkName,
  resolveNetworkLogoUrl,
} from "./networks";

describe("latestNetwork", () => {
  it("returns the last entry, which is the current network", () => {
    const networks = [{ name: "Channel 2" }, { name: "Reshet 13" }, { name: "Keshet 12" }];
    expect(latestNetwork(networks)?.name).toBe("Keshet 12");
  });

  it("returns null for an empty or missing list", () => {
    expect(latestNetwork([])).toBeNull();
    expect(latestNetwork(null)).toBeNull();
  });
});

describe("normalizeNetworkName", () => {
  it("strips a trailing channel number", () => {
    expect(normalizeNetworkName("Reshet 13")).toBe("reshet");
    expect(normalizeNetworkName("Keshet 12")).toBe("keshet");
  });

  it("leaves an embedded number alone", () => {
    expect(normalizeNetworkName("Channel 4 News")).toBe("channel 4 news");
  });

  it("tolerates null", () => {
    expect(normalizeNetworkName(null)).toBe("");
  });
});

describe("findLocalNetworkLogo", () => {
  it("matches across languages", () => {
    expect(findLocalNetworkLogo("רשת")).toBe(findLocalNetworkLogo("Reshet"));
  });

  it("matches with or without the channel number", () => {
    expect(findLocalNetworkLogo("Keshet 12")).toBe(findLocalNetworkLogo("קשת"));
  });

  it("returns null for an unknown network", () => {
    expect(findLocalNetworkLogo("HBO")).toBeNull();
    expect(findLocalNetworkLogo("")).toBeNull();
  });
});

describe("resolveNetworkLogoUrl", () => {
  const base = "https://image.tmdb.org/t/p/w92";

  it("prefers TMDB's logo when there is one", () => {
    expect(resolveNetworkLogoUrl("HBO", "/abc.png", base)).toBe(`${base}/abc.png`);
  });

  it("falls back to the local override when TMDB has none", () => {
    expect(resolveNetworkLogoUrl("Reshet 13", null, base)).toBe("networks/reshet.png");
  });

  it("returns null when neither source has a logo", () => {
    expect(resolveNetworkLogoUrl("Some Network", null, base)).toBeNull();
  });
});
