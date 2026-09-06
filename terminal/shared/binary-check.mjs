// Shared "is this binary actually on PATH?" check (Codex support, docs/
// codex-terminal-requirements.md FR-3) — ONE implementation used by:
//   - the bridge (terminal/bridge/src/index.js) — pre-flight, before spawning
//     the chosen agent's PTY (browser-terminal path).
//   - the helper (terminal/helper/agent-availability.mjs) — the standing
//     "is codex/claude installed?" signal it reports on its control
//     connection (FR-3's helper-side half), and the desktop Terminal-window
//     pre-flight before opening a window (FR-13).
//
// Pure, synchronous, dependency-free (only node:fs/node:path) — no shelling
// out to `which`/`command -v` (those inherit the CALLER's PATH semantics,
// which is exactly the ambiguity this module exists to avoid: both callers
// already resolve their OWN PATH string explicitly — see resolveSpawnEnv() in
// the bridge and spawn-path.mjs's resolveLoginShellPath for the helper — and
// hand it here as a plain string to check against). Never throws: a
// permission error probing one directory is treated as "not found there",
// not a crash — same defensive posture as every other shared module here.

import fs from "node:fs";
import path from "node:path";

/**
 * Resolve whether `name` exists as an executable FILE somewhere on
 * `pathEnv` (a colon-separated PATH string, e.g. `process.env.PATH` shape).
 * Directories are checked in order; the first match wins (mirrors shell PATH
 * resolution). A relative/empty PATH entry (`.`, ``) is skipped — the same
 * posture a login shell's PATH normally already has.
 *
 * @param {unknown} name
 * @param {unknown} pathEnv
 * @returns {string | null} the absolute path to the resolved binary, or null
 */
export function resolveBinaryOnPath(name, pathEnv) {
  if (typeof name !== "string" || name.length === 0) return null;
  // A name containing a "/" (absolute like `/usr/local/bin/node`, or
  // relative like `./foo`) is never subject to a PATH search — mirrors
  // every shell's own rule (execvp only searches PATH for a bare name).
  // This matters here because the bridge's own explicit `--cmd`/`BRIDGE_CMD`
  // override (dev/test convenience — see resume-cmd.js's branch 1) can name
  // an absolute path, e.g. `process.execPath` in the test harness.
  if (name.includes("/")) {
    try {
      const stat = fs.statSync(name);
      if (!stat.isFile()) return null;
      fs.accessSync(name, fs.constants.X_OK);
      return name;
    } catch {
      return null;
    }
  }
  if (typeof pathEnv !== "string" || pathEnv.length === 0) return null;
  for (const dir of pathEnv.split(":")) {
    if (!dir || dir === ".") continue;
    const candidate = path.join(dir, name);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue; // not present here, or not executable — try the next dir
    }
  }
  return null;
}

/**
 * The plain yes/no most callers need.
 * @param {unknown} name
 * @param {unknown} pathEnv
 * @returns {boolean}
 */
export function isBinaryInstalled(name, pathEnv) {
  return resolveBinaryOnPath(name, pathEnv) !== null;
}
