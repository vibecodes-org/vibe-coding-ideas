// Memory limit (auto-compact window) launch — bridge-side proof (task 5e654dd1).
//
//   The app serves the owner's resolved limit in the same answer as the board's
//   agents. The bridge must turn it into `--autocompact N` (Claude, only when
//   `claude --version` is 2.1.221 or newer) or `-c model_auto_compact_token_limit=N`
//   (Codex) on fresh, resumed (by id and --continue / resume --last) and
//   worktree launches, with the prompt still last. A missing or invalid value,
//   an old Claude Code, or an unreachable app adds nothing: the session starts
//   exactly as before.
//
// Same harness as resume-agents-launch.test.mjs (real bridge entry, stand-in
// relay, fake claude/codex shims that echo their argv, a stand-in app); the
// fake `claude` also answers `--version`.
//
// Run: cd terminal/test && node --test auto-compact-launch.test.mjs
// (inside a helper session, unset VIBECODES_PACKAGED first)

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
const SECRET = "auto-compact-test-secret";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";
const PROMPT = "Reply with exactly COMPACT-PROMPT-OK";
const AGENT_NAME = "vc-probe-1234abcd-frontier";
const AGENTS = { [AGENT_NAME]: { description: "probe", prompt: "You are the probe.", model: "opus", effort: "high" } };

function makeFakeAgentBin(claudeVersion = "2.1.221 (Claude Code)") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-fake-agents-"));
  for (const name of ["claude", "codex"]) {
    const version = name === "claude" ? `if [ "$1" = "--version" ]; then echo "${claudeVersion}"; exit 0; fi\n` : "";
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${version}exec "${process.execPath}" "${ARGV_CMD}" "$@"\n`, { mode: 0o755 });
  }
  return dir;
}

function makeCommittedRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-ac-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  fs.writeFileSync(path.join(dir, "README"), "hi\n");
  execFileSync("git", ["-C", dir, "add", "README"]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  return dir;
}

/** Stand-in app: serves the agents (optionally after a delay) and declines E2EE. */
async function startFakeApp({ agentsDelayMs = 0, extra = {}, withAgents = true } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url, body: JSON.parse(body || "{}") });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/terminal/session/agents") {
        setTimeout(() => res.end(JSON.stringify({ agents: withAgents ? AGENTS : null, ...extra })), agentsDelayMs);
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

/**
 * Each launch gets its own TMPDIR (the bridge's os.tmpdir() honours it), so the
 * Codex role-file folder lands there and is removed with it, even when the test
 * SIGKILLs the bridge. `handle` is filled with { bridge, tmp, getBuf }.
 * `awaitArgv: false` returns right after the bridge is spawned (null result).
 */
async function launch(t, linkParams, { appUrl, handle = {}, shell = "/usr/bin/false", awaitArgv = true, claudeVersion }) {
  const session = `ac-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-AC-" + Math.random().toString(36).slice(2, 8);
  const fakeBin = makeFakeAgentBin(claudeVersion);
  const cwd = makeCommittedRepo();
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-ac-tmp-")));
  handle.tmp = tmp;
  let relay, bridge, browser;
  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-AC", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, cwd, ...linkParams });
  let buf = "";
  browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d) => (buf += Buffer.isBuffer(d) ? d.toString("utf8") : String(d)));
  handle.getBuf = () => buf;
  await once(browser, "open");
  bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--launch-url", launchUrl], {
    env: { PATH: `${fakeBin}:${process.env.PATH}`, HOME: process.env.HOME, SHELL: shell, TMPDIR: tmp, BRIDGE_MAX_SECONDS: "60", TERMINAL_APP_URL: appUrl },
    stdio: ["ignore", "ignore", "ignore"],
  });
  handle.bridge = bridge;
  if (!awaitArgv) return null;
  await waitForText(() => buf, "ARGV_END", 20000);
  return JSON.parse(buf.match(/ARGV_BEGIN(.*?)ARGV_END/s)[1]);
}

const agentsJsonOf = (argv) => {
  const i = argv.indexOf("--agents");
  return i >= 0 ? JSON.parse(argv[i + 1]) : null;
};
const WINDOW = 300000;

test("fresh Claude launch: --autocompact N before --agents, prompt last", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url });
  const i = argv.indexOf("--autocompact");
  assert.ok(i >= 0, JSON.stringify(argv));
  assert.equal(argv[i + 1], String(WINDOW));
  assert.ok(i < argv.indexOf("--agents"), JSON.stringify(argv));
  assert.equal(argv[argv.length - 1], PROMPT);
});

test("it is applied even when no agents came back", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ withAgents: false, extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url });
  assert.deepEqual(argv.slice(-3), ["--autocompact", String(WINDOW), PROMPT]);
  assert.ok(!argv.includes("--agents"));
});

test("a resume-by-id Claude launch carries it", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { resumeId: RESUME_ID }, { appUrl: app.url });
  assert.deepEqual(argv.slice(0, 4), ["--resume", RESUME_ID, "--autocompact", String(WINDOW)], JSON.stringify(argv));
});

test("a legacy --continue Claude launch carries it", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { resume: true }, { appUrl: app.url });
  assert.deepEqual(argv.slice(0, 3), ["--continue", "--autocompact", String(WINDOW)], JSON.stringify(argv));
});

test("a worktree (second live session) Claude launch carries it too", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT, worktree: true }, { appUrl: app.url });
  assert.ok(argv.includes("--worktree"), JSON.stringify(argv));
  assert.equal(argv[argv.indexOf("--autocompact") + 1], String(WINDOW), JSON.stringify(argv));
  assert.equal(argv[argv.length - 1], PROMPT);
});

test("an old Claude Code (2.1.220) gets no flag, and still launches", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url, claudeVersion: "2.1.220 (Claude Code)" });
  assert.ok(!argv.includes("--autocompact"), JSON.stringify(argv));
  assert.equal(argv[argv.length - 1], PROMPT);
});

test("an unreadable Claude version gets no flag", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url, claudeVersion: "no idea" });
  assert.ok(!argv.includes("--autocompact"), JSON.stringify(argv));
});

test("a bad value (string, out of range, fraction) gets no flag", { timeout: 60000 }, async (t) => {
  for (const bad of ["300k", 50, 5000000, 1.5]) {
    const app = await startFakeApp({ extra: { autoCompactWindow: bad } });
    const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url });
    await app.close();
    assert.ok(!argv.includes("--autocompact"), `${bad}: ${JSON.stringify(argv)}`);
  }
});

test("no value from the app -> today's launch", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url });
  assert.ok(!argv.includes("--autocompact"), JSON.stringify(argv));
});

test("app unreachable: still launches, without the flag", { timeout: 60000 }, async (t) => {
  const argv = await launch(t, { resumeId: RESUME_ID }, { appUrl: "http://127.0.0.1:1" });
  assert.deepEqual(argv, ["--resume", RESUME_ID]);
});

test("Codex fresh: -c model_auto_compact_token_limit=N, prompt last", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: 150000 } }); t.after(app.close);
  const argv = await launch(t, { agent: "codex", prompt: PROMPT }, { appUrl: app.url });
  const i = argv.indexOf("model_auto_compact_token_limit=150000");
  assert.ok(i > 0, JSON.stringify(argv));
  assert.equal(argv[i - 1], "-c");
  assert.equal(argv[argv.length - 1], PROMPT);
  assert.ok(!argv.includes("--autocompact"));
});

test("Codex resume --last and resume <id> carry it", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: 100000 } }); t.after(app.close);
  const last = await launch(t, { agent: "codex", resume: true }, { appUrl: app.url });
  assert.deepEqual(last.slice(0, 2), ["resume", "--last"]);
  assert.ok(last.includes("model_auto_compact_token_limit=100000"), JSON.stringify(last));
  const byId = await launch(t, { agent: "codex", resumeId: RESUME_ID }, { appUrl: app.url });
  assert.deepEqual(byId.slice(0, 2), ["resume", RESUME_ID]);
  assert.ok(byId.includes("model_auto_compact_token_limit=100000"), JSON.stringify(byId));
});

test("Codex with no value (the recommended default) adds nothing", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp(); t.after(app.close);
  const argv = await launch(t, { agent: "codex", prompt: PROMPT }, { appUrl: app.url });
  assert.ok(!argv.some((a) => a.includes("auto_compact")), JSON.stringify(argv));
});

test("an agents body is still delivered alongside the flag (Claude)", { timeout: 60000 }, async (t) => {
  const app = await startFakeApp({ extra: { autoCompactWindow: WINDOW } }); t.after(app.close);
  const argv = await launch(t, { prompt: PROMPT }, { appUrl: app.url });
  assert.deepEqual(Object.keys(agentsJsonOf(argv) ?? {}), [AGENT_NAME]);
});
