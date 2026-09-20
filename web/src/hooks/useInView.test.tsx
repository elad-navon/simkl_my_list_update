// @vitest-environment jsdom
/**
 * The gating that decides whether a card loads at all.
 *
 * Worth its own test because jsdom has no IntersectionObserver, so the hook's
 * fallback - load rather than show an empty card forever - hides the real
 * behaviour from every other test in the suite. These stub one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useInView } from "./useInView";

type Observed = {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  elements: Element[];
  disconnected: boolean;
};

const observers: Observed[] = [];

/** An observer that never fires until a test tells it to. */
function stubObserver() {
  class Stub implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin: string;
    readonly thresholds: readonly number[] = [];
    private readonly record: Observed;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = String(options?.rootMargin ?? "");
      this.record = { callback, options, elements: [], disconnected: false };
      observers.push(this.record);
    }
    observe(element: Element) {
      this.record.elements.push(element);
    }
    unobserve() {}
    disconnect() {
      this.record.disconnected = true;
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", Stub);
}

/**
 * Fires the observer.
 *
 * Inside `act`, because a real IntersectionObserver callback sets state from
 * outside React's own event handling and the update would otherwise not be
 * flushed before the assertion reads the DOM.
 */
function intersect(index = 0) {
  const record = observers[index];
  if (!record) throw new Error("no observer was created");
  act(() => {
    record.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

function Probe({ skip }: { skip?: boolean }): React.JSX.Element {
  const { ref, inView } = useInView<HTMLDivElement>(skip === undefined ? {} : { skip });
  return (
    <div ref={ref} data-testid="probe">
      {inView ? "loading" : "waiting"}
    </div>
  );
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

describe("useInView", () => {
  it("waits until the element is reached", () => {
    stubObserver();
    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("waiting");
    intersect();
    expect(screen.getByTestId("probe")).toHaveTextContent("loading");
  });

  it("latches, so scrolling back does not discard what loaded", () => {
    // Also what stops a fast scroll starting and abandoning a dozen requests.
    stubObserver();
    render(<Probe />);
    intersect();

    expect(observers[0]?.disconnected).toBe(true);
    expect(screen.getByTestId("probe")).toHaveTextContent("loading");
  });

  it("looks ahead of the viewport, so the next card is already loading", () => {
    stubObserver();
    render(<Probe />);
    expect(observers[0]?.options?.rootMargin).toBe("600px");
  });

  it("skips the observer entirely when told to", () => {
    // The handful of cards that load without waiting, so the first screen is real.
    stubObserver();
    render(<Probe skip />);

    expect(screen.getByTestId("probe")).toHaveTextContent("loading");
    expect(observers).toHaveLength(0);
  });

  it("loads rather than waiting forever where there is no observer", () => {
    // No IntersectionObserver means no way to tell, and an empty card that never
    // fills is the worse failure.
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("loading");
  });

  it("observes the element it was given", () => {
    stubObserver();
    render(<Probe />);
    expect(observers[0]?.elements[0]).toBe(screen.getByTestId("probe"));
  });
});
