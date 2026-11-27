// What the REAL launch line holds (card 9b5336c1, rework).
//
// Starts the bridge the way the helper does (forked, with an IPC channel, via
// mini-parent.mjs), so same-Mac messaging and its hooks are on, with a fake
// claude/codex that prints its arguments. Checks:
//   - the launch line carries no hook secret, none of the messaging note's
//     words, no agent prompt words and no "curl" (so `pkill -f curl`,
//     `pkill -f <note word>` cannot match the session), both as the agent was
//     given it and as `ps` shows it;
//   - the settings / note / curl-config files are owner-only (0600) inside an
//     owner-only (0700) folder, and the folder is gone when the session ends.
// Same-Mac messaging is macOS-only (sameMachineMessagesSupported), so this is
// skipped elsewhere.
//
// Run: cd terminal/test && node --test peer-launch-files.test.mjs

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
import { writeFakeAgent, killBridge, rmDir } from "./fake-agent.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const MINI_PARENT = path.resolve(__dirname, "./mini-parent.mjs");
const AGENT_SCRIPT = path.resolve(__dirname, "./peer-launch-cmd.mjs");
const SECRET = "peer-launch-test-secret";
const AGENTS = { "vc-probe-1234abcd-frontier": { description: "probe", prompt: "You are the zebrafish probe.", model: "opus", effort: "high" } };
// Words from the messaging note and the agent prompt that must never be on a command line.
const READABLE_WORDS = ["VibeCodes app", "Message from session", "never approve", "send <session", "zebrafish", "curl", "content-type", "application/json", "127.0.0.1"];

async function startFakeApp() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/api/terminal/session/agents" ? { agents: AGENTS } : { delivered: false }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
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

const mode = (p) => fs.statSync(p).mode & 0o777;

const PROMPT_TEXT = "Work on card quokka-7731: rename the zanzibar widget.\n\nStep: investigate the marmalade bug.";
const PROMPT_WORDS = ["quokka-7731", "zanzibar", "marmalade"];

async function launchViaHelperFork(t, agent, { prompt } = {}) {
  const app = await startFakeApp();
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "vc-pl-bin-"));
  writeFakeAgent(fakeBin, agent, AGENT_SCRIPT, { version: agent === "claude" ? "2.1.332 (Claude Code)" : "codex-cli 0.169.0" });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "vc-pl-cwd-"));
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-pl-tmp-")));
  const session = `pl-${Math.random().toString(36).slice(2, 8)}`;
  const tokens = await mintSessionTokens({ sub: "user-PL", idea: "idea-PL", sid: session, secret: SECRET });
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, cwd, agent, ...(prompt ? { prompt } : { resumeId: "99999999-8888-7777-6666-555555555555" }) });
  let buf = "";
  const browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d) => (buf += Buffer.isBuffer(d) ? d.toString("utf8") : String(d)));
  await once(browser, "open");
  let parentOut = "";
  const parent = spawn(process.execPath, [MINI_PARENT, BRIDGE_ENTRY, ...(prompt ? [] : ["--launch-url", launchUrl])], {
    // With a prompt the link travels in the environment, exactly as the helper hands it over.
    env: { ...(prompt ? { BRIDGE_LAUNCH_URL: launchUrl } : {}), PATH: [fakeBin, process.env.PATH].join(path.delimiter), HOME: process.env.HOME, SHELL: "/usr/bin/false", TMPDIR: tmp, BRIDGE_MAX_SECONDS: "60", TERMINAL_APP_URL: app.url },
    stdio: ["ignore", "pipe", "ignore"],
  });
  parent.stdout.on("data", (d) => (parentOut += d));
  const lines = () => parentOut.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  t.after(async () => {
    try { browser.terminate(); } catch { /* ignore */ }
    const bp = lines().find((m) => m.type === "bridge-pid")?.pid;
    if (bp) { try { process.kill(bp, "SIGKILL"); } catch { /* gone */ } }
    killBridge(parent);
    await relay.close();
    await app.close();
    rmDir(fakeBin); rmDir(cwd); rmDir(tmp);
  });
  await waitForText(() => buf, "ENV_END", 20000);
  const argv = JSON.parse(buf.match(/ARGV_BEGIN(.*?)ARGV_END/s)[1]);
  const env = JSON.parse(buf.match(/ENV_BEGIN(.*?)ENV_END/s)[1]);
  await waitForText(() => parentOut, "pty-pid", 5000);
  const agentPid = lines().find((m) => m.type === "pty-pid").pid;
  const bridgePid = lines().find((m) => m.type === "bridge-pid").pid;
  // The launch line as `ps` shows it to every account on the Mac.
  const psLine = execFileSync("ps", ["-ww", "-o", "args=", "-p", String(agentPid)], { encoding: "utf8" });
  const bridgePsLine = execFileSync("ps", ["-ww", "-o", "args=", "-p", String(bridgePid)], { encoding: "utf8" });
  return { argv, env, psLine, bridgePsLine, launchUrl, tmp, bridgePid, parent };
}

const agentFolders = (tmp) => fs.readdirSync(tmp).filter((n) => n.startsWith("vibecodes-agents-"));

async function endAndCheckFolderGone(h) {
  process.kill(h.bridgePid, "SIGTERM");
  const deadline = Date.now() + 10000;
  while (agentFolders(h.tmp).length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(agentFolders(h.tmp), [], "the private folder is removed when the session ends");
}

function assertLineIsClean(h, secrets) {
  const line = h.argv.join(" ");
  for (const text of [line, h.psLine]) {
    for (const w of READABLE_WORDS) assert.ok(!text.toLowerCase().includes(w.toLowerCase()), `launch line must not contain ${JSON.stringify(w)}`);
    for (const s of secrets) assert.ok(!text.includes(s), "launch line must not contain the hook secret");
  }
}

const skip = process.platform !== "darwin" && "same-Mac messaging (and its hooks) is macOS-only";

test("Claude: launch line has no secret, note, prompt or curl; files are private; folder is removed", { skip, timeout: 60000 }, async (t) => {
  const h = await launchViaHelperFork(t, "claude");
  const si = h.argv.indexOf("--settings");
  const ni = h.argv.indexOf("--append-system-prompt-file");
  assert.ok(si >= 0 && ni >= 0, JSON.stringify(h.argv));
  const settings = h.argv[si + 1];
  const note = h.argv[ni + 1];
  const dir = path.dirname(settings);
  assert.equal(path.dirname(note), dir);
  const secret = new URL(JSON.parse(fs.readFileSync(settings, "utf8")).hooks.Stop[0].hooks[0].url).pathname.split("/")[1];
  assert.match(secret, /^[0-9a-f]{48}$/);
  assertLineIsClean(h, [secret]);
  assert.equal(mode(dir), 0o700);
  for (const f of [settings, note]) assert.equal(mode(f), 0o600);
  assert.match(fs.readFileSync(note, "utf8"), /VibeCodes app/);
  await endAndCheckFolderGone(h);
});

test("Codex: launch line has no secret, note or curl; the env holds a private curl config path; folder is removed", { skip, timeout: 60000 }, async (t) => {
  const h = await launchViaHelperFork(t, "codex");
  assert.ok(h.env.hook && path.isAbsolute(h.env.hook), `env should hold a file path, got ${h.env.hook}`);
  const cfg = fs.readFileSync(h.env.hook, "utf8");
  const secret = cfg.match(/127\.0\.0\.1:\d+\/([0-9a-f]{48})\/hook/)?.[1];
  assert.ok(secret, "the curl config holds the hook address");
  assertLineIsClean(h, [secret]);
  assert.ok(!h.env.hook.includes(secret));
  const dir = path.dirname(h.env.hook);
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(h.env.hook), 0o600);
  // The hook config still reaches Codex (as escapes), approvals included.
  assert.ok(h.argv.some((a) => a.startsWith("hooks.Stop=")));
  assert.ok(h.argv.some((a) => a.startsWith("hooks.state=")));
  assert.ok(h.argv.some((a) => a.startsWith("developer_instructions=")));
  await endAndCheckFolderGone(h);
});

// The starting prompt (card title, text, step) must be on NO command line in the chain: not the agent's, not the
// bridge's. The bridge is started the way the helper starts it (link in the environment) and the agent is fake.
for (const agent of ["claude", "codex"]) {
  test(`${agent}: a link with a starting prompt keeps the prompt and token off the agent's and the bridge's command lines`, { skip, timeout: 60000 }, async (t) => {
    const h = await launchViaHelperFork(t, agent, { prompt: PROMPT_TEXT });
    const token = new URL(h.launchUrl).searchParams.get("token");
    assert.ok(token && token.length > 20, "the test link carries a session token");
    for (const [label, text] of [["agent argv", h.argv.join(" ")], ["agent ps line", h.psLine], ["bridge ps line", h.bridgePsLine]]) {
      for (const w of PROMPT_WORDS) assert.ok(!text.includes(w), `${label} must not contain ${w}: ${text.slice(0, 300)}`);
      assert.ok(!text.includes(token), `${label} must not contain the session token`);
      assert.ok(!text.includes("vibecodes://"), `${label} must not contain the launch link`);
    }
    // The agent is not handed a second copy of the link through its environment either.
    assert.equal(h.env.launchUrl, null, "the agent must not inherit BRIDGE_LAUNCH_URL");
    // The prompt still arrives in full: argv points at a private file that holds it.
    const pointer = h.argv[h.argv.length - 1];
    const file = /file (\S+)\. Read that file in full/.exec(pointer)?.[1];
    assert.ok(file && path.isAbsolute(file), `the last argument should point at the prompt file, got ${pointer}`);
    assert.equal(fs.readFileSync(file, "utf8"), PROMPT_TEXT);
    assert.equal(mode(file), 0o600);
    assert.equal(mode(path.dirname(file)), 0o700);
    if (agent === "claude") assert.ok(h.argv.includes(`--add-dir=${path.dirname(file)}`), "Claude may read the prompt's folder without a permission prompt");
    await endAndCheckFolderGone(h);
  });
}

// The helper (Electron, not startable here) must hand the link to the bridge in the environment, not on its argv.
test("helper: forks the bridge without the launch link on its command line", () => {
  const main = fs.readFileSync(path.resolve(__dirname, "../helper/main.js"), "utf8");
  const forkCall = main.match(/fork\(BRIDGE_ENTRY, (\[[^\]]*\]), \{([\s\S]*?)\n  \}\);/);
  assert.ok(forkCall, "found the bridge fork call");
  assert.doesNotMatch(forkCall[1], /launch-url|rawUrl/, "the bridge's argv must not carry the link");
  assert.match(forkCall[2], /BRIDGE_LAUNCH_URL: rawUrl/, "the link rides in the bridge's environment");
});
