/**
 * Whether an element has been on screen yet.
 *
 * The carousel holds every show you are watching - a hundred and seven of them -
 * and shows about five at a time. Loading all hundred and seven at once is what
 * made a first load look like it had hung: each card needs two TVmaze requests,
 * TVmaze allows eighteen every ten seconds, and 214 paced requests is two minutes
 * before the last card can resolve no matter how small the payloads are.
 *
 * So a card loads when it is reachable rather than when it is mounted. The five
 * you can see resolve in seconds; the rest arrive as you scroll past them.
 *
 * Latching rather than tracking: once something has been seen it stays "seen", so
 * scrolling back does not discard a resolved card and scrolling quickly does not
 * start and abandon a dozen requests.
 */

import { useEffect, useRef, useState } from "react";

export type InViewOptions = {
  /**
   * How far outside the viewport still counts, so the next card is already
   * loading by the time it is scrolled to rather than starting then.
   */
  rootMargin?: string;
  /** Skips the observer entirely and reports true, for eagerly loaded cards. */
  skip?: boolean;
};

export function useInView<T extends Element>(
  options: InViewOptions = {},
): { ref: React.RefObject<T | null>; inView: boolean } {
  const { rootMargin = "600px", skip = false } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(skip);

  useEffect(() => {
    if (skip) {
      setInView(true);
      return;
    }
    const element = ref.current;
    if (!element) return;

    // No IntersectionObserver means no way to tell, and the honest fallback is to
    // load rather than to show an empty card forever.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, skip]);

  return { ref, inView };
}
