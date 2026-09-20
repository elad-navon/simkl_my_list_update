/**
 * Test setup, applied to every test file.
 *
 * The suite runs in two environments: `node` by default, because most of this
 * codebase is pure functions and a DOM would only slow them down, and `jsdom`
 * for component files, which opt in with a `@vitest-environment jsdom` docblock.
 *
 * Both pieces here need a DOM, so both are registered only when there is one -
 * loading them in a node test would fail every pure test for no benefit.
 */

import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");

  // Testing Library only registers this itself when Vitest runs with `globals`,
  // which this project does not - tests import what they use. Without it, every
  // render accumulates in the same document and the next query finds several of
  // everything.
  afterEach(() => {
    cleanup();
  });

  // jsdom implements no layout, so it has no scrollIntoView. Stubbed rather than
  // guarded at every call site: keeping a highlighted row visible is real
  // behaviour in a browser, and a component should not have to defend against an
  // environment that has no scrolling.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      /* no layout to scroll */
    };
  }
}
