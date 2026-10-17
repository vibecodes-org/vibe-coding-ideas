// Unit tests for the JS port of the app's project-folder checks (card 6b2cb8ac).
// The drift test against the TypeScript originals lives in
// src/lib/terminal/project-path.drift.test.ts (vitest); this file pins the
// JS behaviour on its own for the bridge's runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidAbsolutePath, isPlausibleProjectPath, stripClaudeWorktreeSuffix } from "./project-path.mjs";

test("landing zones are never a project folder", () => {
  for (const p of ["/", "/tmp", "/Users", "/Users/x", "/home/x", "/Users/x/", "C:\\", "C:\\Users", "C:\\Users\\x", "\\\\srv\\share"]) {
    assert.equal(isPlausibleProjectPath(p), false, p);
  }
});

test("real project folders pass", () => {
  for (const p of ["/Users/x/p", "/Users/x/projects/p", "/opt/work", "C:\\Users\\x\\p", "\\\\srv\\share\\p"]) {
    assert.equal(isPlausibleProjectPath(p), true, p);
  }
});

test("tilde, relative and $VAR paths are not absolute", () => {
  for (const p of ["~/p", "~", "p", "./p", "$HOME/p", "", "   "]) {
    assert.equal(isValidAbsolutePath(p), false, p);
  }
});

test("worktree suffixes collapse to the main checkout", () => {
  assert.equal(stripClaudeWorktreeSuffix("/Users/x/p/.claude/worktrees/abc"), "/Users/x/p");
  assert.equal(stripClaudeWorktreeSuffix("/Users/x/p/.claude/worktrees/abc/.claude/worktrees/d"), "/Users/x/p");
  assert.equal(stripClaudeWorktreeSuffix("C:\\x\\p\\.claude\\worktrees\\a"), "C:\\x\\p");
  assert.equal(stripClaudeWorktreeSuffix("/.claude/worktrees/x"), "/.claude/worktrees/x");
  assert.equal(stripClaudeWorktreeSuffix(" /Users/x/p "), "/Users/x/p");
});
