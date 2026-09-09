// Unit tests for the isolated-worktree merge-back (task 6366bcb1). Every test
// builds a REAL temp git repo (never touches Nick's actual repos) and tears
// it down afterwards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeWorktreeBranch, resolveWorktreeBranch, mergeIsolatedWorktree } from "./worktree-merge.js";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function writeFile(root, name, contents) {
  fs.writeFileSync(path.join(root, name), contents);
}

/** A fresh temp repo on `main`, with one commit, local identity configured. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vc-merge-test-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  writeFile(root, "README.md", "hello\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "initial commit"]);
  return root;
}

function rmRepo(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("merges a branch that is cleanly ahead of main", () => {
  const root = makeRepo();
  try {
    git(root, ["checkout", "-b", "feature-1"]);
    writeFile(root, "feature.txt", "new work\n");
    git(root, ["add", "feature.txt"]);
    git(root, ["commit", "-m", "feature work"]);
    git(root, ["checkout", "main"]);

    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "feature-1" });

    assert.equal(result.status, "merged");
    assert.equal(result.branch, "feature-1");
    assert.ok(result.mergeCommit && /^[0-9a-f]{40}$/.test(result.mergeCommit));
    assert.ok(fs.existsSync(path.join(root, "feature.txt")));
    // No merge left in progress, and it's a real --no-ff merge commit (two parents).
    const parents = git(root, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ");
    assert.equal(parents.length, 3);
  } finally {
    rmRepo(root);
  }
});

test("the isolated worktree's OWN folder never counts as making main dirty (even ungitignored)", () => {
  // No .gitignore for .claude/worktrees/ in this repo — `git worktree add`
  // still nests it inside main's checkout, so `git status` at main sees it as
  // an untracked entry (collapsed to `?? .claude/` when nothing else under
  // .claude is tracked yet). That must never be mistaken for real dirtiness.
  const root = makeRepo();
  const id = "sibling-session";
  try {
    const worktreePath = addRealWorktree(root, id);
    writeFile(worktreePath, "sibling-work.txt", "another live session's work\n");
    git(worktreePath, ["add", "sibling-work.txt"]);
    git(worktreePath, ["commit", "-m", "sibling work"]);

    git(root, ["checkout", "-b", "feature-4"]);
    writeFile(root, "feature.txt", "new work\n");
    git(root, ["add", "feature.txt"]);
    git(root, ["commit", "-m", "feature work"]);
    git(root, ["checkout", "main"]);

    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "feature-4" });

    assert.equal(result.status, "merged");
  } finally {
    try {
      git(root, ["worktree", "remove", "--force", path.join(root, ".claude", "worktrees", id)]);
    } catch { /* already gone */ }
    rmRepo(root);
  }
});

test("a REAL uncommitted change elsewhere in main still correctly reports main_dirty, worktree or not", () => {
  const root = makeRepo();
  const id = "sibling-session-2";
  try {
    const worktreePath = addRealWorktree(root, id);
    git(root, ["checkout", "-b", "feature-5"]);
    writeFile(root, "feature.txt", "new work\n");
    git(root, ["add", "feature.txt"]);
    git(root, ["commit", "-m", "feature work"]);
    git(root, ["checkout", "main"]);
    writeFile(root, "README.md", "a real uncommitted edit\n");

    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "feature-5" });

    assert.equal(result.status, "main_dirty");
  } finally {
    try {
      git(root, ["worktree", "remove", "--force", path.join(root, ".claude", "worktrees", id)]);
    } catch { /* already gone */ }
    rmRepo(root);
  }
});

test("refuses when main's working tree is dirty — never merges over uncommitted work", () => {
  const root = makeRepo();
  try {
    git(root, ["checkout", "-b", "feature-2"]);
    writeFile(root, "feature.txt", "new work\n");
    git(root, ["add", "feature.txt"]);
    git(root, ["commit", "-m", "feature work"]);
    git(root, ["checkout", "main"]);
    writeFile(root, "README.md", "uncommitted edit\n"); // dirty main

    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "feature-2" });

    assert.equal(result.status, "main_dirty");
    // Nothing merged — main's HEAD is unchanged, no MERGE_HEAD left behind.
    assert.equal(git(root, ["log", "--oneline"]).trim().split("\n").length, 1);
    assert.throws(() => git(root, ["rev-parse", "--verify", "MERGE_HEAD"]));
  } finally {
    rmRepo(root);
  }
});

test("aborts and reports conflicting paths, leaving main clean — never half-merged", () => {
  const root = makeRepo();
  try {
    writeFile(root, "shared.txt", "line one\n");
    git(root, ["add", "shared.txt"]);
    git(root, ["commit", "-m", "add shared file"]);

    git(root, ["checkout", "-b", "feature-3"]);
    writeFile(root, "shared.txt", "line one — from the branch\n");
    git(root, ["commit", "-am", "branch edit"]);

    git(root, ["checkout", "main"]);
    writeFile(root, "shared.txt", "line one — from main\n");
    git(root, ["commit", "-am", "main edit"]);

    const before = git(root, ["rev-parse", "HEAD"]).trim();
    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "feature-3" });

    assert.equal(result.status, "conflict");
    assert.deepEqual(result.conflicts, ["shared.txt"]);
    // Main is restored exactly to where it was — no half-merge, no MERGE_HEAD.
    assert.equal(git(root, ["rev-parse", "HEAD"]).trim(), before);
    assert.equal(git(root, ["status", "--porcelain"]).trim(), "");
    assert.throws(() => git(root, ["rev-parse", "--verify", "MERGE_HEAD"]));
  } finally {
    rmRepo(root);
  }
});

test("reports nothing_to_merge for a branch that doesn't exist", () => {
  const root = makeRepo();
  try {
    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "does-not-exist" });
    assert.equal(result.status, "nothing_to_merge");
  } finally {
    rmRepo(root);
  }
});

test("reports nothing_to_merge for a branch that exists but is already merged (not ahead)", () => {
  const root = makeRepo();
  try {
    git(root, ["branch", "already-merged"]); // points at the same commit as main
    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "already-merged" });
    assert.equal(result.status, "nothing_to_merge");
  } finally {
    rmRepo(root);
  }
});

test("reports not_git for a folder that isn't a git repository at all", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vc-merge-notgit-"));
  try {
    const result = mergeWorktreeBranch({ mainRepoRoot: root, branch: "anything" });
    assert.equal(result.status, "not_git");
  } finally {
    rmRepo(root);
  }
});

test("returns a structured error when required fields are missing — never throws", () => {
  assert.equal(mergeWorktreeBranch({ mainRepoRoot: "", branch: "x" }).status, "error");
  assert.equal(mergeWorktreeBranch({ mainRepoRoot: "/tmp", branch: "" }).status, "error");
});

// ── branch discovery (task 6366bcb1 — the coordinator's QA catch: a real
// `claude --worktree <id>` folder sits on branch `worktree-<id>`, a PREFIXED
// name, never the bare id. These tests pin that a bare id is NEVER used, and
// that the branch is always discovered from git itself, not reconstructed. ──

/** A real `git worktree add` under `<root>/.claude/worktrees/<id>`, on branch
 *  `worktree-<id>` — exactly the shape `claude --worktree <id>` produces
 *  (verified live against this repo's own `.claude/worktrees/`, 9 Sep 2026). */
function addRealWorktree(root, id) {
  const worktreePath = path.join(root, ".claude", "worktrees", id);
  git(root, ["worktree", "add", "-b", `worktree-${id}`, worktreePath]);
  return worktreePath;
}

test("resolveWorktreeBranch discovers the PREFIXED branch name from a real worktree — never the bare id", () => {
  const root = makeRepo();
  const id = "test-conv-id-1";
  try {
    const worktreePath = addRealWorktree(root, id);
    const branch = resolveWorktreeBranch({ mainRepoRoot: root, worktreePath });
    assert.equal(branch, `worktree-${id}`);
    assert.notEqual(branch, id, "must never fall back to the bare conversation id");
  } finally {
    rmRepo(root);
  }
});

test("resolveWorktreeBranch returns null for a worktree path that isn't actually registered", () => {
  const root = makeRepo();
  try {
    const branch = resolveWorktreeBranch({
      mainRepoRoot: root,
      worktreePath: path.join(root, ".claude", "worktrees", "never-existed"),
    });
    assert.equal(branch, null);
  } finally {
    rmRepo(root);
  }
});

test("mergeIsolatedWorktree merges a real worktree end to end via discovery, not a reconstructed name", () => {
  const root = makeRepo();
  const id = "test-conv-id-2";
  try {
    const worktreePath = addRealWorktree(root, id);
    writeFile(worktreePath, "from-worktree.txt", "isolated work\n");
    git(worktreePath, ["add", "from-worktree.txt"]);
    git(worktreePath, ["commit", "-m", "isolated work"]);

    const result = mergeIsolatedWorktree({ mainRepoRoot: root, worktreePath });

    assert.equal(result.status, "merged");
    assert.equal(result.branch, `worktree-${id}`);
    assert.ok(fs.existsSync(path.join(root, "from-worktree.txt")));
  } finally {
    // Remove the worktree registration before deleting the folder tree —
    // otherwise `root`'s own .git keeps a dangling worktree admin entry.
    try {
      git(root, ["worktree", "remove", "--force", path.join(root, ".claude", "worktrees", id)]);
    } catch { /* already gone */ }
    rmRepo(root);
  }
});

test("mergeIsolatedWorktree reports nothing_to_merge (never throws) for an unregistered worktree path", () => {
  const root = makeRepo();
  try {
    const result = mergeIsolatedWorktree({
      mainRepoRoot: root,
      worktreePath: path.join(root, ".claude", "worktrees", "ghost"),
    });
    assert.equal(result.status, "nothing_to_merge");
  } finally {
    rmRepo(root);
  }
});
