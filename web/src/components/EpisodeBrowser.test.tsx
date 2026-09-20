// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EpisodeBrowser } from "./EpisodeBrowser";
import { buildSeasonView, defaultOpenSeason } from "../domain/seasonView";
import type { Episode, WatchedMap } from "../domain/types";
import type { WatchedPatch } from "../domain/watchEdits";

const NOW = Date.parse("2026-09-20T12:00:00Z");

function ep(season: number, episode: number, airDate: string | null, title: string | null = null): Episode {
  return { season, episode, airDate, title, runtime: 45 };
}

/** Season 1 fully aired, season 2 half aired with one episode still to come. */
const EPISODES: Episode[] = [
  ep(1, 1, "2026-01-01", "Pilot"),
  ep(1, 2, "2026-01-08", "Second"),
  ep(1, 3, "2026-01-15", "Finale"),
  ep(2, 1, "2026-09-01", "Return"),
  ep(2, 2, "2026-12-01", "Not yet"),
];

function setup(watched: WatchedMap = { 1: { 1: "2026-01-02T00:00:00Z" } }) {
  const view = buildSeasonView(EPISODES, watched, NOW);
  const onApply = vi.fn<(patch: WatchedPatch) => void>();
  const onClose = vi.fn();

  render(
    <EpisodeBrowser
      title="Test Show"
      view={view}
      episodes={EPISODES}
      airedEpisodes={EPISODES.filter((e) => e.airDate !== null && Date.parse(e.airDate) <= NOW)}
      watched={watched}
      initialSeason={defaultOpenSeason(view)}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { onApply, onClose, user: userEvent.setup() };
}

const row = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

describe("EpisodeBrowser", () => {
  it("opens on the first season with something left to watch", () => {
    // Season 1 has two unwatched episodes, so it is the one that needs attention.
    setup();
    expect(screen.getByRole("button", { name: /Season 1/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("S01E01")).toBeInTheDocument();
  });

  it("opens on a later season once the earlier ones are done", () => {
    setup({ 1: { 1: "a", 2: "b", 3: "c" } });
    expect(screen.getByRole("button", { name: /Season 2/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("S02E01")).toBeInTheDocument();
  });

  it("shows how much of the show is watched", () => {
    setup();
    expect(screen.getByText("1 of 5 episodes watched")).toBeInTheDocument();
  });

  it("shows a per-season count on each tab", () => {
    setup();
    expect(within(screen.getByRole("button", { name: /Season 1/ })).getByText("1/3")).toBeInTheDocument();
  });

  it("switches season on click", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Season 2/ }));
    expect(screen.getByText("S02E01")).toBeInTheDocument();
  });

  it("marks an unwatched episode", async () => {
    const { user, onApply } = setup();
    await user.click(screen.getByRole("button", { name: "Mark S01E02 as watched" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual({
      add: [expect.objectContaining({ season: 1, episode: 2 })],
      remove: [],
    });
  });

  it("un-marks a watched episode, which the old app could not do at all", async () => {
    const { user, onApply } = setup();
    await user.click(screen.getByRole("button", { name: "Un-mark S01E01 as watched" }));

    // The patch carries the bare reference, not the rendered row.
    expect(onApply.mock.calls[0]?.[0]).toEqual({ add: [], remove: [{ season: 1, episode: 1 }] });
  });

  it("marks everything up to an episode in one action", async () => {
    const { user, onApply } = setup();
    await user.click(screen.getByRole("button", { name: /Season 2/ }));
    await user.click(within(row("S02E01")).getByRole("button", { name: "Seen to here" }));

    const patch = onApply.mock.calls[0]?.[0] as WatchedPatch;
    expect(patch.add.map((a) => `${a.season}x${a.episode}`)).toEqual(["1x2", "1x3", "2x1"]);
  });

  it("un-marks from an episode onward in one action", async () => {
    // Everything is watched here, so the browser opens on the last season.
    const { user, onApply } = setup({ 1: { 1: "a", 2: "b", 3: "c" }, 2: { 1: "d" } });
    await user.click(screen.getByRole("button", { name: /Season 1/ }));
    await user.click(within(row("S01E02")).getByRole("button", { name: "Stopped here" }));

    const patch = onApply.mock.calls[0]?.[0] as WatchedPatch;
    expect(patch.remove.map((r) => `${r.season}x${r.episode}`)).toEqual(["1x2", "1x3", "2x1"]);
  });

  it("offers a one-click fix for a show that should be finished", async () => {
    // What settles the 24 completed shows reading as having episodes left.
    const { user, onApply } = setup({});
    await user.click(screen.getByRole("button", { name: /Mark everything aired as watched/ }));

    const patch = onApply.mock.calls[0]?.[0] as WatchedPatch;
    expect(patch.add.map((a) => `${a.season}x${a.episode}`)).toEqual(["1x1", "1x2", "1x3", "2x1"]);
  });

  it("does not offer to mark an episode that has not aired", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Season 2/ }));
    expect(screen.getByRole("button", { name: "Mark S02E02 as watched" })).toBeDisabled();
  });

  it("still lets a wrongly marked future episode be un-marked", async () => {
    // Otherwise a mistaken mark on an unaired episode could never be undone.
    const { user, onApply } = setup({ 2: { 2: "oops" } });
    await user.click(screen.getByRole("button", { name: /Season 2/ }));
    const toggle = screen.getByRole("button", { name: "Un-mark S02E02 as watched" });
    expect(toggle).toBeEnabled();

    await user.click(toggle);
    expect(onApply.mock.calls[0]?.[0]).toEqual({ add: [], remove: [{ season: 2, episode: 2 }] });
  });

  it("reflects watched state to assistive technology", () => {
    setup();
    expect(screen.getByRole("button", { name: "Mark S01E02 as watched" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Un-mark S01E01 as watched" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows when an episode was watched rather than when it aired", () => {
    setup();
    expect(within(row("S01E01")).getByText(/^Watched/)).toBeInTheDocument();
  });

  it("says so when an episode has no date at all", async () => {
    const view = buildSeasonView([ep(1, 1, null)], {}, NOW);
    render(
      <EpisodeBrowser
        title="Undated"
        view={view}
        episodes={[ep(1, 1, null)]}
        airedEpisodes={[]}
        watched={{}}
        initialSeason={defaultOpenSeason(view)}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No date yet")).toBeInTheDocument();
  });

  it("carries the premiere and finale badges", () => {
    setup();
    expect(screen.getByText("SERIES PREMIERE")).toBeInTheDocument();
    expect(screen.getByText("SEASON FINALE")).toBeInTheDocument();
  });

  it("closes", async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refuses every action while a write is in flight", async () => {
    const onApply = vi.fn();
    const view = buildSeasonView(EPISODES, {}, NOW);
    render(
      <EpisodeBrowser
        title="Busy"
        view={view}
        episodes={EPISODES}
        airedEpisodes={EPISODES}
        watched={{}}
        initialSeason={1}
        onApply={onApply}
        onClose={vi.fn()}
        busy
      />,
    );
    expect(screen.getByRole("button", { name: "Mark S01E01 as watched" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Mark everything aired/ })).toBeDisabled();
  });

  it("says a show has no episode data rather than rendering an empty list", () => {
    const view = buildSeasonView([], {}, NOW);
    render(
      <EpisodeBrowser
        title="Nothing"
        view={view}
        episodes={[]}
        airedEpisodes={[]}
        watched={{}}
        initialSeason={defaultOpenSeason(view)}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/No episode data for this show yet/)).toBeInTheDocument();
  });

  it("notes specials separately, since no total counts them", () => {
    const episodes = [ep(0, 1, "2026-01-01"), ep(1, 1, "2026-01-01")];
    const view = buildSeasonView(episodes, {}, NOW);
    render(
      <EpisodeBrowser
        title="With specials"
        view={view}
        episodes={episodes}
        airedEpisodes={episodes}
        watched={{}}
        initialSeason={1}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 special are listed|1 special is listed|1 special/)).toBeInTheDocument();
  });
});
