// Project-folder checks, JS port (card 6b2cb8ac).
//
// The bridge resolves the project folder on the Mac itself before the agent
// starts, so it needs the SAME rules the app applies when it records a
// folder: never `/`, a home folder or a top-level folder, and a Claude Code
// worktree collapses back to the main checkout. These are line-for-line ports
// of `isValidAbsolutePath`, `isPlausibleProjectPath` and
// `stripClaudeWorktreeSuffix` in src/lib/launch-claude-code.ts.
// src/lib/terminal/project-path.drift.test.ts runs both over one table, so
// the two copies can't drift apart.

/**
 * Strict absolute path: POSIX, Windows drive or UNC. Rejects empty, relative,
 * `~` and `$VAR` values.
 * @param {unknown} path
 * @returns {boolean}
 */
export function isValidAbsolutePath(path) {
  if (typeof path !== "string") return false;
  const p = path.trim();
  if (!p) return false;
  if (p.startsWith("~")) return false;
  if (p.includes("$")) return false;
  const isPosix = p.startsWith("/");
  const isWinDrive = /^[A-Za-z]:[\\/]/.test(p);
  const isUnc = /^\\\\[^\\]+\\[^\\]+/.test(p);
  return isPosix || isWinDrive || isUnc;
}

/**
 * Plausibly a PROJECT folder: not `/`, a top-level folder, `/Users`, a home
 * folder, a drive root or `C:\Users\<name>`.
 * @param {unknown} path
 * @returns {boolean}
 */
export function isPlausibleProjectPath(path) {
  if (!isValidAbsolutePath(path)) return false;
  const p = /** @type {string} */ (path).trim().replace(/[\\/]+$/, "");

  if (p.startsWith("/")) {
    const segments = p.split("/").filter(Boolean);
    if (segments.length < 2) return false;
    const [first] = segments;
    if (segments.length === 2 && (first === "Users" || first === "home")) return false;
    return true;
  }

  if (/^\\\\[^\\]+\\[^\\]+/.test(p)) {
    const rest = p.replace(/^\\\\[^\\]+\\[^\\]+/, "");
    return rest.replace(/^[\\/]+/, "").length > 0;
  }

  const driveMatch = /^[A-Za-z]:[\\/]/.exec(p);
  if (driveMatch) {
    const remainder = p.slice(driveMatch[0].length);
    const segments = remainder.split(/[\\/]/).filter(Boolean);
    if (segments.length === 0) return false;
    if (segments.length === 1 && segments[0].toLowerCase() === "users") return false;
    if (segments.length === 2 && segments[0].toLowerCase() === "users") return false;
    return true;
  }

  return false;
}

/**
 * Collapse `<repo>/.claude/worktrees/<id>[/…]` to `<repo>` (outermost repo
 * for nested worktrees). Anything else comes back trimmed and unchanged.
 * @param {string} path
 * @returns {string}
 */
export function stripClaudeWorktreeSuffix(path) {
  const p = String(path).trim();
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees(?:[\\/].*)?$/.exec(p);
  if (!m) return p;
  const root = m[1];
  return root ? root : p;
}
