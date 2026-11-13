// Windows behaviour of the bridge's folder copy and git check. The platform is
// injected, so this runs on every OS (and for real on the Windows CI runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayPath, failureLines, local, promptFolderNote } from "./bridge-copy.js";
import { cloneRepo } from "./git-clone.js";
import { stripClaudeWorktreeSuffix } from "../../shared/project-path.mjs";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("displayPath shortens a Windows home folder to ~ (any case, either slash)", () => {
  const home = "C:\\Users\\Sam";
  assert.equal(displayPath("C:\\Users\\Sam\\projects\\app", home), "~\\projects\\app");
  assert.equal(displayPath("c:\\users\\sam\\projects\\app", home), "~\\projects\\app");
  assert.equal(displayPath("C:\\Users\\Sam", home), "~");
  assert.equal(displayPath("C:\\Users\\Sam", home + "\\"), "~");
  assert.equal(displayPath("C:\\Users\\Samuel\\x", home), "C:\\Users\\Samuel\\x");
  assert.equal(displayPath("D:\\work\\x", home), "D:\\work\\x");
});

test("local(): Windows says PC, Mac text is untouched", () => {
  assert.equal(local("It isn't on this Mac yet", "win32"), "It isn't on this PC yet");
  assert.equal(local("this Mac's saved folder", "win32"), "this PC's saved folder");
  assert.equal(local("your Mac asks", "win32"), "your PC asks");
  assert.equal(local("It isn't on this Mac yet", "darwin"), "It isn't on this Mac yet");
});

test("git-missing on Windows points at Git for Windows, not Apple's installer", () => {
  const text = failureLines({ reason: "git-missing", detail: null }, { home: "C:\\Users\\Sam", agent: "claude", platform: "win32" })
    .map(strip)
    .join("");
  assert.match(text, /Git for Windows|git-scm\.com\/download\/win/);
  assert.doesNotMatch(text, /Apple|Mac/);
});

test("clone on Windows with Git missing stops with git-missing and never runs xcode-select", async () => {
  const calls = [];
  let spawned = false;
  const out = await cloneRepo({
    repo: { owner: "a", name: "b", cloneUrl: "https://github.com/a/b.git" },
    home: "C:\\Users\\Sam",
    repoFolderName: "b",
    env: {},
    platform: "win32",
    run: (file, args) => {
      calls.push(`${file} ${args.join(" ")}`);
      return { status: 1, error: new Error("ENOENT") };
    },
    spawn: () => {
      spawned = true;
      return {};
    },
    fs: {},
  });
  assert.deepEqual(out, { ok: false, reason: "git-missing", detail: null });
  assert.equal(spawned, false);
  assert.ok(calls.every((c) => !c.includes("xcode-select")));
});

test("the worktree suffix is stripped from Windows paths too", () => {
  assert.equal(stripClaudeWorktreeSuffix("C:\\Users\\Sam\\projects\\app\\.claude\\worktrees\\abc123"), "C:\\Users\\Sam\\projects\\app");
});

test("promptFolderNote says PC on Windows only", () => {
  assert.match(promptFolderNote({ path: "C:\\x", how: "saved" }), /Mac|PC/);
});
