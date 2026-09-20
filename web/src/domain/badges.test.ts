import { describe, expect, it } from "vitest";
import { episodeBadge } from "./badges";

const seasonMax = new Map([
  [1, 8],
  [2, 10],
]);

describe("episodeBadge", () => {
  it("marks S01E01 as the series premiere", () => {
    expect(episodeBadge({ season: 1, episode: 1 }, seasonMax)).toBe("SERIES PREMIERE");
  });

  it("marks episode 1 of any later season as a season premiere", () => {
    expect(episodeBadge({ season: 2, episode: 1 }, seasonMax)).toBe("SEASON PREMIERE");
  });

  it("marks the season's highest known episode as the finale", () => {
    expect(episodeBadge({ season: 1, episode: 8 }, seasonMax)).toBe("SEASON FINALE");
  });

  it("leaves a mid-season episode unbadged", () => {
    expect(episodeBadge({ season: 1, episode: 4 }, seasonMax)).toBeNull();
  });

  it("gives no finale badge for a season the source has not finished publishing", () => {
    expect(episodeBadge({ season: 3, episode: 6 }, seasonMax)).toBeNull();
  });
});
