// Manual live check for "Start with Remote Control on" (task 5c8969cc) — NOT in
// the npm test list (same family as verify-lifecycle.mjs). Drives the REAL
// bridge against the Node stand-in relay with a launch link carrying
// `remoteControl=1`, spawning the REAL `claude` on this Mac, and records what
// the browser leg would see.
//
// SAFETY (binding):
//   - never runs the `claude remote-control` SUBCOMMAND (it doesn't exit);
//   - never pkills/killalls anything — only the bridge child THIS script
//     spawned is ever signalled, by PID (the bridge verify-kills its claude);
//   - works in a throwaway git repo with one commit.
//
// Usage (from terminal/test):
//   node verify-remote-control-live.mjs --mode fresh     [--dir <base>] [--keep] [--no-worktree] [--cwd <repo>]
//   node verify-remote-control-live.mjs --mode resume-id --cwd <repo> --resume-id <uuid>
//   node verify-remote-control-live.mjs --mode continue  --cwd <repo>
//   node verify-remote-control-live.mjs --mode api-key   [--dir <base>]
//   node verify-remote-control-live.mjs --mode old-claude [--dir <base>] [--old-version 1.0.100]
//
// Modes (see the task's Technical Design §8):
//   fresh      V4 — prompt "Reply with exactly RC-PROMPT-OK" + model + auto
//              mode + worktree + remoteControl. Pass: a Remote Control banner
//              shows AND the reply contains RC-PROMPT-OK.
//   resume-id  V1 — `--resume <id>` (reuse V4's --session-id) + remoteControl.
//   continue   V1 — `--continue` + remoteControl.
//   api-key    V2 — isolated HOME/CLAUDE_CONFIG_DIR, a placeholder (invalid)
//              ANTHROPIC_API_KEY, no real credentials.
//   old-claude V3 — an old Claude Code (npm, --ignore-scripts) shimmed in as
//              `claude`, isolated HOME/CONFIG as in api-key.
//
// Prints the spawned argv (from the bridge's "spawning PTY" log), an
// ANSI-stripped transcript with claude.ai session ids redacted, and
// `pgrep -fl -- --remote-control` at the end.

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
const SECRET = "verify-remote-control-live-secret";
const PROMPT = "Reply with exactly RC-PROMPT-OK";
const PLACEHOLDER_KEY = "sk-ant-invalid-placeholder";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const MODE = arg("mode");
const BASE = arg("dir", os.tmpdir());
const KEEP = process.argv.includes("--keep");
const MODES = ["fresh", "resume-id", "continue", "api-key", "old-claude"];
if (!MODES.includes(MODE)) {
  console.error(`--mode must be one of ${MODES.join(", ")}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s) =>
  s
     
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
     
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
     
    .replace(/\x1b[@-_]/g, "");
const redact = (s) => s.replace(/session_[A-Za-z0-9_-]+/g, "session_***");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(BASE, "vc-rc-live-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  fs.writeFileSync(path.join(dir, "README"), "remote control live check\n");
  execFileSync("git", ["-C", dir, "add", "README"]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  return dir;
}

/** Isolated HOME + CLAUDE_CONFIG_DIR with onboarding pre-completed, so the
 *  placeholder key's own prompts (and the folder-trust dialog) don't hide
 *  what Remote Control does. */
function makeIsolatedHome(cwd) {
  const home = fs.mkdtempSync(path.join(BASE, "vc-rc-live-home-"));
  const config = path.join(home, ".claude-config");
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(
    path.join(config, ".claude.json"),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: "dark",
      customApiKeyResponses: { approved: [PLACEHOLDER_KEY.slice(-20)], rejected: [] },
      // Pre-trust the throwaway repo in this isolated config only.
      projects: { [cwd]: { hasTrustDialogAccepted: true }, [fs.realpathSync(cwd)]: { hasTrustDialogAccepted: true } },
    }),
  );
  return { home, config };
}

function realClaudeDir() {
  return path.dirname(execFileSync("/bin/sh", ["-lc", "command -v claude"], { encoding: "utf8" }).trim());
}

function installOldClaude(version) {
  const prefix = fs.mkdtempSync(path.join(BASE, "vc-rc-old-claude-"));
  execFileSync("npm", ["i", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", `@anthropic-ai/claude-code@${version}`], {
    stdio: "inherit",
  });
  const cli = path.join(prefix, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  const bin = fs.mkdtempSync(path.join(BASE, "vc-rc-old-claude-bin-"));
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`, { mode: 0o755 });
  return { prefix, bin, cli };
}

async function main() {
  const cleanup = [];
  const cwd = arg("cwd") || makeRepo();
  if (!arg("cwd") && !KEEP) cleanup.push(cwd);

  const link = { remoteControl: true };
  // The user's normal environment (USER/LOGNAME matter: Claude Code reads its
  // login from the macOS keychain by account name), minus anything inherited
  // from a Claude Code session running this script (the spawned claude would
  // think it's nested) or from a packaged helper that launched that session
  // (VIBECODES_PACKAGED=1 makes this bridge refuse the loopback stand-in relay).
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(CLAUDE|ANTHROPIC|BRIDGE_|VIBECODES_|ELECTRON_)/.test(k),
    ),
  );
  Object.assign(env, { BRIDGE_MAX_SECONDS: "240", TERMINAL_APP_URL: "http://127.0.0.1:1" });
  let versionCmd = ["claude", "--version"];

  // --no-worktree: a brand-new throwaway repo hasn't been trusted yet, and
  // `claude --worktree` refuses an untrusted folder ("Workspace trust not yet
  // accepted"). Run once without it (accepting the trust prompt), then again
  // with --cwd <same repo> for the full combination.
  if (MODE === "fresh") {
    Object.assign(link, {
      prompt: PROMPT,
      model: "sonnet",
      permissionMode: "auto",
      worktree: !process.argv.includes("--no-worktree"),
    });
  }
  if (MODE === "resume-id") {
    const id = arg("resume-id");
    if (!id) throw new Error("--resume-id <uuid> is required for resume-id mode");
    link.resumeId = id;
  }
  if (MODE === "continue") link.resume = true;
  if (MODE === "api-key" || MODE === "old-claude") {
    const { home, config } = makeIsolatedHome(cwd);
    cleanup.push(home);
    Object.assign(env, {
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      ANTHROPIC_API_KEY: PLACEHOLDER_KEY,
      // Defeat the bridge's login-shell PATH capture (it would read the
      // isolated HOME) so the PATH below wins.
      SHELL: "/usr/bin/false",
    });
    let claudeDir = realClaudeDir();
    if (MODE === "old-claude") {
      const old = installOldClaude(arg("old-version", "1.0.100"));
      cleanup.push(old.prefix, old.bin);
      claudeDir = old.bin;
      versionCmd = [path.join(old.bin, "claude"), "--version"];
    }
    env.PATH = `${claudeDir}:${process.env.PATH}`;
    link.prompt = PROMPT;
  }

  let claudeVersion = "";
  try {
    claudeVersion = execFileSync(versionCmd[0], versionCmd.slice(1), { encoding: "utf8", env: { ...process.env, ...env } }).trim();
  } catch (e) {
    claudeVersion = `(--version failed: ${String(e.message).split("\n")[0]})`;
  }

  const session = `rc-live-${Math.random().toString(36).slice(2, 8)}`;
  const tokens = await mintSessionTokens({ sub: "rc-live-user", idea: "rc-live-idea", sid: session, secret: SECRET });
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, cwd, cols: 160, rows: 45, ...link });

  let stream = "";
  const browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d) => {
    stream += Buffer.isBuffer(d) ? d.toString("utf8") : String(d);
  });
  await once(browser, "open");
  const send = (s) => browser.send(Buffer.from(s, "utf8"), { binary: true });

  let stderr = "";
  const bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--launch-url", launchUrl], { env, stdio: ["ignore", "pipe", "pipe"] });
  bridge.stdout.setEncoding("utf8");
  bridge.stderr.setEncoding("utf8");
  bridge.stderr.on("data", (d) => (stderr += d));
  let bridgeExited = false;
  bridge.on("exit", () => (bridgeExited = true));

  const text = () => stripAnsi(stream);
  const until = async (pred, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms && !bridgeExited) {
      if (pred()) return true;
      await sleep(250);
    }
    return pred();
  };

  // Accept the folder-trust prompt once, if it appears. Claude Code 2.1.x
  // preselects "No, exit", so move down to "Yes, I trust this folder" first.
  if (await until(() => /trust/i.test(text()) || /remote.?control/i.test(text()), 30000)) {
    if (/trust/i.test(text()) && !/remote.?control/i.test(text())) {
      send("\x1b[B");
      await sleep(400);
      send("\r");
      // A fresh config can drop the first Enter; if the dialog is still the
      // last thing drawn after a moment, confirm once more.
      await sleep(2500);
      const tail = text().slice(-400);
      if (/trust this folder/i.test(tail) && !bridgeExited) {
        console.log("[verify] trust dialog still showing — confirming again");
        send("\r");
      }
    }
  }
  // "Remote Control is active" (Claude Code 2.1.x prints "/remote-control is
  // active · Continue here, on your phone, or at https://claude.ai/code/…").
  const RC_ACTIVE = /remote.?control\s*is\s*active/i;
  const sawRc = await until(() => RC_ACTIVE.test(text()), 60000);
  let sawReply = null;
  // The reply, not the echoed prompt ("…exactly RC-PROMPT-OK").
  if (MODE === "fresh") sawReply = await until(() => /(?<!exactly\s?)RC-PROMPT-OK/.test(text()), 90000);
  else await sleep(4000); // let any sign-in / error message render

  if (!bridgeExited) {
    send("/exit");
    await sleep(600);
    send("\r");
    await until(() => false, 15000);
  }
  if (!bridgeExited) {
    console.log(`[verify] bridge (pid ${bridge.pid}) still running after /exit — SIGTERM to that pid only`);
    bridge.kill("SIGTERM");
    await sleep(3000);
  }
  try { browser.terminate(); } catch { /* ignore */ }
  await relay.close();

  const argvLine = stderr.split("\n").find((l) => l.includes("spawning PTY")) || "(no spawning PTY log line)";
  const sessionIdMatch = argvLine.match(/--session-id","([0-9a-f-]{36})"/);
  let pgrep = "";
  try {
    pgrep = execFileSync("pgrep", ["-fl", "--", "--remote-control"], { encoding: "utf8" }).trim();
  } catch {
    pgrep = "(empty)";
  }

  console.log("\n===== verify-remote-control-live =====");
  console.log("date:", new Date().toISOString());
  console.log("mode:", MODE);
  console.log("claude --version:", claudeVersion);
  console.log("cwd:", cwd);
  console.log("spawn log:", argvLine.trim());
  if (!argvLine.includes("spawning PTY")) console.log("bridge stderr tail:\n" + stderr.slice(-2000));
  if (sessionIdMatch) console.log("session id (for resume-id):", sessionIdMatch[1]);
  console.log("Remote Control active line seen:", sawRc);
  const activeLine = redact(text()).match(/[^\n]{0,40}remote.?control\s*is\s*active[^\n]{0,90}/i);
  if (activeLine) console.log("active line:", activeLine[0]);
  if (sawReply !== null) console.log("RC-PROMPT-OK reply seen:", sawReply);
  console.log("bridge exited on its own / after /exit:", bridgeExited);
  console.log("----- transcript (ANSI-stripped, redacted, last 6000 chars) -----");
  console.log(redact(text()).replace(/\r/g, "").slice(-6000));
  console.log("----- pgrep -fl -- --remote-control -----");
  console.log(pgrep);

  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("[verify] failed:", err);
  process.exit(1);
});
