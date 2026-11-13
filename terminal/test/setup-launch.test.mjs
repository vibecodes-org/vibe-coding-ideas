// In-app setup (card 63a60792) — real-process proof that a `setup=` launch link
// runs ONLY the fixed installer / sign-in, only after the relay has confirmed
// the owner-bound token, and ends with the reason the page turns into a screen.
//
// A temp HOME stands in for the Mac, the stand-in relay for the relay. A fake
// `curl` first on PATH stands in for the maker's installer download (it prints a
// tiny script that drops a fake agent into ~/.local/bin), and fake `codex` /
// `claude` scripts answer the sign-in status checks. Nothing touches the network
// or a real sign-in.
//
//   1 — install, agent missing → the installer runs, the agent appears → setup-installed
//   2 — install that leaves no agent behind → setup-install-failed:<code>
//   3 — install, agent already there → installer skipped (never ran curl)
//   4 — sign-in, signed in afterwards → setup-signed-in (Codex, device-code variant too)
//   5 — sign-in that doesn't end signed in → setup-signin-failed:<code>
//   6 — Claude sign-in/status uses `auth login` / `auth status --json`
//   7 — sign-in with the agent missing → agent-not-installed, nothing run
//   8 — a bad token → nothing runs at all
//   9 — a link that also carries a prompt, folder and resume id still runs only setup
//
// Run: cd terminal/test && VIBECODES_PACKAGED= node --test setup-launch.test.mjs

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { buildLaunchDeepLink } from "../shared/deep-link.mjs";


// Skipped on Windows, reason: these tests drive the Mac in-app setup, a POSIX shell installer using curl, chmod and sh scripts; setup on Windows is built in release 1c and gets its own tests there
const SKIP_WIN = process.platform === "win32" && 'these tests drive the Mac in-app setup, a POSIX shell installer using curl, chmod and sh scripts; setup on Windows is built in release 1c and gets its own tests there';
const test = (name, ...rest) => {
  if (!SKIP_WIN) return nodeTest(name, ...rest);
  const opts = typeof rest[0] === "function" ? {} : rest[0];
  const fn = typeof rest[0] === "function" ? rest[0] : rest[1];
  return nodeTest(name, { ...opts, skip: SKIP_WIN }, fn);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SECRET = "setup-launch-test-secret";

function tmpDir(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeExe(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** A fake agent: `login status` / `auth status --json` answer `statusExit`; everything else exits `otherExit`. */
function agentScript(name, { statusExit, otherExit = 0, home }) {
  const status =
    name === "claude"
      ? `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn": ${statusExit === 0 ? "true" : "false"}}'; exit 0; fi`
      : `if [ "$1" = "login" ] && [ "$2" = "status" ]; then exit ${statusExit}; fi`;
  return `echo "$@" >> "${home}/${name}-args.log"\n${status}\necho "fake ${name} running: $@"\nexit ${otherExit}`;
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

async function launch(t, { home, binDir, link, badToken = false }) {
  const session = `su-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-SU-" + Math.random().toString(36).slice(2, 8);
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-SU", sid: session, secret: SECRET });
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  let buf = "";
  const browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d) => (buf += Buffer.isBuffer(d) ? d.toString("utf8") : String(d)));
  await once(browser, "open");
  const launchUrl = buildLaunchDeepLink({
    relay: relay.url,
    session,
    token: badToken ? "not-a-real-token" : tokens.bridge,
    ...link,
  });
  let stderr = "";
  const bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--launch-url", launchUrl], {
    cwd: home,
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      SHELL: "/usr/bin/false",
      BRIDGE_MAX_SECONDS: "120",
      TERMINAL_APP_URL: "http://127.0.0.1:9",
    },
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
    getStderr: () => stderr,
    shutdownWhy: () => stderr.match(/"msg":"shutting down","why":"([^"]*)"/)?.[1] ?? null,
  };
}

/** Fake `curl` that prints an installer script which drops a fake codex into ~/.local/bin. */
function fakeCurl(binDir, home, { dropAgent }) {
  writeExe(
    path.join(binDir, "curl"),
    `echo curl >> "${home}/curl.log"\n` +
      (dropAgent
        ? `cat <<'SCRIPT'\nmkdir -p "$HOME/.local/bin"\ncat > "$HOME/.local/bin/codex" <<'AGENT'\n#!/bin/sh\nif [ "$1" = "login" ] && [ "$2" = "status" ]; then exit 1; fi\nexit 0\nAGENT\nchmod +x "$HOME/.local/bin/codex"\necho "Installing to ~/.local/bin/codex"\nSCRIPT\n`
        : `exit 6\n`),
  );
}

test("1: install with the agent missing → the installer runs and the agent appears → setup-installed", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  fakeCurl(binDir, home, { dropAgent: true });
  const run = await launch(t, { home, binDir, link: { agent: "codex", setup: "install" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.equal(run.shutdownWhy(), "setup-installed", run.getStderr());
  assert.match(run.getBuf(), /Installing Codex with OpenAI's installer\./);
  assert.match(run.getBuf(), /Running: curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh/);
  assert.match(run.getBuf(), /Installing to ~\/\.local\/bin\/codex/);
  assert.match(run.getBuf(), /Codex is installed\./);
  assert.ok(fs.existsSync(path.join(home, ".local", "bin", "codex")), "the fake installer ran in the temp home");
});

test("2: an install that leaves no agent behind → setup-install-failed", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  fakeCurl(binDir, home, { dropAgent: false });
  const run = await launch(t, { home, binDir, link: { agent: "codex", setup: "install" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.match(run.shutdownWhy() ?? "", /^setup-install-failed:\d+$/, run.getStderr());
  assert.doesNotMatch(run.getBuf(), /is installed\./);
});

test("3: install when the agent is already there → the installer is skipped", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  fakeCurl(binDir, home, { dropAgent: true });
  writeExe(path.join(binDir, "codex"), agentScript("codex", { statusExit: 1, home }));
  const run = await launch(t, { home, binDir, link: { agent: "codex", setup: "install" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.equal(run.shutdownWhy(), "setup-installed", run.getStderr());
  assert.ok(!fs.existsSync(path.join(home, "curl.log")), "the installer must not run");
});

test("3b: install when the agent is already installed AND signed in → setup-signed-in", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  writeExe(path.join(binDir, "codex"), agentScript("codex", { statusExit: 0, home }));
  const run = await launch(t, { home, binDir, link: { agent: "codex", setup: "install" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.equal(run.shutdownWhy(), "setup-signed-in", run.getStderr());
});

test("4: Codex sign-in that ends signed in → setup-signed-in (and the code variant adds --device-auth)", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  writeExe(path.join(binDir, "codex"), agentScript("codex", { statusExit: 0, home }));
  const run = await launch(t, { home, binDir, link: { agent: "codex", setup: "signin" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.equal(run.shutdownWhy(), "setup-signed-in", run.getStderr());
  assert.match(run.getBuf(), /Signing in to Codex\./);
  assert.match(run.getBuf(), /Signed in to Codex\./);
  const argsLog = fs.readFileSync(path.join(home, "codex-args.log"), "utf8");
  assert.match(argsLog, /^login$/m);

  const home2 = tmpDir(t, "vc-su-home-");
  writeExe(path.join(binDir, "codex"), agentScript("codex", { statusExit: 0, home: home2 }));
  const run2 = await launch(t, { home: home2, binDir, link: { agent: "codex", setup: "signin-code" } });
  await waitFor(() => run2.bridge.exitCode !== null || run2.shutdownWhy() !== null, 40000, "the code sign-in to end");
  assert.equal(run2.shutdownWhy(), "setup-signed-in", run2.getStderr());
  assert.match(fs.readFileSync(path.join(home2, "codex-args.log"), "utf8"), /^login --device-auth$/m);
});

test("5: a sign-in that doesn't end signed in → setup-signin-failed", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  writeExe(path.join(binDir, "codex"), agentScript("codex", { statusExit: 1, home }));
  const run = await launch(t, { home, binDir, link: { agent: "codex", setup: "signin" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.match(run.shutdownWhy() ?? "", /^setup-signin-failed:\d+$/, run.getStderr());
});

test("6: Claude Code sign-in uses `auth login` and reads `auth status --json`", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  writeExe(path.join(binDir, "claude"), agentScript("claude", { statusExit: 0, home }));
  const run = await launch(t, { home, binDir, link: { setup: "signin" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.equal(run.shutdownWhy(), "setup-signed-in", run.getStderr());
  assert.match(run.getBuf(), /Signing in to Claude Code\./);
  assert.match(fs.readFileSync(path.join(home, "claude-args.log"), "utf8"), /^auth login$/m);
});

test("7: sign-in with the agent missing → agent-not-installed, nothing run", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  const run = await launch(t, { home, binDir, link: { agent: "codex", setup: "signin" } });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.equal(run.shutdownWhy(), "agent-not-installed", run.getStderr());
  assert.match(run.getBuf(), /Codex isn't installed on this Mac/);
});

test("8: a bad token runs nothing at all (R1 gate)", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  fakeCurl(binDir, home, { dropAgent: true });
  const run = await launch(t, { home, binDir, badToken: true, link: { agent: "codex", setup: "install" } });
  await waitFor(() => run.bridge.exitCode !== null, 40000, "the bridge to exit");
  assert.ok(!fs.existsSync(path.join(home, "curl.log")), "the installer must never run");
  assert.ok(!fs.existsSync(path.join(home, ".local", "bin", "codex")));
  assert.doesNotMatch(run.getStderr(), /spawning setup PTY/);
});

test("9: a link that also carries a prompt, folder and resume id still runs only setup", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-su-home-");
  const binDir = tmpDir(t, "vc-su-bin-");
  writeExe(path.join(binDir, "codex"), agentScript("codex", { statusExit: 0, home }));
  const run = await launch(t, {
    home,
    binDir,
    link: {
      agent: "codex",
      setup: "signin",
      prompt: "rm -rf ~",
      cwd: "/tmp",
      resumeId: "11111111-1111-4111-8111-111111111111",
      model: "gpt-x",
    },
  });
  await waitFor(() => run.bridge.exitCode !== null || run.shutdownWhy() !== null, 40000, "the setup session to end");
  assert.equal(run.shutdownWhy(), "setup-signed-in", run.getStderr());
  const argsLog = fs.readFileSync(path.join(home, "codex-args.log"), "utf8").trim().split("\n");
  assert.ok(argsLog.every((l) => l === "login" || l === "login status"), `only login / login status ran: ${argsLog}`);
});
