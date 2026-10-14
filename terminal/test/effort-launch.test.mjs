// Claude starting effort launch — bridge-side proof (task 18a37612).
//
//   A launch link carrying `effort=<level>` must spawn Claude Code with
//   `--effort <level>` on fresh, `--resume <id>` and `--continue` launches,
//   the prompt still last. A level Claude doesn't have is never passed, and
//   Codex never gets the Claude flag. Same harness as
//   remote-control-launch.test.mjs.
//
// Run: cd terminal/test && node --test effort-launch.test.mjs

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
const SECRET = "effort-launch-test-secret";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";
const PROMPT = "Reply with exactly EFFORT-PROMPT-OK";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-ef-repo-"));
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
  const session = `ef-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-EF-" + Math.random().toString(36).slice(2, 8);
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

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-EF", sid: session, secret: SECRET });
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

test("fresh launch: --effort <level> after --session-id/--model, prompt last", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { model: "opus", effort: "xhigh", permissionMode: "auto", prompt: PROMPT });
  const i = argv.indexOf("--effort");
  assert.ok(i > 0, JSON.stringify(argv));
  assert.equal(argv[i + 1], "xhigh");
  assert.ok(argv.indexOf("--model") < i && i < argv.indexOf("--permission-mode"), JSON.stringify(argv));
  assert.equal(argv[argv.length - 1], PROMPT);
});

test("effort=max (Claude-only level) survives the link and reaches claude", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { effort: "max", prompt: PROMPT });
  assert.equal(argv[argv.indexOf("--effort") + 1], "max");
});

test("resume_id + effort -> ['--resume',id,'--effort',level]", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { resumeId: RESUME_ID, effort: "high" });
  assert.deepEqual(argv.slice(0, 4), ["--resume", RESUME_ID, "--effort", "high"]);
});

test("resume=1 + effort -> ['--continue','--effort',level]", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { resume: true, effort: "low" });
  assert.deepEqual(argv.slice(0, 3), ["--continue", "--effort", "low"]);
});

test("effort absent -> no --effort (today's launch)", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { prompt: PROMPT });
  assert.ok(!argv.includes("--effort"), JSON.stringify(argv));
});

test("a level Claude does not have (hand-appended) is dropped", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { prompt: PROMPT }, "&effort=minimal");
  assert.ok(!argv.includes("--effort"), JSON.stringify(argv));
});

test("agent=codex + a Claude effort -> codex argv never has --effort", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { agent: "codex", prompt: PROMPT }, "&effort=max");
  assert.ok(!argv.includes("--effort"), JSON.stringify(argv));
  assert.ok(!argv.includes("model_reasoning_effort=max"), JSON.stringify(argv));
});
