// Resumed launches keep the board's agents (card f4bbd75c).
//
//   A resumed Claude Code / Codex conversation does NOT keep the agents it was
//   first started with: Claude's --agents are per launch, and Codex's role
//   files live in a temp folder deleted when the old bridge exits. So a resume
//   must be handed the board's agents exactly like a fresh launch, and the
//   spawn must WAIT for the agents fetch (a resume has no prompt, so it used
//   to spawn immediately and skip the agents).
//
// Same harness as remote-control-launch.test.mjs: the REAL bridge entry against
// the Node stand-in relay, with fake claude/codex shims on PATH that echo their
// argv, plus a tiny stand-in for the app's /api/terminal/session/agents (and
// /key) endpoints.
//
// Run: cd terminal/test && node --test resume-agents-launch.test.mjs

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
const ARGV_CMD = path.resolve(__dirname, "./argv-cmd.mjs");
const SECRET = "resume-agents-test-secret";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";
const PROMPT = "Reply with exactly AGENTS-PROMPT-OK";
const AGENT_NAME = "vc-probe-1234abcd-frontier";
const AGENTS = { [AGENT_NAME]: { description: "probe", prompt: "You are the probe.", model: "opus", effort: "high" } };

function makeFakeAgentBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-fake-agents-"));
  for (const name of ["claude", "codex"]) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${ARGV_CMD}" "$@"\n`, { mode: 0o755 });
  }
  return dir;
}

function makeCommittedRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-ra-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  fs.writeFileSync(path.join(dir, "README"), "hi\n");
  execFileSync("git", ["-C", dir, "add", "README"]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  return dir;
}

/** Stand-in app: serves the agents (optionally after a delay) and declines E2EE. */
async function startFakeApp({ agentsDelayMs = 0 } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url, body: JSON.parse(body || "{}") });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/terminal/session/agents") {
        setTimeout(() => res.end(JSON.stringify({ agents: AGENTS })), agentsDelayMs);
      } else {
        res.end(JSON.stringify({ delivered: false }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

function waitForText(getBuf, text, ms) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (getBuf().includes(text)) { clearInterval(iv); resolve(); }
      else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`timed out waiting for ${text}`)); }
    }, 25);
  });
}

async function launch(t, linkParams, { appUrl, handle = {} }) {
  const session = `ra-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-RA-" + Math.random().toString(36).slice(2, 8);
  const fakeBin = makeFakeAgentBin();
  const cwd = makeCommittedRepo();
  let relay, bridge, browser;
  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, cwd, ...linkParams });
  let buf = "";
  browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d) => (buf += Buffer.isBuffer(d) ? d.toString("utf8") : String(d)));
  await once(browser, "open");
  bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--launch-url", launchUrl], {
    env: { PATH: `${fakeBin}:${process.env.PATH}`, HOME: process.env.HOME, SHELL: "/usr/bin/false", BRIDGE_MAX_SECONDS: "60", TERMINAL_APP_URL: appUrl },
    stdio: ["ignore", "ignore", "ignore"],
  });
  handle.bridge = bridge;
  await waitForText(() => buf, "ARGV_END", 20000);
  return JSON.parse(buf.match(/ARGV_BEGIN(.*?)ARGV_END/s)[1]);
}

const agentsJsonOf = (argv) => {
  const i = argv.indexOf("--agents");
  return i >= 0 ? JSON.parse(argv[i + 1]) : null;
};

test("control: a fresh prompt launch gets --agents", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url });
  assert.deepEqual(Object.keys(agentsJsonOf(argv) ?? {}), [AGENT_NAME], JSON.stringify(argv));
});

test("a resume-by-id launch gets --agents", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  const argv = await launch(t, { resumeId: RESUME_ID, remoteControl: true }, { appUrl: app.url });
  assert.deepEqual(argv.slice(0, 3), ["--remote-control", "--resume", RESUME_ID]);
  assert.deepEqual(Object.keys(agentsJsonOf(argv) ?? {}), [AGENT_NAME], JSON.stringify(argv));
});

test("a legacy --continue launch gets --agents", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  const argv = await launch(t, { resume: true }, { appUrl: app.url });
  assert.equal(argv[0], "--continue");
  assert.deepEqual(Object.keys(agentsJsonOf(argv) ?? {}), [AGENT_NAME], JSON.stringify(argv));
});

test("a resumed launch waits for a slow agents fetch before starting Claude", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ agentsDelayMs: 1500 }); t.after(app.close);
  const argv = await launch(t, { resumeId: RESUME_ID }, { appUrl: app.url });
  assert.ok(agentsJsonOf(argv), JSON.stringify(argv));
});

test("a Codex resume gets its agent role files", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  const argv = await launch(t, { agent: "codex", resume: true }, { appUrl: app.url });
  assert.deepEqual(argv.slice(0, 2), ["resume", "--last"]);
  assert.ok(argv.some((a) => a.startsWith(`agents.${AGENT_NAME}.config_file=`)), JSON.stringify(argv));
});

test("a Codex resume-by-id gets its role files; they live for the session and are removed when it ends", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  const handle = {};
  const argv = await launch(t, { agent: "codex", resumeId: RESUME_ID }, { appUrl: app.url, handle });
  assert.deepEqual(argv.slice(0, 2), ["resume", RESUME_ID], JSON.stringify(argv));
  const flag = argv.find((a) => a.startsWith(`agents.${AGENT_NAME}.config_file=`));
  assert.ok(flag, JSON.stringify(argv));
  assert.equal(argv[argv.indexOf(flag) - 1], "-c");
  const file = JSON.parse(flag.slice(flag.indexOf("=") + 1));
  const dir = path.dirname(file);
  assert.ok(fs.existsSync(file), "role file exists while the resumed session runs");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.match(fs.readFileSync(file, "utf8"), /developer_instructions = "You are the probe\."/);
  assert.ok(!dir.startsWith(os.homedir() + "/.codex"), "outside ~/.codex");
  // End the resumed session the normal way and check the cleanup still fires.
  handle.bridge.kill("SIGTERM");
  await once(handle.bridge, "exit");
  assert.ok(!fs.existsSync(dir), "role-file folder removed when the resumed session ends");
});

test("the endpoint is asked for the right CLI's tier models on a resume", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  await launch(t, { agent: "codex", resume: true }, { appUrl: app.url });
  const call = app.calls.find((c) => c.url === "/api/terminal/session/agents");
  assert.ok(call, "agents endpoint was called on a resume");
  assert.equal(call.body.agent, "codex");
});

test("app unreachable on resume: still launches, just without agents", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { resumeId: RESUME_ID }, { appUrl: "http://127.0.0.1:1" });
  assert.deepEqual(argv, ["--resume", RESUME_ID]);
});
