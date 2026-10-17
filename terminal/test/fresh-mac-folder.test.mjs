// First browser terminal on a fresh Mac (card 6b2cb8ac) — real-process proof
// that the bridge sorts out the project folder ON THE MAC before the agent
// starts, instead of spawning into a folder that only exists on another Mac.
//
//   4 — saved folder missing on this Mac, but a checkout of the board's repo
//       exists in ~/<repo> → the agent runs IN that checkout, and the folder
//       is recorded for this Mac. (Before the fix: node-pty spawned into the
//       missing folder, the agent exited at once with 0 bytes — cause A.)
//   5 — no checkout anywhere → cloned into ~/projects/<repo> (or -2 when the
//       name is taken), from a local bare repo standing in for GitHub.
//   6 — Resume whose folder isn't on this Mac → ends with folder-missing and
//       a plain line, nothing spawned.
//   7 — the agent quits within 10s → ends with agent-stopped-early:<code>.
//   8 — code review rework: a moved project (the board names the old owner)
//       and an SSH host alias are this Mac's real checkout, never a second
//       download; a resume into the home folder is refused like a launch.
//
// A temp HOME stands in for the Mac's home folder, the stand-in relay for the
// relay, and a small HTTP server for the app's workspace/folder routes.
//
// Run: cd terminal/test && VIBECODES_PACKAGED= node --test fresh-mac-folder.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { buildLaunchDeepLink } from "../shared/deep-link.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const PWD_CMD = path.resolve(__dirname, "./pwd-cmd.mjs");
const SECRET = "fresh-mac-folder-test-secret";
const PROMPT = "Work the board task";

function tmpDir(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

/** A committed checkout at `dir` whose origin is `originUrl`. */
function makeCheckout(dir, originUrl) {
  fs.mkdirSync(dir, { recursive: true });
  git(["init", "-q"], dir);
  fs.writeFileSync(path.join(dir, "README"), "hi\n");
  git(["add", "README"], dir);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], dir);
  git(["remote", "add", "origin", originUrl], dir);
  return dir;
}

/** A bare repo with one commit, standing in for GitHub. */
function makeBareRepo(root) {
  const work = makeCheckout(path.join(root, "seed"), "https://github.com/acme/widget.git");
  const bare = path.join(root, "widget.git");
  git(["clone", "-q", "--bare", work, bare], root);
  return bare;
}

/** Stand-in app: the workspace + folder routes; everything else declines. */
async function startFakeApp(workspace) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url, body: JSON.parse(body || "{}") });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/terminal/session/workspace") {
        res.end(JSON.stringify({ workspace }));
      } else if (req.url === "/api/terminal/session/folder") {
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ delivered: false }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

function waitFor(pred, ms, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (pred()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(iv);
        reject(new Error(`timed out after ${ms}ms waiting for ${label}`));
      }
    }, 25);
  });
}

/**
 * Pair a browser leg, then fire the bridge with a launch link. Returns the
 * browser's received text (binary + text frames), the text frames alone, and
 * the bridge's stderr log.
 */
async function launch(t, { home, link = {}, appUrl, cmd = `${process.execPath} ${PWD_CMD}`, env = {} }) {
  const session = `fm-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-FM-" + Math.random().toString(36).slice(2, 8);
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-FM", sid: session, secret: SECRET });
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  let buf = "";
  const textFrames = [];
  const browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d, isBinary) => {
    const s = Buffer.isBuffer(d) ? d.toString("utf8") : String(d);
    if (!isBinary) textFrames.push(s);
    buf += s;
  });
  await once(browser, "open");
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, ...link });
  const argv = [BRIDGE_ENTRY, "--launch-url", launchUrl];
  if (cmd) argv.push("--cmd", cmd);
  let stderr = "";
  const bridge = spawn(process.execPath, argv, {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, SHELL: "/usr/bin/false", BRIDGE_MAX_SECONDS: "120", TERMINAL_APP_URL: appUrl, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  bridge.stderr.setEncoding("utf8");
  bridge.stderr.on("data", (d) => (stderr += d));
  t.after(async () => {
    try { browser.terminate(); } catch { /* ignore */ }
    if (bridge.exitCode === null) bridge.kill("SIGKILL");
    await relay.close();
  });
  return {
    bridge,
    getBuf: () => buf,
    textFrames,
    getStderr: () => stderr,
    shutdownWhy: () => {
      const m = stderr.match(/"msg":"shutting down","why":"([^"]*)"/);
      return m ? m[1] : null;
    },
  };
}

const pwdOf = (buf) => buf.match(/PWD_BEGIN(.*?)PWD_END/s)?.[1] ?? null;

// ── 4: the cause-A reproduction ──────────────────────────────────────────────
test("4: saved folder missing on this Mac, checkout in ~/<repo> → the agent runs IN that checkout and the folder is recorded", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  const checkout = makeCheckout(path.join(home, "widget"), "https://github.com/acme/widget.git");
  const missing = path.join(home, "projects", "widget"); // another Mac's folder; not on this one
  const app = await startFakeApp({
    repo: { owner: "acme", name: "widget", cloneUrl: "https://github.com/acme/widget.git" },
    repoFolderName: "widget",
    newFolderName: "widget-board",
    savedFolders: [missing],
    otherLiveSessionsOnThisMac: 0,
  });
  t.after(app.close);
  const run = await launch(t, { home, appUrl: app.url, link: { cwd: missing, prompt: PROMPT } });

  await waitFor(() => pwdOf(run.getBuf()) !== null || run.bridge.exitCode !== null, 30000, "the agent's folder (or the bridge exiting)");
  assert.equal(pwdOf(run.getBuf()), checkout, `the agent must start in the checkout; bridge log:\n${run.getStderr()}`);
  assert.match(run.getBuf(), /Looking for widget on this Mac…/);
  assert.match(run.getBuf(), /Found it: ~\/widget/);

  const ws = app.calls.find((c) => c.url === "/api/terminal/session/workspace");
  assert.ok(ws, "the bridge asked the app about the board");
  assert.ok(Array.isArray(ws.body.machineNames) && ws.body.machineNames.length >= 1, "with this Mac's names");
  await waitFor(() => app.calls.some((c) => c.url === "/api/terminal/session/folder"), 5000, "the folder record");
  const rec = app.calls.find((c) => c.url === "/api/terminal/session/folder");
  assert.equal(rec.body.path, checkout);
  assert.equal(rec.body.how, "found");
  assert.deepEqual(rec.body.machineNames, ws.body.machineNames);
  assert.ok(run.textFrames.some((f) => f === JSON.stringify({ t: "bridge-cwd", cwd: checkout })), "the page is told the folder");
});

// ── 5: clone ─────────────────────────────────────────────────────────────────
test("5: no checkout anywhere → cloned into ~/projects/<repo>, recorded as cloned", { timeout: 90000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  const src = tmpDir(t, "vc-fm-src-");
  const bare = makeBareRepo(src);
  const app = await startFakeApp({
    repo: { owner: "acme", name: "widget", cloneUrl: `file://${bare}` },
    repoFolderName: "widget",
    newFolderName: "widget-board",
    savedFolders: [],
    otherLiveSessionsOnThisMac: 0,
  });
  t.after(app.close);
  const run = await launch(t, { home, appUrl: app.url, link: { prompt: PROMPT } });
  await waitFor(() => pwdOf(run.getBuf()) !== null || run.bridge.exitCode !== null, 60000, "the agent's folder");
  const dest = path.join(home, "projects", "widget");
  assert.equal(pwdOf(run.getBuf()), dest, run.getStderr());
  assert.ok(fs.existsSync(path.join(dest, "README")), "a real clone");
  assert.deepEqual(fs.readdirSync(path.join(home, "projects")), ["widget"], "no partial folder left");
  assert.match(run.getBuf(), /being downloaded from GitHub \(acme\/widget\) into ~\/projects\/widget\./);
  await waitFor(() => app.calls.some((c) => c.url === "/api/terminal/session/folder"), 5000, "the folder record");
  assert.equal(app.calls.find((c) => c.url === "/api/terminal/session/folder").body.how, "cloned");
});

test("5b: ~/projects/<repo> taken by something else → cloned into <repo>-2", { timeout: 90000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  fs.mkdirSync(path.join(home, "projects", "widget"), { recursive: true });
  fs.writeFileSync(path.join(home, "projects", "widget", "notes.txt"), "not a checkout\n");
  const src = tmpDir(t, "vc-fm-src-");
  const bare = makeBareRepo(src);
  const app = await startFakeApp({
    repo: { owner: "acme", name: "widget", cloneUrl: `file://${bare}` },
    repoFolderName: "widget",
    newFolderName: "widget-board",
    savedFolders: [],
    otherLiveSessionsOnThisMac: 0,
  });
  t.after(app.close);
  const run = await launch(t, { home, appUrl: app.url, link: { prompt: PROMPT } });
  await waitFor(() => pwdOf(run.getBuf()) !== null || run.bridge.exitCode !== null, 60000, "the agent's folder");
  assert.equal(pwdOf(run.getBuf()), path.join(home, "projects", "widget-2"), run.getStderr());
  assert.equal(fs.readFileSync(path.join(home, "projects", "widget", "notes.txt"), "utf8"), "not a checkout\n", "the other folder is untouched");
});

// ── 6: resume into a folder that isn't on this Mac ───────────────────────────
test("6: Resume with a folder that isn't on this Mac → folder-missing, a plain line, nothing spawned", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  const fakeBin = tmpDir(t, "vc-fm-bin-");
  fs.writeFileSync(path.join(fakeBin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${PWD_CMD}" "$@"\n`, { mode: 0o755 });
  const app = await startFakeApp(null);
  t.after(app.close);
  const missing = path.join(home, "projects", "widget");
  const run = await launch(t, {
    home,
    appUrl: app.url,
    cmd: null,
    link: { cwd: missing, resumeId: "0b1bc584-0000-4000-8000-000000000000" },
    env: { PATH: `${fakeBin}:${process.env.PATH}` },
  });
  await once(run.bridge, "exit");
  assert.equal(run.shutdownWhy(), "folder-missing", run.getStderr());
  assert.ok(!run.getStderr().includes('"spawning PTY"'), "nothing spawned");
  assert.match(run.getBuf(), /The project folder ~\/projects\/widget isn't on this Mac, so this conversation can't be reopened here\./);
});

// ── 7: the agent stops straight away ─────────────────────────────────────────
test("7: the agent exits within 10s → agent-stopped-early:<code> with a plain line", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  const dir = path.join(home, "projects", "x");
  fs.mkdirSync(dir, { recursive: true });
  const app = await startFakeApp(null);
  t.after(app.close);
  const run = await launch(t, { home, appUrl: app.url, cmd: "sh -c 'exit 1'", link: { cwd: dir, prompt: PROMPT } });
  await once(run.bridge, "exit");
  assert.equal(run.shutdownWhy(), "agent-stopped-early:1", run.getStderr());
  assert.match(run.getBuf(), /Claude Code stopped straight away \(exit code 1\)\./);
});

// ── 8: code review rework ────────────────────────────────────────────────────
test("8a: moved project — the page's folder points at the new owner → the agent runs there, nothing is downloaded", { timeout: 90000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  const src = tmpDir(t, "vc-fm-src-");
  const bare = makeBareRepo(src); // a clone WOULD succeed, so a wrong decision shows up as widget-2
  const checkout = makeCheckout(path.join(home, "projects", "widget"), "https://github.com/neworg/widget.git");
  const app = await startFakeApp({
    repo: { owner: "acme", name: "widget", cloneUrl: `file://${bare}` },
    repoFolderName: "widget",
    newFolderName: "widget-board",
    savedFolders: [checkout],
    otherLiveSessionsOnThisMac: 0,
  });
  t.after(app.close);
  const run = await launch(t, { home, appUrl: app.url, link: { cwd: checkout, prompt: PROMPT } });
  await waitFor(() => pwdOf(run.getBuf()) !== null || run.bridge.exitCode !== null, 60000, "the agent's folder");
  assert.equal(pwdOf(run.getBuf()), checkout, run.getStderr());
  assert.deepEqual(fs.readdirSync(path.join(home, "projects")), ["widget"], "no second copy");
  await waitFor(() => app.calls.some((c) => c.url === "/api/terminal/session/folder"), 5000, "the folder record");
  assert.equal(app.calls.find((c) => c.url === "/api/terminal/session/folder").body.path, checkout);
});

test("8b: SSH host alias — a checkout with git@github-work:… is found by the search, nothing is downloaded", { timeout: 90000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  const src = tmpDir(t, "vc-fm-src-");
  const bare = makeBareRepo(src);
  const checkout = makeCheckout(path.join(home, "widget"), "git@github-work:acme/widget.git");
  const app = await startFakeApp({
    repo: { owner: "acme", name: "widget", cloneUrl: `file://${bare}` },
    repoFolderName: "widget",
    newFolderName: "widget-board",
    savedFolders: [],
    otherLiveSessionsOnThisMac: 0,
  });
  t.after(app.close);
  const run = await launch(t, { home, appUrl: app.url, link: { prompt: PROMPT } });
  await waitFor(() => pwdOf(run.getBuf()) !== null || run.bridge.exitCode !== null, 60000, "the agent's folder");
  assert.equal(pwdOf(run.getBuf()), checkout, run.getStderr());
  assert.ok(!fs.existsSync(path.join(home, "projects")), "nothing downloaded");
});

test("8c: Resume into the home folder → folder-not-allowed, nothing spawned", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-fm-home-");
  const fakeBin = tmpDir(t, "vc-fm-bin-");
  fs.writeFileSync(path.join(fakeBin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${PWD_CMD}" "$@"\n`, { mode: 0o755 });
  const app = await startFakeApp(null);
  t.after(app.close);
  const run = await launch(t, {
    home,
    appUrl: app.url,
    cmd: null,
    link: { cwd: home, resumeId: "0b1bc584-0000-4000-8000-000000000000" },
    env: { PATH: `${fakeBin}:${process.env.PATH}` },
  });
  await once(run.bridge, "exit");
  assert.equal(run.shutdownWhy(), "folder-not-allowed", run.getStderr());
  assert.ok(!run.getStderr().includes('"spawning PTY"'), "nothing spawned");
});
