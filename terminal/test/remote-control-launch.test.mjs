// Remote Control launch — bridge-side proof (task 5c8969cc, "Start with Remote
// Control on").
//
//   A launch link carrying `remoteControl=1` must spawn Claude Code with the
//   fixed literal `--remote-control` IMMEDIATELY after `claude` — on fresh,
//   `--resume <id>` and `--continue` launches — so the bootstrap prompt (the
//   last argv element) is never read as the flag's optional session name.
//   Without the field the argv is exactly today's. Codex never gets it.
//
// Same harness as worktree-fallback.test.mjs: the REAL bridge entry against the
// Node stand-in relay, with fake `claude`/`codex` shims on PATH that echo their
// argv between markers. SHELL=/usr/bin/false defeats the login-shell PATH
// capture so the shims win over any real install.
//
// Run: cd terminal/test && node --test remote-control-launch.test.mjs

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
const SECRET = "remote-control-launch-test-secret";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";
const PROMPT = "Reply with exactly RC-PROMPT-OK";

/** A PATH dir holding `claude` and `codex` shims that exec the argv echo stand-in. */
function makeFakeAgentBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-fake-agents-"));
  for (const name of ["claude", "codex"]) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${ARGV_CMD}" "$@"\n`, {
      mode: 0o755,
    });
  }
  return dir;
}

function makeCommittedRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-rc-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  fs.writeFileSync(path.join(dir, "README"), "hi\n");
  execFileSync("git", ["-C", dir, "add", "README"]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
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
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  return child;
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

/** Fire one launch link (extra link params merged in, plus an optional raw
 *  query suffix appended verbatim); resolve the argv the fake agent saw. */
async function launch(t, linkParams, rawSuffix = "") {
  const session = `rc-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-RC-" + Math.random().toString(36).slice(2, 8);
  const fakeBin = makeFakeAgentBin();
  const cwd = makeCommittedRepo();
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

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RC", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, cwd, ...linkParams }) + rawSuffix;

  const leg = await connectBrowserLeg(relay.url, session, tokens.browser);
  browser = leg.ws;
  bridge = spawnBridge(["--launch-url", launchUrl], {
    PATH: `${fakeBin}:${process.env.PATH}`,
    SHELL: "/usr/bin/false",
  });

  await waitForText(leg.getBuf, "ARGV_END", HARD_TIMEOUT_MS, "argv marker");
  const m = leg.getBuf().match(/ARGV_BEGIN(.*?)ARGV_END/s);
  assert.ok(m, "argv markers present in the PTY stream");
  return JSON.parse(m[1]);
}

test("fresh prompt launch with model+permissionMode+worktree+remoteControl: --remote-control first, prompt last", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, {
    model: "opus",
    permissionMode: "auto",
    worktree: true,
    remoteControl: true,
    prompt: PROMPT,
  });
  assert.equal(argv[0], "--remote-control", JSON.stringify(argv));
  assert.equal(argv[1], "--session-id");
  assert.equal(argv[argv.length - 1], PROMPT, "prompt is the LAST element, verbatim");
  assert.equal(argv.filter((a) => a === "--remote-control").length, 1, "flag appears once");
  assert.ok(argv.includes("--worktree") && argv.includes("--model") && argv.includes("--permission-mode"));
});

test("resume_id + remoteControl -> ['--remote-control','--resume',id]", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { resumeId: RESUME_ID, remoteControl: true });
  assert.deepEqual(argv.slice(0, 3), ["--remote-control", "--resume", RESUME_ID]);
});

test("resume=1 + remoteControl -> ['--remote-control','--continue']", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { resume: true, remoteControl: true });
  assert.deepEqual(argv.slice(0, 2), ["--remote-control", "--continue"]);
});

test("remoteControl absent -> argv[0] is --session-id, no flag (today's launch)", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { prompt: PROMPT });
  assert.equal(argv[0], "--session-id");
  assert.ok(!argv.includes("--remote-control"));
});

test("agent=codex + remoteControl -> codex argv never has --remote-control", { timeout: 60000 }, async (t) => {
  // The builder already refuses to put remoteControl=1 next to agent=codex, so
  // hand-append it to prove the bridge ignores it for Codex too.
  const argv = await launch(t, { agent: "codex", prompt: PROMPT, remoteControl: true }, "&remoteControl=1");
  assert.ok(!argv.includes("--remote-control"), JSON.stringify(argv));
});
