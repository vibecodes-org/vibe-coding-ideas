// Spawn-folder safety — bridge-side proof (card 3ae71b07):
//
//   The packaged helper forks the bridge from `/`. A launch link with no
//   folder used to start the agent right there, at the root of the disk (the
//   mechanism behind the 29 Aug 2026 "agent recorded another project's
//   folder" incident). A link naming a folder that was gone — or a file —
//   made the agent exit on the spot and the session close after 0 bytes, with
//   no message.
//
//   Now: anything unusable starts in the home folder, and a folder that was
//   asked for but couldn't be used gets a one-line note in the terminal ahead
//   of the agent's own output. A real folder is still honoured exactly.
//
// Runs the REAL bridge entry, spawned with cwd "/" (as the helper's fork used
// to be), against the Node stand-in relay, with a fake `claude`/`codex` on
// PATH that prints the folder it started in. HOME points at a temp dir so the
// "home folder" is known and never the real one. SHELL is /usr/bin/false so
// the bridge's login-shell PATH capture fails and it uses the PATH we hand it.
//
// Run: cd terminal/test && node --test spawn-cwd.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
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
const SECRET = "spawn-cwd-test-secret";
const WAIT_MS = 12000;

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A PATH dir holding a fake agent that prints the folder it was started in. */
function makeFakeAgentBin(name) {
  const dir = tmpDir("vc-fake-cwd-");
  fs.writeFileSync(
    path.join(dir, name),
    `#!/bin/sh\necho "ARGS_BEGIN $* ARGS_END"\necho "PWD_BEGIN$(pwd -P)PWD_END"\nsleep 3\n`,
    { mode: 0o755 },
  );
  return dir;
}

/** Worst case for the isolation guard: a home folder that is itself a git repo with a commit. */
function makeHomeRepo(home) {
  execFileSync("git", ["-C", home, "init", "-q"]);
  fs.writeFileSync(path.join(home, "README"), "hi\n");
  execFileSync("git", ["-C", home, "add", "README"]);
  execFileSync("git", ["-C", home, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
}

async function launch(t, { cwd, prompt, agent, worktree, homeIsRepo }) {
  const session = `cwd-${Math.random().toString(36).slice(2, 8)}`;
  const bin = makeFakeAgentBin(agent === "codex" ? "codex" : "claude");
  const home = tmpDir("vc-home-");
  if (homeIsRepo) makeHomeRepo(home);
  const tokens = await mintSessionTokens({ sub: "u-" + session, idea: "idea-cwd", sid: session, secret: SECRET });
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  const url = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, cwd, prompt, agent, worktree });

  let stream = "";
  const ws = new WebSocket(
    `${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`,
  );
  ws.on("message", (d) => {
    stream += Buffer.isBuffer(d) ? d.toString("utf8") : String(d);
  });
  await once(ws, "open");

  let stderr = "";
  const child = spawn(process.execPath, [BRIDGE_ENTRY, "--launch-url", url], {
    cwd: "/",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      SHELL: "/usr/bin/false",
      BRIDGE_MAX_SECONDS: "30",
      TERMINAL_APP_URL: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  child.stdout.resume();

  t.after(async () => {
    try {
      ws.terminate();
    } catch {
      /* already closed */
    }
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => {});
    }
    await relay.close();
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const started = Date.now();
  while (!/PWD_END/.test(stream) && child.exitCode === null && Date.now() - started < WAIT_MS) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const m = stream.match(/PWD_BEGIN(.*?)PWD_END/s);
  const a = stream.match(/ARGS_BEGIN(.*?)ARGS_END/s);
  return { pwd: m ? m[1].trim() : null, args: a ? a[1].trim() : null, home, stream, stderr };
}

const NOTE = /so this session started in your home folder/;

test("no folder on a prompt-carrying claude launch → home, not /, and no note", { timeout: 30000 }, async (t) => {
  const r = await launch(t, { prompt: "hello" });
  assert.equal(r.pwd, r.home, r.stderr);
  assert.doesNotMatch(r.stream, NOTE);
});

test("no folder on a promptless launch → home", { timeout: 30000 }, async (t) => {
  const r = await launch(t, {});
  assert.equal(r.pwd, r.home, r.stderr);
});

test("no folder on a codex launch → home", { timeout: 30000 }, async (t) => {
  const r = await launch(t, { prompt: "hello", agent: "codex" });
  assert.equal(r.pwd, r.home, r.stderr);
});

test("a folder that no longer exists → home, with a note naming it before the agent's output", { timeout: 30000 }, async (t) => {
  const gone = path.join(os.tmpdir(), "vc-does-not-exist-3ae71b07");
  fs.rmSync(gone, { recursive: true, force: true });
  const r = await launch(t, { cwd: gone, prompt: "hello" });
  assert.equal(r.pwd, r.home, r.stderr);
  assert.match(r.stream, new RegExp(`couldn't find the folder ${gone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(r.stream.indexOf("started in your home folder") < r.stream.indexOf("PWD_BEGIN"), "note comes first");
});

test("a regular file as the folder → home, with a note", { timeout: 30000 }, async (t) => {
  const f = path.join(os.tmpdir(), `vc-cwd-file-${process.pid}`);
  fs.writeFileSync(f, "x");
  t.after(() => fs.rmSync(f, { force: true }));
  const r = await launch(t, { cwd: f, prompt: "hello" });
  assert.equal(r.pwd, r.home, r.stderr);
  assert.match(r.stream, /isn't a folder, so this session started in your home folder/);
});

test("/ as the folder → home, quietly", { timeout: 30000 }, async (t) => {
  const r = await launch(t, { cwd: "/", prompt: "hello" });
  assert.equal(r.pwd, r.home, r.stderr);
  assert.doesNotMatch(r.stream, NOTE);
});

test("a real project folder is honoured exactly, with no note", { timeout: 30000 }, async (t) => {
  const d = tmpDir("vc-real-proj-");
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const r = await launch(t, { cwd: d, prompt: "hello" });
  assert.equal(r.pwd, d, r.stderr);
  assert.doesNotMatch(r.stream, NOTE);
});

test("isolation requested + missing folder → home, no worktree, no worktree banner (even when home is a git repo)", { timeout: 30000 }, async (t) => {
  const gone = path.join(os.tmpdir(), "vc-isolate-missing-3ae71b07");
  fs.rmSync(gone, { recursive: true, force: true });
  const r = await launch(t, { cwd: gone, prompt: "hello", worktree: true, homeIsRepo: true });
  assert.equal(r.pwd, r.home, r.stderr);
  assert.match(r.stream, /couldn't find the folder/);
  assert.notEqual(r.args, null, "agent argv was captured");
  assert.doesNotMatch(r.args, /--worktree/);
  assert.doesNotMatch(r.stream, /separate working copy|shared with your other live session/);
});

test("control: isolation requested + a real committed repo still gets --worktree", { timeout: 30000 }, async (t) => {
  const d = tmpDir("vc-isolate-repo-");
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  makeHomeRepo(d);
  const r = await launch(t, { cwd: d, prompt: "hello", worktree: true });
  assert.equal(r.pwd, d, r.stderr);
  assert.match(r.args ?? "", /--worktree/);
  assert.doesNotMatch(r.stream, NOTE);
});
