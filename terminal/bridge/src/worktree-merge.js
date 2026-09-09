// Merge an isolated `claude --worktree` session's branch back into the MAIN
// repo (task 6366bcb1 — the isolated-worktree merge-back gap: second-session
// isolation launches `claude --worktree` but had ZERO way to bring the work
// home again, other than the human doing it by hand).
//
// SAFETY, load-bearing: every git call below targets `mainRepoRoot` via
// `git -C <mainRepoRoot> …` — this NEVER chdir()s any process. The "never cd
// between a worktree and the main folder" rule is the one that burned us on
// 29 Aug 2026 (see CLAUDE.md and stripClaudeWorktreeSuffix in
// src/lib/launch-claude-code.ts): a session that cd'd out of its worktree
// went on to record the WRONG folder as the project's home. `-C` never moves
// anything — it just tells git which working tree to operate on for one call.
//
// Hard preconditions, checked in order, each with its own honest refusal —
// never a silent no-op and never a half-done merge:
//   1. `mainRepoRoot` is a real git working tree              -> not_git
//   2. no merge/rebase already in progress there              -> error
//      (another live session may be mid-merge in main; barging in would be
//      the exact kind of surprise this feature exists to prevent)
//   3. the main working tree is clean                        -> main_dirty
//      (uncommitted changes mean another live session may be working there
//      right now — merging over the top of it is unsafe)
//   4. `branch` exists and is ahead of main's current HEAD    -> nothing_to_merge
// A conflicting merge is aborted immediately (`git merge --abort`) so main is
// NEVER left half-merged — the conflicting paths are returned instead so the
// human can resolve them by hand. This never pushes anywhere.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** @typedef {"merged"|"main_dirty"|"conflict"|"nothing_to_merge"|"not_git"|"error"} MergeStatus */

/**
 * @typedef {{
 *   status: MergeStatus,
 *   branch: string,
 *   conflicts?: string[],
 *   mergeCommit?: string,
 *   message?: string,
 * }} MergeResult
 */

/**
 * Which git branch is checked out in a `claude --worktree` folder — discovered
 * from git itself (`git worktree list --porcelain`) rather than
 * RECONSTRUCTED from the worktree's folder name.
 *
 * This distinction is load-bearing: the folder is named after the claude
 * conversation id (`.claude/worktrees/<id>`, see terminal/bridge/src/
 * resume-cmd.js's `--worktree <conv>`), but Claude Code does NOT check that
 * id out as the branch name verbatim — verified live against this repo's own
 * `.claude/worktrees/` (task 6366bcb1 QA pass, 9 Sep 2026): every entry's
 * folder id `<uuid>` sits on branch `worktree-<uuid>` — a `worktree-` PREFIX,
 * not the bare id. A first cut of this module assumed the bare id and always
 * missed the branch (`nothing_to_merge` every time). Asking git directly
 * self-heals if Claude Code's own naming ever changes again.
 *
 * @param {{ mainRepoRoot: string, worktreePath: string }} args
 * @returns {string | null} the branch name (never `refs/heads/…`), or null if
 *   no worktree at `worktreePath` is registered against `mainRepoRoot` (a
 *   never-existed, already-removed, or detached-HEAD worktree).
 */
export function resolveWorktreeBranch({ mainRepoRoot, worktreePath }) {
  const list = tryGit(mainRepoRoot, ["worktree", "list", "--porcelain"]);
  if (!list.ok) return null;
  const target = realOrResolved(worktreePath);
  for (const entry of parseWorktreeListPorcelain(list.stdout)) {
    if (realOrResolved(entry.worktree) === target) return entry.branch;
  }
  return null;
}

/** Resolve symlinks when possible (macOS's `/tmp` -> `/private/tmp` is exactly
 *  the kind of mismatch that would otherwise break a plain string compare);
 *  falls back to a plain absolute-path normalisation for a path that doesn't
 *  exist locally (e.g. in a unit test's synthetic porcelain output). */
function realOrResolved(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Parse `git worktree list --porcelain` output into `{ worktree, branch }`
 * entries. `branch` is null for a detached/bare entry (never matched against
 * by `resolveWorktreeBranch` — a merge needs an actual branch to name).
 * @param {string} output
 * @returns {{ worktree: string, branch: string | null }[]}
 */
function parseWorktreeListPorcelain(output) {
  const entries = [];
  let current = null;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("worktree ")) {
      current = { worktree: line.slice("worktree ".length), branch: null };
      entries.push(current);
    } else if (line.startsWith("branch ") && current) {
      const ref = line.slice("branch ".length);
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    }
    // "HEAD <sha>", "detached", "bare", "prunable …", blank lines — ignored;
    // a detached/bare entry simply keeps `branch: null`.
  }
  return entries;
}

/**
 * The merge-back entry point: discover the branch a worktree is actually on
 * (never assumed from its folder name), then merge it. Folds "no such
 * worktree registered" into `nothing_to_merge` — from the caller's point of
 * view it's the same "there's nothing here to bring home" outcome as a
 * branch that exists but isn't ahead.
 * @param {{ mainRepoRoot: string, worktreePath: string }} args
 * @returns {MergeResult}
 */
export function mergeIsolatedWorktree({ mainRepoRoot, worktreePath }) {
  const branch = resolveWorktreeBranch({ mainRepoRoot, worktreePath });
  if (!branch) return { status: "nothing_to_merge", branch: "" };
  return mergeWorktreeBranch({ mainRepoRoot, branch });
}

/** Run `git -C <root> <args>`, throwing on a non-zero exit (the normal git behaviour). */
function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

/** Same as `git`, but never throws — returns an { ok, stdout, stderr } tri-state
 *  so callers can tell "command ran, exit 0" from "command ran, non-zero" from
 *  "couldn't even run it" (e.g. git not installed) without try/catch at every call site. */
function tryGit(root, args) {
  try {
    return { ok: true, stdout: git(root, args) };
  } catch (e) {
    return {
      ok: false,
      stdout: typeof e?.stdout === "string" ? e.stdout : (e?.stdout?.toString?.() ?? ""),
      stderr: typeof e?.stderr === "string" ? e.stderr : (e?.stderr?.toString?.() ?? String(e?.message ?? e)),
    };
  }
}

/**
 * Merge `branch` into whatever `mainRepoRoot` currently has checked out.
 * Pure(-ish) — the only side effect is the git repo at `mainRepoRoot` itself,
 * and every failure path leaves it exactly as it found it (clean, no merge
 * in progress). Never pushes.
 *
 * @param {{ mainRepoRoot: string, branch: string }} args
 * @returns {MergeResult}
 */
export function mergeWorktreeBranch({ mainRepoRoot, branch }) {
  if (!mainRepoRoot || typeof mainRepoRoot !== "string") {
    return { status: "error", branch: branch ?? "", message: "mainRepoRoot is required" };
  }
  if (!branch || typeof branch !== "string") {
    return { status: "error", branch: branch ?? "", message: "branch is required" };
  }

  // 1) A real git working tree?
  const inside = tryGit(mainRepoRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout.trim() !== "true") {
    return { status: "not_git", branch };
  }

  // 2) Merge/rebase already in progress? (checked via the git-dir's own state
  //    files rather than exit codes — the cheapest honest signal, and the one
  //    `git status` itself uses under the hood.)
  const gitDirRes = tryGit(mainRepoRoot, ["rev-parse", "--git-dir"]);
  if (gitDirRes.ok) {
    const rawGitDir = gitDirRes.stdout.trim();
    const gitDir = path.isAbsolute(rawGitDir) ? rawGitDir : path.join(mainRepoRoot, rawGitDir);
    const inProgress = ["MERGE_HEAD", "rebase-merge", "rebase-apply"].some((marker) =>
      fs.existsSync(path.join(gitDir, marker))
    );
    if (inProgress) {
      return { status: "error", branch, message: "main already has a merge or rebase in progress" };
    }
  }

  // 3) Main's working tree clean? (another live session may be working there)
  const statusRes = tryGit(mainRepoRoot, ["status", "--porcelain"]);
  if (!statusRes.ok) {
    return { status: "error", branch, message: statusRes.stderr || "couldn't check main's working tree" };
  }
  // A `claude --worktree` folder nests INSIDE the main checkout
  // (`.claude/worktrees/<id>`), so it shows up in main's OWN `git status` as
  // an untracked path whenever a repo hasn't gitignored it (this repo's
  // .gitignore does — an older/foreign repo might not). Because an entirely
  // untracked directory is reported COLLAPSED — `?? .claude/`, not the full
  // nested path (verified: `git status --porcelain` never expands into an
  // untracked dir) — the filter has to match the directory prefix, not just
  // the exact worktrees path. That's not real dirtiness of main; it's just
  // the isolation folder existing. Filtered out here rather than relied on
  // the caller's .gitignore, so this check is correct regardless.
  // A wholly-untracked `.claude` (no tracked file inside it yet) collapses to
  // just `?? .claude/`, not `?? .claude/worktrees/<id>` — verified above. Only
  // excuse that collapsed form when a `.claude/worktrees` directory genuinely
  // exists on disk (i.e. it really is the isolation folder, not some other
  // unrelated untracked use of `.claude/`).
  const hasWorktreesDir = fs.existsSync(path.join(mainRepoRoot, ".claude", "worktrees"));
  const realDirtyLines = statusRes.stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const marker = line.slice(0, 2);
      const filePath = line.slice(3); // porcelain v1: "XY <path>" (or "XY <path> -> <path2>")
      // Only an UNTRACKED (`??`) `.claude`/`.claude/worktrees…` entry is ever
      // excused — a MODIFIED/STAGED change under `.claude/` (anything but `??`)
      // is real and still counts as dirty.
      if (marker !== "??") return true;
      if (filePath === ".claude/worktrees" || filePath.startsWith(".claude/worktrees/")) return false;
      if (hasWorktreesDir && (filePath === ".claude" || filePath === ".claude/")) return false;
      return true;
    });
  if (realDirtyLines.length > 0) {
    return { status: "main_dirty", branch };
  }

  // 4) Branch exists and is actually ahead of HEAD?
  const verify = tryGit(mainRepoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (!verify.ok) {
    return { status: "nothing_to_merge", branch };
  }
  const aheadRes = tryGit(mainRepoRoot, ["rev-list", "--count", `HEAD..${branch}`]);
  const ahead = aheadRes.ok ? Number.parseInt(aheadRes.stdout.trim(), 10) || 0 : 0;
  if (ahead === 0) {
    return { status: "nothing_to_merge", branch };
  }

  // 5) The merge itself — always --no-ff so the isolated session's work stays
  //    visible as its own merge commit, never silently fast-forwarded away.
  const merge = tryGit(mainRepoRoot, [
    "merge",
    "--no-ff",
    branch,
    "-m",
    `Merge branch '${branch}' into main (VibeCodes isolated terminal session)`,
  ]);
  if (!merge.ok) {
    const conflictRes = tryGit(mainRepoRoot, ["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = conflictRes.ok
      ? conflictRes.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    // NEVER leave main half-merged — abort unconditionally, even if we
    // couldn't determine the conflicting paths above.
    tryGit(mainRepoRoot, ["merge", "--abort"]);
    return { status: "conflict", branch, conflicts };
  }

  const head = tryGit(mainRepoRoot, ["rev-parse", "HEAD"]);
  return { status: "merged", branch, mergeCommit: head.ok ? head.stdout.trim() : undefined };
}
