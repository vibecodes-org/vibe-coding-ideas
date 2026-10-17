// Unit tests for the bridge's folder progress / failure lines (card 6b2cb8ac).
// The strings come from the approved mock, docs/terminal-fresh-mac-folder-mock.html.
// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayPath, progressLine, failureLines, earlyExitLine, promptFolderNote } from "./bridge-copy.js";

const HOME = "/Users/you";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const REPO = { owner: "vibecodes-org", name: "vibe-coding-ideas", cloneUrl: "https://github.com/vibecodes-org/vibe-coding-ideas.git" };

test("displayPath shortens the home folder to ~", () => {
  assert.equal(displayPath("/Users/you/code/x", HOME), "~/code/x");
  assert.equal(displayPath("/Users/you", HOME), "~");
  assert.equal(displayPath("/Users/younger/x", HOME), "/Users/younger/x");
  assert.equal(displayPath("/opt/x", HOME), "/opt/x");
});

test("progress lines match the mock (section 1)", () => {
  const ctx = { home: HOME, agent: "claude", repoName: "vibe-coding-ideas" };
  assert.equal(strip(progressLine({ kind: "looking", repoName: "vibe-coding-ideas" }, ctx)), "VibeCodes  Looking for vibe-coding-ideas on this Mac…\r\n");
  assert.equal(
    strip(progressLine({ kind: "found", path: "/Users/you/code/vibe-coding-ideas", alsoFound: [] }, ctx)),
    "VibeCodes  Found it: ~/code/vibe-coding-ideas\r\nVibeCodes  Starting Claude Code there.\r\n",
  );
  assert.equal(
    strip(progressLine({ kind: "found", path: "/Users/you/projects/vibe-coding-ideas", alsoFound: ["/Users/you/old/vibe-coding-ideas"] }, ctx)),
    "VibeCodes  Found 2 copies. Using the one you used most recently: ~/projects/vibe-coding-ideas\r\n" +
      "VibeCodes  (The other one is ~/old/vibe-coding-ideas.)\r\n" +
      "VibeCodes  Starting Claude Code there.\r\n",
  );
  assert.equal(
    strip(progressLine({ kind: "found", path: "/Users/you/a/x", alsoFound: ["/Users/you/b/x", "/Users/you/c/x"] }, ctx)),
    "VibeCodes  Found 3 copies. Using the one you used most recently: ~/a/x\r\n" +
      "VibeCodes  (The others are ~/b/x and ~/c/x.)\r\n" +
      "VibeCodes  Starting Claude Code there.\r\n",
  );
  assert.equal(
    strip(progressLine({ kind: "clone-start", repo: REPO, dest: "/Users/you/projects/vibe-coding-ideas" }, ctx)),
    "VibeCodes  It isn't on this Mac yet, so it's being downloaded from GitHub (vibecodes-org/vibe-coding-ideas) into ~/projects/vibe-coding-ideas.\r\n" +
      "VibeCodes  If your Mac asks to use your GitHub sign-in from the keychain, click Always Allow.\r\n",
  );
  assert.equal(strip(progressLine({ kind: "clone-progress", pct: 45 }, ctx)), "\rVibeCodes  Downloading… 45%");
  assert.equal(strip(progressLine({ kind: "clone-done" }, ctx)), "\r\nVibeCodes  Downloaded. Starting Claude Code there.\r\n");
  assert.equal(
    strip(progressLine({ kind: "created", path: "/Users/you/projects/my-new-idea" }, { ...ctx, agent: "codex" })),
    "VibeCodes  This board has no GitHub project yet, so it gets a new folder: ~/projects/my-new-idea\r\nVibeCodes  Starting Codex there.\r\n",
  );
});

test("the VibeCodes tag is teal (cyan); failure lines are yellow", () => {
  assert.ok(progressLine({ kind: "looking", repoName: "x" }, { home: HOME, agent: "claude" }).includes("\x1b[1;36mVibeCodes\x1b[0m"));
  for (const line of failureLines({ reason: "clone-failed", detail: "x" }, { home: HOME, agent: "claude", repo: REPO })) {
    assert.ok(line.startsWith("\x1b[33m"), JSON.stringify(line));
  }
});

test("failure lines name the cause in plain English", () => {
  const ctx = { home: HOME, agent: "claude", repo: REPO, folder: "/Users/you/projects/vibe-coding-ideas", newFolder: "/Users/you/projects/my-new-idea" };
  const text = (f) => failureLines(f, ctx).map(strip).join("");
  assert.equal(text({ reason: "folder-missing" }), "The project folder ~/projects/vibe-coding-ideas isn't on this Mac, so this conversation can't be reopened here.\r\n");
  assert.equal(text({ reason: "clone-no-access", detail: "remote: Repository not found." }), "GitHub said: remote: Repository not found.\r\n");
  assert.equal(text({ reason: "clone-failed", detail: "fatal: Could not resolve host: github.com" }), "GitHub said: fatal: Could not resolve host: github.com\r\n");
  assert.equal(text({ reason: "clone-failed", detail: "stalled" }), "The download from GitHub stopped before it finished.\r\n");
  assert.equal(
    text({ reason: "git-missing" }),
    "Git isn't installed yet, so the project can't be downloaded. Your Mac is showing Apple's installer now: click Install (it takes a few minutes), then start again.\r\n",
  );
  assert.equal(text({ reason: "folder-unavailable" }), "~/projects/my-new-idea couldn't be created on this Mac.\r\n");
  assert.equal(text({ reason: "folder-lookup-failed" }), "The helper on this Mac couldn't reach VibeCodes to look up this project's folder.\r\n");
  assert.equal(text({ reason: "folder-not-allowed" }), "This session won't start in that folder: it isn't a project folder.\r\n");
});

test("no line ever says token, relay or port", () => {
  const ctx = { home: HOME, agent: "claude", repo: REPO, folder: "/Users/you/p", newFolder: "/Users/you/projects/n" };
  const all = [
    ...["folder-missing", "clone-no-access", "clone-failed", "git-missing", "folder-unavailable", "folder-lookup-failed", "folder-not-allowed"].flatMap((reason) =>
      failureLines({ reason, detail: null }, ctx),
    ),
    earlyExitLine("claude", 1),
    promptFolderNote({ path: "/Users/you/p", how: "found" }),
  ].join("");
  assert.ok(!/\btoken\b|\brelay\b|\bport\b/i.test(all), all);
});

test("the early-exit line names the agent and the exit code", () => {
  assert.equal(strip(earlyExitLine("claude", 1)), "Claude Code stopped straight away (exit code 1).\r\n");
  assert.equal(strip(earlyExitLine("codex", 127)), "Codex stopped straight away (exit code 127).\r\n");
});

test("the prompt note tells the agent it is already in the folder", () => {
  assert.equal(
    promptFolderNote({ path: "/Users/you/code/x", how: "found" }),
    "VibeCodes note: you are already in this board's project folder on this Mac: /Users/you/code/x (found an existing copy). Work here. Ignore any other folder or clone instruction below, and don't cd elsewhere.",
  );
  assert.match(promptFolderNote({ path: "/p/x", how: "cloned" }), /\(downloaded it\)/);
  assert.match(promptFolderNote({ path: "/p/x", how: "created" }), /\(created it\)/);
  assert.match(promptFolderNote({ path: "/p/x", how: "saved" }), /\(this Mac's saved folder\)/);
});
