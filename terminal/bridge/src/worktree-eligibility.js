// Can this folder actually host a `claude --worktree` launch?
//
// Nick's field report, 5 Sep 2026 (task 5b8a3865): the app asked for
// concurrent-session isolation (a sibling session was already live on the
// board, so the mint route set `isolate: true` and the bridge appended
// `--worktree <id>`), but the project folder was a git repo with ZERO
// commits. Claude Code's `--worktree` branches a new worktree off HEAD, so it
// refused to start at all:
//
//     Error creating worktree: Failed to resolve base branch "HEAD": git rev-parse failed
//
// and the session died before the user could type anything. A folder that
// isn't a git repo at all fails the same way ("Can only use --worktree in a
// git repository"). Neither case is a reason to refuse the launch: there is
// nothing to isolate FROM in an empty repo, and the user asked for a terminal,
// not a lecture. So the bridge checks the folder BEFORE deciding to append the
// flag, and when the folder can't take a worktree it launches in the main
// folder instead and prints a visible one-line warning into the terminal
// (see `worktreeFallbackBanner`) so the user knows this session is sharing the
// folder with their other live one.
//
// Pure decision over an injectable `run` so it's unit-testable without git;
// the real caller passes a `spawnSync`-backed runner.

/** @typedef {"ok" | "not-a-repo" | "no-commits" | "git-missing" | "check-failed"} WorktreeEligibilityReason */

/**
 * @param {string} cwd
 * @param {{ run: (args: string[]) => { status: number | null, error?: unknown } }} deps
 *   `run(args)` executes `git <args...>` and returns the exit status (null when
 *   the process could not run at all, e.g. git not installed or a timeout).
 * @returns {{ eligible: boolean, reason: WorktreeEligibilityReason }}
 */
export function checkWorktreeEligibility(cwd, { run }) {
  let inside;
  try {
    inside = run(["-C", cwd, "rev-parse", "--is-inside-work-tree"]);
  } catch (e) {
    return { eligible: false, reason: isEnoent(e) ? "git-missing" : "check-failed" };
  }
  if (inside.error) {
    return { eligible: false, reason: isEnoent(inside.error) ? "git-missing" : "check-failed" };
  }
  if (inside.status !== 0) return { eligible: false, reason: "not-a-repo" };

  let head;
  try {
    head = run(["-C", cwd, "rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    return { eligible: false, reason: "check-failed" };
  }
  if (head.error) return { eligible: false, reason: "check-failed" };
  if (head.status !== 0) return { eligible: false, reason: "no-commits" };
  return { eligible: true, reason: "ok" };
}

function isEnoent(e) {
  return !!e && typeof e === "object" && /** @type {any} */ (e).code === "ENOENT";
}

const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * The one visible line written into the terminal (ahead of Claude Code's own
 * output) when isolation was requested but the folder couldn't take it. Plain
 * words, no flag names: the reader is the person at the keyboard, and the
 * point is "your two sessions now share this folder — be aware", not the
 * mechanism. `null` when there's nothing to say (eligible, or isolation never
 * requested).
 *
 * @param {WorktreeEligibilityReason} reason
 * @returns {string | null}
 */
export function worktreeFallbackBanner(reason) {
  let why;
  switch (reason) {
    case "ok":
      return null;
    case "no-commits":
      why = "this project has no commits yet";
      break;
    case "not-a-repo":
      why = "this folder isn't a git project";
      break;
    case "git-missing":
      why = "git isn't installed on this machine";
      break;
    default:
      why = "the folder couldn't be checked";
  }
  return (
    `${YELLOW}Note: ${why}, so this session couldn't get its own separate working copy. ` +
    `It's running directly in the project folder, shared with your other live session on this board.${RESET}\r\n\r\n`
  );
}
