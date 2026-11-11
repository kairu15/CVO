import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Unit test config — separate from vite.config.js so the dev-server settings
 * (ports, tunnel proxy) stay out of the test run. `npm test` runs this file.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    css: false,
    restoreMocks: true,

    // jsdom environments are created once per worker thread instead of once
    // per file — full runs were spending about half their time rebuilding
    // jsdom per test file, and the contention made individual tests
    // intermittently time out (the 2-test flake seen on large runs).
    // vmThreads keeps per-file isolation (fresh VM context per file), it
    // just reuses the thread and its environment across files.
    pool: "vmThreads",

    // The map-bearing pages now pull a heavier module graph into several
    // test files (the shared barangay map + pickers), which nudged more
    // tests near the 5s default under full-run worker contention — the
    // failures moved between files run to run. A 15s ceiling keeps a
    // genuinely hung test failing, while the contention flake stops.
    testTimeout: 15000,
  },
});
