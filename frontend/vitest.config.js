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
  },
});
