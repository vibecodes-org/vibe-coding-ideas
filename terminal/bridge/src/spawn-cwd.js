// Which folder should the agent's PTY start in? (card 3ae71b07)
//
// Before this, the bridge handed `launched?.cwd || --cwd || BRIDGE_CWD ||
// process.cwd()` straight to `pty.spawn` with no checks. The packaged helper
// forks the bridge without a cwd, so it inherits the helper's own — `/` — and
// a launch link with no folder started Claude Code at the root of the disk.
// That is the mechanism behind the 29 Aug 2026 incident (see CLAUDE.md, "The
// browser launch link never drops the folder"): the agent, told to "cd in
// first", wandered into and RECORDED another project's checkout as the board's
// folder. A folder that was gone (or was a file) was worse: the agent exited
// on the spot and the session closed after 0 bytes, with no message at all.
//
// The rule: use the requested folder only if it exists, is a directory, and
// isn't the root of the disk. Otherwise start in the user's home folder — a
// neutral place `record_project_path` refuses to record, and the one the
// "new project" (`mkdir -p ~/projects/<slug>`) and repo-backed (`git clone …
// ~/projects/<name>`) prompts already work from. The `reason` lets the caller
// tell the user when a folder they asked for couldn't be used
// (`spawnCwdFallbackNotice`).
//
// Pure over injectable `stat` / `realpath` so it's unit-testable without a
// filesystem; the real caller passes `fs.statSync` / `fs.realpathSync`.

import path from "node:path";

/** @typedef {"ok" | "none" | "missing" | "not-a-dir" | "root" | "unusable"} SpawnCwdReason */

/**
 * @param {{
 *   requested?: string | null,
 *   home: string,
 *   base?: string,
 *   stat: (p: string) => { isDirectory: () => boolean },
 *   realpath?: (p: string) => string,
 * }} opts
 *   `requested` is the folder the launch asked for (deep link / --cwd /
 *   BRIDGE_CWD), if any. A relative one is resolved against `base` (the
 *   bridge's own cwd — a dev convenience; the app always sends absolute
 *   paths). `stat` follows symlinks (like `fs.statSync`), so a symlink to a
 *   directory is honoured; `realpath`, when given, catches a symlink that
 *   points at `/`.
 * @returns {{ cwd: string, reason: SpawnCwdReason, requested: string | null }}
 *   `requested` is the resolved absolute path that was checked (null when none
 *   was asked for) — what a notice should name.
 */
export function resolveSpawnCwd({ requested, home, base, stat, realpath }) {
  const raw = typeof requested === "string" ? requested.trim() : "";
  if (!raw) return { cwd: home, reason: "none", requested: null };

  const abs = path.resolve(base || home, raw);
  if (isRoot(abs)) return { cwd: home, reason: "root", requested: abs };

  let st;
  try {
    st = stat(abs);
  } catch (e) {
    const code = e && typeof e === "object" ? /** @type {any} */ (e).code : undefined;
    // ENOTDIR: a parent in the path is a file ("/some/file.txt/sub") — to the
    // user that's simply a folder that doesn't exist.
    const reason = code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unusable";
    return { cwd: home, reason, requested: abs };
  }
  if (!st.isDirectory()) return { cwd: home, reason: "not-a-dir", requested: abs };

  if (realpath) {
    try {
      if (isRoot(realpath(abs))) return { cwd: home, reason: "root", requested: abs };
    } catch {
      return { cwd: home, reason: "unusable", requested: abs };
    }
  }
  return { cwd: abs, reason: "ok", requested: abs };
}

function isRoot(p) {
  return path.resolve(p) === path.parse(path.resolve(p)).root;
}

const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * The one visible line written into the terminal (ahead of the agent's own
 * output) when the launch asked for a folder that couldn't be used, so the
 * user isn't left wondering why the agent is in their home folder. Plain
 * words — same pattern as the worktree fallback note. `null` when there's
 * nothing to say: the folder was fine, none was asked for (home is the
 * expected start), or it was the root of the disk (never a real project
 * folder, so not worth alarming anyone about).
 *
 * @param {{ reason: SpawnCwdReason, requested: string | null }} result
 * @returns {string | null}
 */
export function spawnCwdFallbackNotice({ reason, requested }) {
  let what;
  switch (reason) {
    case "missing":
      what = `VibeCodes couldn't find the folder ${requested}`;
      break;
    case "not-a-dir":
      what = `${requested} isn't a folder`;
      break;
    case "unusable":
      what = `VibeCodes couldn't open the folder ${requested}`;
      break;
    default:
      return null;
  }
  return `${YELLOW}Note: ${what}, so this session started in your home folder.${RESET}\r\n\r\n`;
}
