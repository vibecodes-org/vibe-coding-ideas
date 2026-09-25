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
    // terminal/ workspace + scripts/pty-load-test/, which ship their own
    // runners (see terminal/RUN.md) and would otherwise pollute the app suite.
    // The rest of scripts/ (e.g. scripts/lib/migration-drift.test.mjs) IS run
    // here — those tests pin `// @vitest-environment node`.
    // `.claude/worktrees/` holds Claude Code's native-worktree copies of this
    // repo (`claude --worktree`, fired by the in-app terminal for a second
    // concurrent session) — each one is a full checkout, so without this the
    // root run picks up every test file N+1 times.
    exclude: ["e2e/**", "**/node_modules/**", "terminal/**", "scripts/pty-load-test/**", "**/.claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
