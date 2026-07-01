import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: false,
    // Root vitest runs the app's `src/` tests only. Exclude e2e, all vendored
    // node_modules (incl. nested ones under terminal/* and scripts/*), and the
    // terminal/ workspace + scripts/, which ship their own `node --test` runners
    // (see terminal/RUN.md) and would otherwise pollute the app suite.
    exclude: ["e2e/**", "**/node_modules/**", "terminal/**", "scripts/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
