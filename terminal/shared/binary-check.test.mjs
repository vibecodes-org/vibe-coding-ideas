// Unit tests for the shared "is this binary on PATH?" check.
// Run: cd terminal/shared && npm test   (node --test auto-discovers this file)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBinaryOnPath, isBinaryInstalled } from "./binary-check.mjs";

function makeFakeBin(dir, name) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "#!/bin/sh\necho fake\n", { mode: 0o755 });
  return p;
}

test("finds an executable file in a PATH dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-"));
  const bin = makeFakeBin(dir, "codex");
  try {
    assert.equal(resolveBinaryOnPath("codex", dir), bin);
    assert.equal(isBinaryInstalled("codex", dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checks multiple PATH dirs in order, first match wins", () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-b-"));
  const binB = makeFakeBin(dirB, "codex");
  try {
    assert.equal(resolveBinaryOnPath("codex", `${dirA}:${dirB}`), binB);
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test("missing binary -> null / false", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-empty-"));
  try {
    assert.equal(resolveBinaryOnPath("codex", dir), null);
    assert.equal(isBinaryInstalled("codex", dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-executable file is not treated as installed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-noexec-"));
  const p = path.join(dir, "codex");
  fs.writeFileSync(p, "not executable", { mode: 0o644 });
  try {
    assert.equal(isBinaryInstalled("codex", dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a directory that happens to be named like the binary is not a match", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-dir-"));
  fs.mkdirSync(path.join(dir, "codex"));
  try {
    assert.equal(isBinaryInstalled("codex", dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("garbage/empty inputs never throw", () => {
  assert.equal(resolveBinaryOnPath("", "/usr/bin"), null);
  assert.equal(resolveBinaryOnPath(null, "/usr/bin"), null);
  assert.equal(resolveBinaryOnPath("codex", ""), null);
  assert.equal(resolveBinaryOnPath("codex", undefined), null);
  assert.equal(resolveBinaryOnPath("codex", 123), null);
});

test("an absolute path name bypasses PATH search entirely (mirrors execvp's own rule)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-abs-"));
  const bin = makeFakeBin(dir, "my-node");
  try {
    // A totally unrelated (even empty) PATH must not matter — the name
    // contains "/", so it's checked directly.
    assert.equal(resolveBinaryOnPath(bin, ""), bin);
    assert.equal(resolveBinaryOnPath(bin, "/nonexistent/dir"), bin);
    assert.equal(isBinaryInstalled(bin, undefined), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an absolute path that doesn't exist is reported missing, not thrown", () => {
  assert.equal(resolveBinaryOnPath("/no/such/binary-at-all", "/usr/bin"), null);
});

test("relative/empty PATH entries are skipped, not treated as cwd", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-bincheck-rel-"));
  makeFakeBin(dir, "codex");
  try {
    // "." and "" entries interleaved must not throw and must still find the
    // real dir later in the list.
    assert.equal(resolveBinaryOnPath("codex", `.::${dir}`), path.join(dir, "codex"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
