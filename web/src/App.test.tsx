// @vitest-environment jsdom
/**
 * A smoke test for the whole shell.
 *
 * Typechecking cannot catch a provider in the wrong order, a hook called outside
 * its context, or a store read before hydration - all of which show up as a blank
 * page. This renders the real App against real stores and asserts it comes up.
 *
 * jsdom has localStorage but no IndexedDB, so the library store's read fails
 * here. That is deliberately not mocked: an environment where storage is
 * unavailable is a real one - private browsing modes behave the same way - and
 * the app has to come up and say so rather than show nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { SETTINGS_KEY } from "./settings/schema";
import { useSettings } from "./settings/store";

function configure(settings: Record<string, unknown>) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  // The store read settings at module load, so it has to be told to look again.
  useSettings.setState({ settings: useSettings.getState().settings });
  useSettings.getState().update(settings as never);
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  useSettings.getState().reset();
  document.body.className = "";
});

describe("App", () => {
  it("renders the setup screen when there is no TMDB key", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Setup" })).toBeInTheDocument();
    // The line that makes a public repo safe is part of the screen, not a comment.
    expect(screen.getByText(/never written into this/i)).toBeInTheDocument();
  });

  it("shows the source switch, defaulting to the local library", () => {
    render(<App />);

    const local = screen.getByRole("radio", { name: /Local library only/ });
    expect(local).toBeChecked();
    expect(screen.getByRole("radio", { name: /SIMKL, mirrored locally/ })).toBeInTheDocument();
  });

  it("says SIMKL mode is not authorized rather than silently offering it", () => {
    render(<App />);
    expect(screen.getByText(/not authorized yet/)).toBeInTheDocument();
  });

  it("refuses to save without a TMDB key, and says why", async () => {
    render(<App />);
    screen.getByRole("button", { name: "Save" }).click();

    await waitFor(() =>
      expect(screen.getByText(/TMDB key is required/)).toBeInTheDocument(),
    );
  });

  it("renders the dashboard once a TMDB key is set", async () => {
    configure({ tmdbApiKey: "key", backendMode: "local" });
    render(<App />);

    expect(screen.getByRole("heading", { name: "Recently Watched" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan to Watch" })).toBeInTheDocument();
  });

  it("renders the top bar with the clock and the nav", () => {
    configure({ tmdbApiKey: "key" });
    render(<App />);

    expect(screen.getByText("Never Lose Track")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Switch to Banners/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Settings/ })).toBeInTheDocument();
  });

  it("hides the greeting when no name is set, instead of greeting Elad", () => {
    // The old markup had the name baked in (index.html:47-50).
    configure({ tmdbApiKey: "key" });
    render(<App />);
    expect(screen.queryByText(/^Hi /)).not.toBeInTheDocument();
  });

  it("greets whoever set a name", () => {
    configure({ tmdbApiKey: "key", displayName: "Sam" });
    render(<App />);
    expect(screen.getByText(/Hi Sam/)).toBeInTheDocument();
  });

  it("labels the image toggle by its destination, not its state", () => {
    configure({ tmdbApiKey: "key", imageMode: "banner" });
    render(<App />);
    expect(screen.getByRole("button", { name: /Switch to Posters/ })).toBeInTheDocument();
  });

  it("opens settings from the dashboard and comes back", async () => {
    configure({ tmdbApiKey: "key" });
    render(<App />);

    screen.getByRole("button", { name: /Settings/ }).click();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Setup" })).toBeInTheDocument());

    screen.getByRole("button", { name: "Back" }).click();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Recently Watched" })).toBeInTheDocument(),
    );
  });

  it("applies the light theme to the document rather than flashing the wrong one", () => {
    configure({ tmdbApiKey: "key", theme: "light" });
    render(<App />);
    expect(document.body.classList.contains("light-theme")).toBe(true);
  });

  it("comes up with an empty library rather than an empty page", async () => {
    // No IndexedDB here, so the store's read fails. The app still has to render.
    configure({ tmdbApiKey: "key" });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Nothing on your watching list yet/)).toBeInTheDocument(),
    );
  });
});
