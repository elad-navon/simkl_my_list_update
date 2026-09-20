// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchModal } from "./SearchModal";
import type { MatchedSearchResult } from "../domain/search";
import type { ShowStatus } from "../domain/types";

function result(over: Partial<MatchedSearchResult> = {}): MatchedSearchResult {
  return {
    title: "Show One",
    year: "2020",
    posterUrl: null,
    ids: { tmdb: 1 },
    source: "tmdb",
    libraryStatus: null,
    libraryKey: null,
    ...over,
  };
}

function setup(over: Partial<React.ComponentProps<typeof SearchModal>> = {}) {
  const onAdd = vi.fn<(r: MatchedSearchResult, s: ShowStatus) => void>();
  const onClose = vi.fn();
  const onQueryChange = vi.fn();

  render(
    <SearchModal
      query="show"
      onQueryChange={onQueryChange}
      results={[result(), result({ title: "Show Two", ids: { tmdb: 2 } })]}
      searching={false}
      error={null}
      empty={false}
      busyKey={null}
      onAdd={onAdd}
      onClose={onClose}
      {...over}
    />,
  );
  return { onAdd, onClose, onQueryChange, user: userEvent.setup() };
}

const row = (title: string) => screen.getByText(title).closest("li") as HTMLElement;

describe("SearchModal", () => {
  it("focuses the input so typing works immediately", () => {
    setup();
    expect(screen.getByRole("searchbox", { name: /Search for a show/ })).toHaveFocus();
  });

  it("reports typing to the caller, which owns the query", async () => {
    const { onQueryChange, user } = setup({ query: "" });
    await user.type(screen.getByRole("searchbox"), "b");
    expect(onQueryChange).toHaveBeenCalledWith("b");
  });

  it("lists the results with the first one highlighted", () => {
    setup();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
  });

  it("is a list rather than a listbox, since every row holds a menu", () => {
    // An `option` may not contain interactive content, and it would also collide
    // with the status menu's own options in the accessibility tree.
    setup();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves the highlight with the arrow keys", async () => {
    // The old version tracked this in a module variable and moved a class by
    // hand, so assistive technology never saw it at all.
    const { user } = setup();
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "true");

    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("aria-current", "true");
  });

  it("wraps around at both ends", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "true");
  });

  it("follows the mouse with the same highlight", async () => {
    const { user } = setup();
    await user.hover(row("Show Two"));
    expect(screen.getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "true");
  });

  it("adds the highlighted result on Enter", async () => {
    const { onAdd, user } = setup();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0].title).toBe("Show Two");
    expect(onAdd.mock.calls[0]?.[1]).toBe("plantowatch");
  });

  it("does not re-add on Enter something already on the list", async () => {
    // It would otherwise silently move a show to a status nobody picked.
    const { onAdd, user } = setup({
      results: [result({ libraryStatus: "completed", libraryKey: "tmdb:1" })],
    });
    await user.keyboard("{Enter}");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("says which status a show already has", () => {
    // Five network requests per query used to be the only way to know this.
    setup({ results: [result({ libraryStatus: "hold", libraryKey: "tmdb:1" })] });
    expect(screen.getByText(/already On Hold/)).toBeInTheDocument();
  });

  it("offers a change rather than an add for a show already on the list", () => {
    setup({ results: [result({ libraryStatus: "hold", libraryKey: "tmdb:1" })] });
    const select = screen.getByRole("combobox", { name: /Change the status of Show One/ });
    expect(select).toHaveValue("hold");
  });

  it("adds at the status picked from the menu", async () => {
    const { onAdd, user } = setup();
    await user.selectOptions(within(row("Show One")).getByRole("combobox"), "watching");

    expect(onAdd.mock.calls[0]?.[1]).toBe("watching");
  });

  it("shows a placeholder instead of a broken image when there is no poster", () => {
    setup({ results: [result({ title: "Zebra", posterUrl: null })] });
    expect(within(row("Zebra")).getByText("Z")).toBeInTheDocument();
  });

  it("says it is searching, and says when there was nothing", () => {
    setup({ searching: true, results: [] });
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("reports no results only once a search has finished", () => {
    setup({ empty: true, searching: false, results: [] });
    expect(screen.getByText("No results.")).toBeInTheDocument();
  });

  it("does not claim no results while still searching", () => {
    setup({ empty: true, searching: true, results: [] });
    expect(screen.queryByText("No results.")).not.toBeInTheDocument();
  });

  it("shows an error", () => {
    setup({ error: "Cannot reach TMDB" });
    expect(screen.getByText("Cannot reach TMDB")).toBeInTheDocument();
  });

  it("closes on Escape and on the close button", async () => {
    const { onClose, user } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("resets the highlight when the results change", async () => {
    // Leaving it where it was would mean Enter adding whatever now sits there.
    const { user } = setup();
    await user.keyboard("{ArrowDown}");

    render(
      <SearchModal
        query="other"
        onQueryChange={vi.fn()}
        results={[result({ title: "Fresh", ids: { tmdb: 9 } })]}
        searching={false}
        error={null}
        empty={false}
        busyKey={null}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(row("Fresh")).toHaveAttribute("aria-current", "true");
  });
});
