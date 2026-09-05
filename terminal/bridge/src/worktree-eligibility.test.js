// Unit tests for the `--worktree` eligibility gate (task 5b8a3865).
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWorktreeEligibility, worktreeFallbackBanner } from "./worktree-eligibility.js";

const CWD = "/Users/someone/projects/thing";

/** Build a fake git runner from a map of "subcommand" -> status. */
function fakeGit({ insideStatus, headStatus }) {
  const calls = [];
  return {
    calls,
    run: (args) => {
      calls.push(args);
      if (args.includes("--is-inside-work-tree")) return { status: insideStatus };
      if (args.includes("HEAD")) return { status: headStatus };
      throw new Error(`unexpected git args ${args.join(" ")}`);
    },
  };
}

test("a repo with at least one commit is eligible", () => {
  const git = fakeGit({ insideStatus: 0, headStatus: 0 });
  assert.deepEqual(checkWorktreeEligibility(CWD, git), { eligible: true, reason: "ok" });
  assert.deepEqual(git.calls, [
    ["-C", CWD, "rev-parse", "--is-inside-work-tree"],
    ["-C", CWD, "rev-parse", "--verify", "--quiet", "HEAD"],
  ]);
});

test("Nick's case: a repo with ZERO commits is NOT eligible (no-commits)", () => {
  const git = fakeGit({ insideStatus: 0, headStatus: 128 });
  assert.deepEqual(checkWorktreeEligibility(CWD, git), { eligible: false, reason: "no-commits" });
});

test("a folder that isn't a git repo is NOT eligible and HEAD is never even asked for", () => {
  const git = fakeGit({ insideStatus: 128, headStatus: 0 });
  assert.deepEqual(checkWorktreeEligibility(CWD, git), { eligible: false, reason: "not-a-repo" });
  assert.equal(git.calls.length, 1, "must short-circuit after the repo check");
});

test("git not installed (ENOENT from the runner's error field) → git-missing", () => {
  const err = Object.assign(new Error("spawnSync git ENOENT"), { code: "ENOENT" });
  const result = checkWorktreeEligibility(CWD, { run: () => ({ status: null, error: err }) });
  assert.deepEqual(result, { eligible: false, reason: "git-missing" });
});

test("git not installed (runner THROWS ENOENT) → git-missing", () => {
  const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  const result = checkWorktreeEligibility(CWD, {
    run: () => {
      throw err;
    },
  });
  assert.deepEqual(result, { eligible: false, reason: "git-missing" });
});

test("any other runner failure (timeout, odd error) → check-failed, never a crash", () => {
  const timedOut = checkWorktreeEligibility(CWD, {
    run: () => ({ status: null, error: new Error("ETIMEDOUT") }),
  });
  assert.deepEqual(timedOut, { eligible: false, reason: "check-failed" });

  const threw = checkWorktreeEligibility(CWD, {
    run: () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(threw, { eligible: false, reason: "check-failed" });
});

test("a HEAD check that errors AFTER a successful repo check → check-failed", () => {
  let n = 0;
  const result = checkWorktreeEligibility(CWD, {
    run: () => (n++ === 0 ? { status: 0 } : { status: null, error: new Error("timeout") }),
  });
  assert.deepEqual(result, { eligible: false, reason: "check-failed" });
});

test("banner: nothing to say when eligible", () => {
  assert.equal(worktreeFallbackBanner("ok"), null);
});

test("banner: every fallback reason yields one plain-English line ending in a blank line", () => {
  for (const reason of ["no-commits", "not-a-repo", "git-missing", "check-failed"]) {
    const line = worktreeFallbackBanner(reason);
    assert.ok(line, `${reason} must produce a banner`);
    assert.match(line, /separate working copy/);
    assert.match(line, /shared with your other live session/);
    assert.ok(line.endsWith("\r\n\r\n"), "banner must end with a blank line so Claude's UI starts clean");
    assert.doesNotMatch(line, /--worktree|HEAD|rev-parse/, "no flag names or git jargon in user-facing copy");
  }
  assert.match(worktreeFallbackBanner("no-commits"), /no commits yet/);
  assert.match(worktreeFallbackBanner("not-a-repo"), /isn't a git project/);
  assert.match(worktreeFallbackBanner("git-missing"), /git isn't installed/);
});
