/**
 * The horizontal card row, with the two ways of moving it.
 *
 * `.carousel-track` hides its scrollbar - `scrollbar-width: none` plus a
 * `::-webkit-scrollbar` rule (style.css:152-155) - so something has to replace it.
 * The old app had two things: arrow buttons either side (app.js:3193-3197) and
 * drag-to-scroll (app.js:3523-3560). Porting the CSS without them left a row that
 * could not be moved at all, which is exactly what happened.
 *
 * Both are here. The arrows hide themselves at each end rather than sitting there
 * dead, which is what `.carousel-arrow.is-hidden` is for, and a drag suppresses
 * the click that would otherwise follow it - dragging across a card should not
 * open that card.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Carousel.module.css";


/** Roughly a card and a half, unchanged from app.js:3194. */
const SCROLL_STEP = 420;

/** How far the pointer has to travel before it counts as a drag and not a click. */
const DRAG_THRESHOLD = 4;

const ArrowRight = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ArrowLeft = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export type CarouselProps = {
  children: React.ReactNode;
  /** Labels the row for anyone navigating by landmark. */
  label: string;
};

export function Carousel({ children, label }: CarouselProps): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [dragging, setDragging] = useState(false);

  /** Which arrows are worth showing. Recomputed on scroll and on resize. */
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const maxScroll = track.scrollWidth - track.clientWidth;
    const fits = maxScroll <= 1;
    setAtStart(fits || track.scrollLeft <= 1);
    setAtEnd(fits || track.scrollLeft >= maxScroll - 1);
  }, []);

  useEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track) return;

    // Also on resize, and as cards resolve: a row that did not overflow with six
    // skeletons does overflow once a hundred real cards have arrived.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(track);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  const scrollBy = (delta: number) => {
    trackRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  // --- drag to scroll -------------------------------------------------------

  const drag = useRef<{ startX: number; startScroll: number; moved: boolean } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Left button only, and never on a real control - a drag that starts on the
    // "mark watched" button should be that button's, not the row's.
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, select, input")) return;

    const track = trackRef.current;
    if (!track) return;

    drag.current = { startX: event.clientX, startScroll: track.scrollLeft, moved: false };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const track = trackRef.current;
    if (!state || !track) return;

    const dx = event.clientX - state.startX;
    if (Math.abs(dx) > DRAG_THRESHOLD) state.moved = true;
    track.scrollLeft = state.startScroll - dx;
  };

  const endDrag = () => {
    if (!drag.current) return;
    setDragging(false);
    // The flag has to outlive the pointer release, because the click that
    // follows a drag arrives after it - see `onClickCapture`.
    const moved = drag.current.moved;
    drag.current = null;
    if (moved) dragSuppressed.current = true;
  };

  const dragSuppressed = useRef(false);

  /**
   * Swallows the click that follows a drag.
   *
   * In the capture phase, so it is stopped before it reaches the card underneath.
   * Dragging the row past a card should move the row, not open the card.
   */
  const onClickCapture = (event: React.MouseEvent) => {
    if (!dragSuppressed.current) return;
    dragSuppressed.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  return (
    <div className="carousel-wrap">
      <button
        type="button"
        className={`carousel-arrow left ${styles.arrow}${atStart ? " is-hidden" : ""}`}
        title="Scroll left"
        aria-label="Scroll left"
        onClick={() => scrollBy(-SCROLL_STEP)}
      >
        {ArrowLeft}
      </button>

      <div
        ref={trackRef}
        className={`carousel-track${dragging ? " dragging" : ""}`}
        // A scrollable region needs to be reachable and labelled, or the arrows
        // are the only way through it and there is no way to page it by keyboard.
        role="group"
        aria-label={label}
        tabIndex={0}
        onScroll={measure}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>

      <button
        type="button"
        className={`carousel-arrow ${styles.arrow}${atEnd ? " is-hidden" : ""}`}
        title="Scroll right"
        aria-label="Scroll right"
        onClick={() => scrollBy(SCROLL_STEP)}
      >
        {ArrowRight}
      </button>

    </div>
  );
}
