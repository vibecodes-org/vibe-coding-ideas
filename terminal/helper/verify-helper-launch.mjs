// Slice-7 proof: a real `vibecodes://launch?…` URL drives the HELPER → live relay.
//
// This exercises the exact production path the OS will trigger after the signed
// install — minus the OS Apple-Event delivery (only a signed install can confirm
// the "verified" Gatekeeper badge + Finder-delivered open-url). Here we hand the
// link to the Electron helper on the command line (the same code path the helper's
// cold-launch argv handler runs), and assert the round-trip through the LIVE relay.
//
//   helper (Electron) --fork--> bridge --node-pty PTY--> sentinel
//        |                                                   |
//        +--ws--> LIVE relay (Cloudflare DO) <--ws-- browser leg (this script)
//
// We mint owner-bound tokens with the SAME secret the deployed relay verifies with
// (terminal/relay/.dev.vars → TERMINAL_SESSION_SECRET) and use a non-interactive
// sentinel command (via the bridge's BRIDGE_CMD env seam) instead of interactive
// `claude`, so the byte round-trip is deterministic.
//
// Usage:
//   cd terminal/helper && npm install && node verify-helper-launch.mjs
//   (override the relay with RELAY_URL=..., or the secret with TERMINAL_SESSION_SECRET=...)

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { buildLaunchDeepLink, redactDeepLinkToken } from "../shared/deep-link.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");

// ws + electron come from the bridge / helper node_modules respectively.
const WebSocket = require(path.join(REPO, "terminal/bridge/node_modules/ws"));
const electronBin = require(path.join(__dirname, "node_modules/electron")); // exports the binary path

const MAIN = path.join(__dirname, "main.js");
const SENTINEL = path.resolve(REPO, "terminal/test/sentinel-cmd.mjs");
const RELAY_URL =
  process.env.RELAY_URL || "wss://vibecodes-terminal-relay.nicholasmball.workers.dev";
const HARD_TIMEOUT_MS = 30000;
const session = `helper-verify-${Math.random().toString(36).slice(2, 8)}`;
const owner = `helper-user-${Math.random().toString(36).slice(2, 8)}`;

function readSecret() {
  if (process.env.TERMINAL_SESSION_SECRET) return process.env.TERMINAL_SESSION_SECRET;
  const devVars = path.resolve(REPO, "terminal/relay/.dev.vars");
  const txt = fs.readFileSync(devVars, "utf8");
  const m = txt.match(/^TERMINAL_SESSION_SECRET\s*=\s*(.+)\s*$/m);
  if (!m) throw new Error("TERMINAL_SESSION_SECRET not found in terminal/relay/.dev.vars");
  return m[1].trim().replace(/^['"]|['"]$/g, "");
}

function waitForText(getBuf, text, ms, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (getBuf().includes(text)) { clearInterval(iv); resolve(Date.now() - started); }
      else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`timeout waiting for ${label}`)); }
    }, 25);
  });
}

let helper, browser;
function cleanup() {
  try { browser?.terminate(); } catch { /* ignore */ }
  if (helper && helper.exitCode === null) helper.kill("SIGKILL");
}

try {
  const SECRET = readSecret();
  console.log(`[verify] relay   = ${RELAY_URL}`);
  console.log(`[verify] session = ${session}`);

  const tokens = await mintSessionTokens({ sub: owner, idea: "helper-idea", sid: session, secret: SECRET });

  // (1) Attach the browser leg to the LIVE relay and wait for it to open.
  let browserBuf = "";
  browser = new WebSocket(`${RELAY_URL}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d) => { browserBuf += Buffer.isBuffer(d) ? d.toString("utf8") : String(d); });
  await Promise.race([
    once(browser, "open"),
    new Promise((_, r) => setTimeout(() => r(new Error("browser open timeout")), 8000)),
  ]);
  console.log("[verify] browser leg connected to LIVE relay");

  // (2) Build the real deep link and hand it to the HELPER on the command line
  //     (same path the helper's cold-launch argv handler runs on a real OS click).
  const launchUrl = buildLaunchDeepLink({
    relay: RELAY_URL,
    session,
    token: tokens.bridge,
    cwd: REPO,
  });
  console.log(`[verify] launch url = ${redactDeepLinkToken(launchUrl)}`);

  // By default drive `electron main.js` (dev path). HELPER_BIN lets us instead
  // drive the packaged .app binary, exercising the app.isPackaged Resources path.
  const [bin, binArgs] = process.env.HELPER_BIN
    ? [process.env.HELPER_BIN, [launchUrl]]
    : [electronBin, [MAIN, launchUrl]];
  const helperEnv = {
    ...process.env,
    BRIDGE_CMD: `${process.execPath} ${SENTINEL}`,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  };
  // The verify script must NEVER alter the OS vibecodes:// handler — strip any inherited opt-in.
  delete helperEnv.VIBECODES_DEV_PROTO_REG;
  helper = spawn(bin, binArgs, {
    // Test seam: the bridge runs the sentinel instead of interactive `claude`.
    env: helperEnv,
    stdio: ["ignore", "inherit", "inherit"],
  });

  // (3) The helper forks the bridge, which spawns the PTY and dials the live relay.
  //     The browser leg should receive the sentinel's "READY" banner.
  const tReady = await waitForText(() => browserBuf, "READY", HARD_TIMEOUT_MS, "PTY sentinel via helper");
  console.log(`[verify] (a) PASS — helper -> bridge -> PTY -> LIVE relay -> browser saw "READY" in ${tReady}ms`);

  // (4) Round-trip: browser -> relay -> PTY stdin -> sentinel echo -> back to browser.
  const ping = `PING-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  browserBuf = "";
  browser.send(Buffer.from(ping + "\n", "utf8"), { binary: true });
  const tEcho = await waitForText(() => browserBuf, ping, HARD_TIMEOUT_MS, "PTY echo");
  console.log(`[verify] (b) PASS — full byte round-trip of ${ping} via the helper in ${tEcho}ms`);

  console.log("[verify] ALL ASSERTIONS PASSED — vibecodes://launch drove the helper to the live relay");
  cleanup();
  setTimeout(() => process.exit(0), 200).unref();
} catch (e) {
  console.error("[verify] FAILED:", e.message);
  cleanup();
  setTimeout(() => process.exit(1), 200).unref();
}
