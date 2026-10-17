// Unit tests for the bridge's GitHub clone step (card 6b2cb8ac). A fake
// `spawn` plays git/gh; a temp folder stands in for the Mac's home.
// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { cloneRepo, classifyCloneError, parseCloneProgress, pickCloneDestination } from "./git-clone.js";

const REPO = { owner: "acme", name: "widget", cloneUrl: "https://github.com/acme/widget.git" };

function tmpHome(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-gc-home-")));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

/** A sync runner where every probe succeeds unless overridden. */
function okRun(overrides = {}) {
  const calls = [];
  return {
    calls,
    run: (file, args) => {
      calls.push([file, ...args]);
      const key = `${file} ${args.join(" ")}`;
      if (key in overrides) return overrides[key];
      return { status: 0, stdout: "", stderr: "" };
    },
  };
}

/**
 * A fake spawn: each call takes the next script entry. An entry says what
 * stderr to emit and how to exit; `makeDir` creates the clone target (the last
 * argv element) the way a real clone would.
 */
function fakeSpawn(script) {
  const calls = [];
  const spawn = (file, args, opts) => {
    const entry = script[calls.length] ?? { code: 0 };
    calls.push({ file, args, opts });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit("close", null, "SIGTERM"));
    };
    child.unref = () => {};
    if (entry.detached) return child;
    setImmediate(() => {
      const target = args[args.length - 1] === "--progress" ? args[args.length - 3] : args[args.length - 1];
      if (entry.makeDir) {
        fs.mkdirSync(path.join(target, ".git"), { recursive: true });
        fs.writeFileSync(path.join(target, "README"), "hi");
      }
      if (entry.partial) fs.mkdirSync(path.join(target, ".git"), { recursive: true });
      for (const chunk of entry.stderr ?? []) child.stderr.emit("data", Buffer.from(chunk));
      if (entry.hang) return;
      child.emit("close", entry.code ?? 0, null);
    });
    return child;
  };
  return { calls, spawn };
}

function base(home, extra = {}) {
  const progress = [];
  return {
    progress,
    opts: {
      repo: REPO,
      home,
      repoFolderName: "widget",
      env: { PATH: "/usr/bin" },
      platform: "darwin",
      fs,
      now: () => Date.now(),
      onProgress: (e) => progress.push(e),
      pid: 4242,
      ...extra,
    },
  };
}

test("parseCloneProgress reads the last 'Receiving objects' percentage", () => {
  assert.equal(parseCloneProgress("Receiving objects:  45% (450/1000)\rReceiving objects:  46% (460/1000)"), 46);
  assert.equal(parseCloneProgress("Counting objects: 100%"), null);
  assert.equal(parseCloneProgress(""), null);
});

test("classifyCloneError sorts GitHub's messages into reasons", () => {
  assert.equal(classifyCloneError("remote: Repository not found.\nfatal: repository 'x' not found"), "clone-no-access");
  assert.equal(classifyCloneError("fatal: Authentication failed for 'https://github.com/a/b'"), "clone-no-access");
  assert.equal(classifyCloneError("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "clone-no-access");
  assert.equal(classifyCloneError("git@github.com: Permission denied (publickey)."), "clone-no-access");
  assert.equal(classifyCloneError("error: The requested URL returned error: 403"), "clone-no-access");
  assert.equal(classifyCloneError("fatal: write error: No space left on device"), "folder-unavailable");
  assert.equal(classifyCloneError("fatal: could not create work tree dir: Read-only file system"), "folder-unavailable");
  assert.equal(classifyCloneError("fatal: unable to access: Could not resolve host: github.com"), "clone-failed");
});

test("pickCloneDestination: ~/projects/<name>, an empty folder is fine, a taken one gets -2", (t) => {
  const home = tmpHome(t);
  assert.equal(pickCloneDestination({ home, repoFolderName: "widget", fs }), path.join(home, "projects", "widget"));
  fs.mkdirSync(path.join(home, "projects", "widget"), { recursive: true });
  assert.equal(pickCloneDestination({ home, repoFolderName: "widget", fs }), path.join(home, "projects", "widget"));
  fs.writeFileSync(path.join(home, "projects", "widget", "x"), "");
  assert.equal(pickCloneDestination({ home, repoFolderName: "widget", fs }), path.join(home, "projects", "widget-2"));
  for (let i = 2; i <= 9; i++) fs.writeFileSync(path.join(home, "projects", `widget-${i}`), "");
  assert.equal(pickCloneDestination({ home, repoFolderName: "widget", fs }), null);
  assert.equal(pickCloneDestination({ home, repoFolderName: "../x", fs }), null);
});

test("git missing: Apple's installer is opened and the clone stops with git-missing", async (t) => {
  const home = tmpHome(t);
  const r = okRun({ "xcode-select -p": { status: 2, stdout: "", stderr: "" } });
  const s = fakeSpawn([{ detached: true }]);
  const { opts } = base(home, { run: r.run, spawn: s.spawn });
  const out = await cloneRepo(opts);
  assert.deepEqual(out, { ok: false, reason: "git-missing", detail: null });
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].file, "xcode-select");
  assert.deepEqual(s.calls[0].args, ["--install"]);
});

test("a clean clone lands in ~/projects/<name> via a temporary folder, with progress", async (t) => {
  const home = tmpHome(t);
  const s = fakeSpawn([{ makeDir: true, stderr: ["Cloning into 'x'...\n", "Receiving objects:  10% (1/10)\r", "Receiving objects:  45% (4/10)\r", "Receiving objects: 100% (10/10), done.\n"] }]);
  let clock = 0;
  const { opts, progress } = base(home, {
    run: okRun().run,
    spawn: s.spawn,
    now: () => {
      clock += 600;
      return clock;
    },
  });
  const out = await cloneRepo(opts);
  const dest = path.join(home, "projects", "widget");
  assert.deepEqual(out, { ok: true, path: dest });
  assert.ok(fs.existsSync(path.join(dest, "README")));
  assert.equal(fs.readdirSync(path.join(home, "projects")).length, 1, "no partial folder left behind");
  const call = s.calls[0];
  assert.equal(call.file, "git");
  assert.deepEqual(call.args.slice(0, 3), ["clone", "--progress", REPO.cloneUrl]);
  assert.match(call.args[3], /widget\.vibecodes-partial-4242$/);
  assert.equal(call.opts.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(call.opts.env.GCM_INTERACTIVE, "never");
  assert.equal(call.opts.env.GIT_ASKPASS, "");
  assert.equal(call.opts.env.SSH_ASKPASS, "");
  assert.equal(call.opts.shell, undefined, "never through a shell");
  assert.deepEqual(progress, [
    { kind: "clone-start", repo: REPO, dest },
    { kind: "clone-progress", pct: 10 },
    { kind: "clone-progress", pct: 45 },
    { kind: "clone-progress", pct: 100 },
  ]);
});

test("progress is throttled to one update per 500ms and only on change", async (t) => {
  const home = tmpHome(t);
  const s = fakeSpawn([{ makeDir: true, stderr: ["Receiving objects:  10%\r", "Receiving objects:  11%\r", "Receiving objects:  11%\r", "Receiving objects:  12%\r"] }]);
  const { opts, progress } = base(home, { run: okRun().run, spawn: s.spawn, now: () => 1000 });
  await cloneRepo(opts);
  assert.deepEqual(progress.filter((e) => e.kind === "clone-progress"), [{ kind: "clone-progress", pct: 10 }]);
});

test("a failed clone removes its partial folder and reports GitHub's last line", async (t) => {
  const home = tmpHome(t);
  const s = fakeSpawn([{ partial: true, code: 128, stderr: ["Cloning into 'x'...\n", "fatal: unable to access 'https://github.com/acme/widget.git/': Could not resolve host: github.com\n"] }]);
  const { opts } = base(home, { run: okRun().run, spawn: s.spawn });
  const out = await cloneRepo(opts);
  assert.deepEqual(out, {
    ok: false,
    reason: "clone-failed",
    detail: "fatal: unable to access 'https://github.com/acme/widget.git/': Could not resolve host: github.com",
  });
  assert.deepEqual(fs.readdirSync(path.join(home, "projects")), [], "partial folder removed");
  assert.equal(s.calls.length, 1, "no fallback after a non-access failure");
});

test("gh is tried only after an access failure, and only when signed in", async (t) => {
  const home = tmpHome(t);
  const s = fakeSpawn([
    { code: 128, stderr: ["remote: Repository not found.\n"] },
    { makeDir: true },
  ]);
  const { opts } = base(home, { run: okRun().run, spawn: s.spawn });
  const out = await cloneRepo(opts);
  assert.equal(out.ok, true);
  assert.equal(s.calls[1].file, "gh");
  assert.deepEqual(s.calls[1].args.slice(0, 3), ["repo", "clone", "acme/widget"]);
  assert.deepEqual(s.calls[1].args.slice(-2), ["--", "--progress"]);
});

test("gh not signed in → ssh only when known_hosts knows github.com; else no-access", async (t) => {
  const home = tmpHome(t);
  const notSignedIn = okRun({ "gh auth status": { status: 1, stdout: "", stderr: "" } });
  const s1 = fakeSpawn([{ code: 128, stderr: ["fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"] }]);
  const { opts: o1 } = base(home, { run: notSignedIn.run, spawn: s1.spawn });
  const out1 = await cloneRepo(o1);
  assert.equal(out1.reason, "clone-no-access");
  assert.equal(s1.calls.length, 1, "no gh, no ssh");

  fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(home, ".ssh", "known_hosts"), "github.com ssh-ed25519 AAAA\n");
  const s2 = fakeSpawn([{ code: 128, stderr: ["remote: Repository not found.\n"] }, { makeDir: true }]);
  const { opts: o2 } = base(home, { run: notSignedIn.run, spawn: s2.spawn });
  const out2 = await cloneRepo(o2);
  assert.equal(out2.ok, true);
  assert.equal(s2.calls[1].file, "git");
  assert.equal(s2.calls[1].args[2], "git@github.com:acme/widget.git");
  assert.equal(s2.calls[1].opts.env.GIT_SSH_COMMAND, "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes");
});

test("a stalled clone is stopped and reported as clone-failed (stalled)", async (t) => {
  const home = tmpHome(t);
  const s = fakeSpawn([{ hang: true, partial: true }]);
  const { opts } = base(home, { run: okRun().run, spawn: s.spawn, stallMs: 30 });
  const out = await cloneRepo(opts);
  assert.deepEqual(out, { ok: false, reason: "clone-failed", detail: "stalled" });
  assert.deepEqual(fs.readdirSync(path.join(home, "projects")), []);
});

test("no free destination → folder-unavailable", async (t) => {
  const home = tmpHome(t);
  fs.mkdirSync(path.join(home, "projects"), { recursive: true });
  for (const n of ["widget", ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => `widget-${i}`)]) fs.writeFileSync(path.join(home, "projects", n), "");
  const s = fakeSpawn([]);
  const { opts } = base(home, { run: okRun().run, spawn: s.spawn });
  const out = await cloneRepo(opts);
  assert.equal(out.reason, "folder-unavailable");
  assert.equal(s.calls.length, 0);
});

test("stale half-downloads of this project left by a dead process are cleared first; a live one is left alone", async (t) => {
  const home = tmpHome(t);
  const projects = path.join(home, "projects");
  fs.mkdirSync(path.join(projects, "widget.vibecodes-partial-111", ".git"), { recursive: true });
  fs.mkdirSync(path.join(projects, "widget-2.vibecodes-partial-222", ".git"), { recursive: true });
  fs.mkdirSync(path.join(projects, "widget.vibecodes-partial-333", ".git"), { recursive: true });
  fs.mkdirSync(path.join(projects, "gadget.vibecodes-partial-111", ".git"), { recursive: true });
  const s = fakeSpawn([{ makeDir: true }]);
  const { opts } = base(home, { run: okRun().run, spawn: s.spawn, isPidAlive: (pid) => pid === 333 });
  const out = await cloneRepo(opts);
  assert.deepEqual(out, { ok: true, path: path.join(projects, "widget") });
  assert.deepEqual(fs.readdirSync(projects).sort(), ["gadget.vibecodes-partial-111", "widget", "widget.vibecodes-partial-333"]);
});
