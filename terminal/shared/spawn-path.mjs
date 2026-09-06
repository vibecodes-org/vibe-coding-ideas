// Shared "which PATH would a GUI-launched agent binary see?" resolution.
//
// GUI-launched processes (LaunchServices — a browser click, or `open`) inherit
// macOS's MINIMAL system PATH (/usr/bin:/bin:…), not the user's shell PATH, so
// `claude`/`codex` (typically in ~/.local/bin or /opt/homebrew/bin) resolve to
// "command not found" unless something captures the user's real PATH first.
//
// This is the SAME algorithm terminal/bridge/src/index.js's own
// `resolveSpawnEnv()` already uses for the browser-terminal path — duplicated
// here (not imported) for the helper's two OTHER call sites that need the
// identical notion of "installed"/"on PATH" without pulling in the whole
// bridge module:
//   - terminal/helper/agent-availability.mjs — the standing "is codex/claude
//     installed?" signal the helper reports on its control connection
//     (FR-3's helper-side half).
//   - terminal/helper/open-terminal.mjs — the desktop Terminal-window launch
//     script, which needs the SAME fallback dirs appended to PATH inside the
//     script itself (FR-11: "reuse/extract the bridge's resolveSpawnEnv()
//     fallbacks rather than duplicating them" — the fallback LIST is shared
//     from here; the login-shell-capture algorithm is the same shape as the
//     bridge's for the same reason deep-link.ts/.mjs duplicate their own
//     logic across the TS/JS boundary elsewhere in this codebase).

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

/** The well-known bin dirs the bridge already falls back to. */
export function fallbackBinDirs() {
  return [
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

/**
 * Capture the user's LOGIN shell PATH (best effort, bounded, never throws)
 * and append the fallback dirs — mirrors resolveSpawnEnv()'s algorithm
 * exactly. Windows has no such PATH-inheritance problem (different
 * semantics), so this is a no-op passthrough there.
 *
 * @param {{ shell?: string, env?: NodeJS.ProcessEnv, run?: typeof execFileSync, platform?: string }} [opts]
 * @returns {string}
 */
export function resolveLoginShellPath(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  if (platform === "win32") return env.PATH || "";
  const run = opts.run || execFileSync;
  const shell = opts.shell || env.SHELL || "/bin/zsh";
  let shellPath = "";
  try {
    // -ilc = interactive login shell -> sources .zprofile AND .zshrc, wherever
    // the user set PATH. Markers isolate $PATH from any rc-file banner noise.
    const out = run(shell, ["-ilc", 'printf "__PATH__%s__END__" "$PATH"'], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = out.match(/__PATH__([\s\S]*)__END__/);
    if (m && m[1].trim()) shellPath = m[1].trim();
  } catch {
    /* fall through to inherited + fallbacks */
  }
  const parts = (shellPath || env.PATH || "").split(":").filter(Boolean);
  for (const extra of fallbackBinDirs()) {
    if (!parts.includes(extra)) parts.push(extra);
  }
  return parts.join(":");
}

/**
 * The shell snippet a launch script embeds to widen ITS OWN PATH with the
 * same fallback dirs — used by open-terminal.mjs so the Terminal.app window's
 * shell (which may not source rc files identically to `resolveLoginShellPath`'s
 * `-ilc` probe) still finds `codex` in the well-known places. Appends, never
 * replaces — the window's own login-shell PATH (if any) is tried first.
 * @returns {string}
 */
export function pathFallbackShellSnippet() {
  const dirs = fallbackBinDirs().map((d) => `"${d}"`).join(":");
  return `export PATH="$PATH:${dirs}"`;
}
