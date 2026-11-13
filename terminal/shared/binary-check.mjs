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

/** Windows' default executable extensions, used when PATHEXT is unset. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * Windows only: the file names to try for a bare name, in PATHEXT order but
 * with `.exe` first, so a native `claude.exe` wins over an npm `claude.cmd`
 * shim sitting in the same folder.
 * @param {string} name @param {string | undefined} pathext
 */
function winCandidates(name, pathext) {
  const exts = String(pathext || DEFAULT_PATHEXT)
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.startsWith("."));
  const lower = name.toLowerCase();
  // A name that already ends in a known extension is tried exactly as given.
  if (exts.some((e) => lower.endsWith(e))) return [name];
  return [".exe", ...exts.filter((e) => e !== ".exe")].map((e) => name + e);
}

/** True when `name` carries a directory part (on Windows: also `C:\x`, `a\b`). */
function hasDirPart(name, win) {
  if (name.includes("/")) return true;
  return win && (name.includes("\\") || /^[A-Za-z]:/.test(name));
}

function isRunnableFile(candidate, win) {
  const stat = fs.statSync(candidate);
  if (!stat.isFile()) return false;
  // The executable bit means nothing on Windows; PATHEXT decides there.
  if (!win) fs.accessSync(candidate, fs.constants.X_OK);
  return true;
}

/**
 * Resolve whether `name` exists as an executable FILE somewhere on
 * `pathEnv` (a PATH string in the platform's own shape: `:`-separated on
 * macOS/Linux, `;`-separated on Windows). Directories are checked in order;
 * the first match wins (mirrors shell PATH resolution). A relative/empty PATH
 * entry (`.`, ``) is skipped — the same posture a login shell's PATH normally
 * already has.
 *
 * On Windows a bare name is tried with each PATHEXT extension (`.exe` first),
 * a name with a drive letter or backslash counts as "has a path", and the
 * executable-bit check is skipped.
 *
 * @param {unknown} name
 * @param {unknown} pathEnv
 * @param {{ platform?: string, pathext?: string }} [opts]
 * @returns {string | null} the absolute path to the resolved binary, or null
 */
export function resolveBinaryOnPath(name, pathEnv, opts = {}) {
  if (typeof name !== "string" || name.length === 0) return null;
  const win = (opts.platform || process.platform) === "win32";
  const names = win ? winCandidates(name, opts.pathext ?? process.env.PATHEXT) : [name];
  // A name containing a path separator (absolute like `/usr/local/bin/node`,
  // or relative like `./foo`; on Windows also `C:\x` or `a\b`) is never
  // subject to a PATH search — mirrors every shell's own rule (execvp only
  // searches PATH for a bare name). This matters here because the bridge's
  // own explicit `--cmd`/`BRIDGE_CMD` override (dev/test convenience — see
  // resume-cmd.js's branch 1) can name an absolute path, e.g.
  // `process.execPath` in the test harness.
  if (hasDirPart(name, win)) {
    for (const n of names) {
      try {
        if (isRunnableFile(n, win)) return n;
      } catch {
        /* try the next extension */
      }
    }
    return null;
  }
  if (typeof pathEnv !== "string" || pathEnv.length === 0) return null;
  for (const rawDir of pathEnv.split(win ? ";" : ":")) {
    const dir = win ? rawDir.replace(/^"(.*)"$/, "$1") : rawDir;
    if (!dir || dir === ".") continue;
    for (const n of names) {
      const candidate = path.join(dir, n);
      try {
        if (isRunnableFile(candidate, win)) return candidate;
      } catch {
        continue; // not present here, or not executable — try the next one
      }
    }
  }
  return null;
}

/**
 * The plain yes/no most callers need.
 * @param {unknown} name
 * @param {unknown} pathEnv
 * @param {{ platform?: string, pathext?: string }} [opts]
 * @returns {boolean}
 */
export function isBinaryInstalled(name, pathEnv, opts) {
  return resolveBinaryOnPath(name, pathEnv, opts) !== null;
}
