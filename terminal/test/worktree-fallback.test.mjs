// Worktree eligibility fallback — bridge-side proof (task 5b8a3865, Nick's
// field report 5 Sep 2026):
//
//   A launch that ASKS for concurrent-session isolation (`worktree=1`) against
//   a git repo with NO COMMITS must still start — in the main folder, WITHOUT
//   `--worktree`, and with a plain-English note written into the terminal
//   ahead of the program's own output. Before this, Claude Code died on the
//   spot with "Error creating worktree: Failed to resolve base branch HEAD".
//
//   The same launch against a repo WITH a commit keeps today's behaviour:
//   `--worktree <id>` appended, no note.
//
// Runs the REAL bridge entry against the Node stand-in relay, with a fake
// `claude` on PATH (a shell shim that execs argv-cmd.mjs, which echoes its
// argv between markers). SHELL is pointed at /usr/bin/false so the bridge's
// login-shell PATH capture fails and it falls back to the PATH we hand it —
// that's how the shim gets found instead of the real `claude`.
//
// Run: cd terminal/test && node --test worktree-fallback.test.mjs

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
const ARGV_CMD = path.resolve(__dirname, "./argv-cmd.mjs");
const HARD_TIMEOUT_MS = 20000;
const SECRET = "worktree-fallback-test-secret";

/** A PATH dir holding a `claude` shim that execs the argv echo stand-in. */
function makeFakeClaudeBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-fake-claude-"));
  const shim = path.join(dir, "claude");
  fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${ARGV_CMD}" "$@"\n`, { mode: 0o755 });
  return dir;
}

function makeRepo({ withCommit }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), withCommit ? "vc-repo-committed-" : "vc-repo-empty-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  if (withCommit) {
    fs.writeFileSync(path.join(dir, "README"), "hi\n");
    execFileSync("git", ["-C", dir, "add", "README"]);
    execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  }
  return dir;
}

function spawnBridge(argv, env = {}) {
  const child = spawn(process.execPath, [BRIDGE_ENTRY, ...argv], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      BRIDGE_MAX_SECONDS: "60",
      TERMINAL_APP_URL: "http://127.0.0.1:1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => {
    stderr += d;
    process.stderr.write(d);
  });
  return { child, getStderr: () => stderr };
}

function waitForText(getBuf, text, ms, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (getBuf().includes(text)) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(iv);
        reject(new Error(`timed out after ${ms}ms waiting for ${label}: ${JSON.stringify(text)}`));
      }
    }, 25);
  });
}

async function connectBrowserLeg(relayUrl, session, browserToken) {
  let buf = "";
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=browser&token=${encodeURIComponent(browserToken)}`);
  ws.on("message", (data) => {
    buf += Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("browser ws open timeout")), 5000)),
  ]);
  return { ws, getBuf: () => buf };
}

/** Launch worktree=1 against `cwd`; resolve the argv the fake claude saw + the full stream. */
async function launchIsolated(t, cwd) {
  const session = `wt-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-W-" + Math.random().toString(36).slice(2, 8);
  const fakeBin = makeFakeClaudeBin();
  let relay;
  let bridge;
  let browser;
  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-W", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, cwd, worktree: true });

  const leg = await connectBrowserLeg(relay.url, session, tokens.browser);
  browser = leg.ws;
  const spawned = spawnBridge(["--launch-url", launchUrl], {
    PATH: `${fakeBin}:${process.env.PATH}`,
    SHELL: "/usr/bin/false", // defeat the login-shell PATH capture so our shim wins
  });
  bridge = spawned.child;

  await waitForText(leg.getBuf, "ARGV_END", HARD_TIMEOUT_MS, "argv marker");
  const m = leg.getBuf().match(/ARGV_BEGIN(.*?)ARGV_END/s);
  assert.ok(m, "argv markers present in the PTY stream");
  return { argv: JSON.parse(m[1]), stream: leg.getBuf(), stderr: spawned.getStderr() };
}

test("worktree=1 against a repo with NO commits: launches WITHOUT --worktree and prints the shared-folder note first", { timeout: 60000 }, async (t) => {
  const { argv, stream, stderr } = await launchIsolated(t, makeRepo({ withCommit: false }));
  assert.ok(!argv.includes("--worktree"), `--worktree must be dropped, got ${JSON.stringify(argv)}`);
  assert.ok(argv.includes("--session-id"), "still a fresh launch with its minted id");
  assert.match(stream, /no commits yet/, "the plain-English reason reaches the browser");
  assert.match(stream, /shared with your other live session/);
  assert.ok(stream.indexOf("no commits yet") < stream.indexOf("ARGV_BEGIN"), "note precedes the program's own output");
  assert.match(stderr, /worktree isolation requested but the folder can't host one/, "structured warn logged");
});

test("worktree=1 against a repo WITH a commit: --worktree <id> is appended and nothing extra is printed", { timeout: 60000 }, async (t) => {
  const { argv, stream } = await launchIsolated(t, makeRepo({ withCommit: true }));
  const i = argv.indexOf("--worktree");
  assert.ok(i >= 0, `--worktree must be present, got ${JSON.stringify(argv)}`);
  assert.equal(argv[i + 1], argv[argv.indexOf("--session-id") + 1], "worktree name reuses the minted session id");
  assert.doesNotMatch(stream, /separate working copy/, "no fallback note on an eligible launch");
});
