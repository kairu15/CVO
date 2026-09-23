import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// RTL's act() needs this global flag — without it React warns the
// environment is "not configured to support act(...)".
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Fresh DOM between tests.
afterEach(() => {
  cleanup();
});

// jsdom lacks matchMedia — the useMediaQuery hook needs it.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

// jsdom lacks the WebGL context MapLibre needs; map components are mocked
// (or not rendered) in the tests, so no further setup is required here.
window.scrollTo = vi.fn();
