// Windows behaviour of the shared binary check. The platform is injected, so
// these run on every OS (and on the Windows CI runner for real).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBinaryOnPath } from "./binary-check.mjs";

const WIN = { platform: "win32" };

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `vc-bincheck-${label}-`));
}
function makeWinBin(dir, name) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, "@echo off\r\n");
  return p;
}

test("win32: PATH is split on ';' and .exe is tried", () => {
  const dirA = tmp("wa");
  const dirB = tmp("wb");
  const bin = makeWinBin(dirB, "claude.exe");
  try {
    assert.equal(resolveBinaryOnPath("claude", `${dirA};${dirB}`, WIN), bin);
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test("win32: .cmd is found, and .exe wins when both sit in the same folder", () => {
  const dir = tmp("wc");
  const cmd = makeWinBin(dir, "claude.cmd");
  try {
    assert.equal(resolveBinaryOnPath("claude", dir, WIN), cmd);
    const exe = makeWinBin(dir, "claude.exe");
    assert.equal(resolveBinaryOnPath("claude", dir, WIN), exe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("win32: a custom PATHEXT is honoured", () => {
  const dir = tmp("wd");
  makeWinBin(dir, "codex.cmd");
  try {
    assert.equal(resolveBinaryOnPath("codex", dir, { ...WIN, pathext: ".EXE" }), null);
    assert.ok(resolveBinaryOnPath("codex", dir, { ...WIN, pathext: ".EXE;.CMD" }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("win32: no executable bit is needed, and quoted PATH entries are unwrapped", () => {
  const dir = tmp("we");
  const bin = path.join(dir, "codex.exe");
  fs.writeFileSync(bin, "x", { mode: 0o644 });
  try {
    assert.equal(resolveBinaryOnPath("codex", `"${dir}"`, WIN), bin);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("win32: a name with a drive letter or backslash bypasses the PATH search", () => {
  assert.equal(resolveBinaryOnPath("C:\\no\\such\\claude.exe", "", WIN), null);
  assert.equal(resolveBinaryOnPath("tools\\claude", "", WIN), null);
  const dir = tmp("wf");
  const bin = makeWinBin(dir, "claude.exe");
  try {
    assert.equal(resolveBinaryOnPath(bin, "", WIN), bin);
    assert.equal(resolveBinaryOnPath(path.join(dir, "claude"), "", WIN), bin);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
