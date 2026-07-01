// Manual verification against an EXTERNALLY-running relay (e.g. `wrangler dev`).
// Unlike roundtrip.test.mjs (which starts the Node stand-in), this points the
// bridge + browser legs at whatever RELAY_URL you give it — used to prove the
// real Cloudflare Worker + Durable Object, now WITH owner-bound auth (slice 2).
//
//   cd terminal/relay && npx wrangler dev          # terminal 1 (loads .dev.vars)
//   TERMINAL_SESSION_SECRET=<same-as-.dev.vars> \
//     RELAY_URL=ws://127.0.0.1:8787 node ../test/verify-against-relay.mjs   # terminal 2
//
// The SECRET here must match the relay's TERMINAL_SESSION_SECRET (in .dev.vars).
// Exits 0 on success, non-zero on any failure. Hard timeouts throughout.

import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { mintSessionTokens, signToken } from "../shared/session-token.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SENTINEL = path.resolve(__dirname, "./sentinel-cmd.mjs");
const RELAY_URL = process.env.RELAY_URL || "ws://127.0.0.1:8787";
const SECRET = process.env.TERMINAL_SESSION_SECRET;
const HARD_TIMEOUT_MS = 20000;
const session = `verify-${Math.random().toString(36).slice(2, 8)}`;
const ownerA = `userA-${Math.random().toString(36).slice(2, 8)}`;
const ownerB = `userB-${Math.random().toString(36).slice(2, 8)}`;

if (!SECRET) {
  console.error("[verify] set TERMINAL_SESSION_SECRET to match the relay's .dev.vars");
  process.exit(2);
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

let bridge, browser;
function cleanup() {
  try { browser?.terminate(); } catch { /* ignore */ }
  if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
}

try {
  console.log(`[verify] relay = ${RELAY_URL}  session = ${session}`);

  const tokensA = await mintSessionTokens({ sub: ownerA, idea: "idea-X", sid: session, secret: SECRET });

  let browserBuf = "";
  browser = new WebSocket(`${RELAY_URL}/?session=${session}&role=browser&token=${encodeURIComponent(tokensA.browser)}`);
  browser.on("message", (d) => { browserBuf += Buffer.isBuffer(d) ? d.toString("utf8") : String(d); });
  await Promise.race([
    once(browser, "open"),
    new Promise((_, r) => setTimeout(() => r(new Error("browser open timeout")), 5000)),
  ]);
  console.log("[verify] browser leg connected (authenticated)");

  bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--cmd", `${process.execPath} ${SENTINEL}`], {
    env: { ...process.env, RELAY_URL, SESSION_ID: session, BRIDGE_TOKEN: tokensA.bridge, BRIDGE_MAX_SECONDS: "60" },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const tReady = await waitForText(() => browserBuf, "READY", HARD_TIMEOUT_MS, "PTY sentinel");
  console.log(`[verify] (a) PASS — browser received "READY" via real DO in ${tReady}ms`);

  const token = `PING-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  browserBuf = "";
  browser.send(Buffer.from(token + "\n", "utf8"), { binary: true });
  const tEcho = await waitForText(() => browserBuf, token, HARD_TIMEOUT_MS, "PTY echo");
  console.log(`[verify] (b) PASS — round-trip of ${token} via real DO in ${tEcho}ms`);

  // (c) single-attach: a 2nd browser with the SAME owner's valid token is refused.
  {
    const second = new WebSocket(`${RELAY_URL}/?session=${session}&role=browser&token=${encodeURIComponent(tokensA.browser)}`);
    const [code, reasonBuf] = await Promise.race([
      once(second, "close"),
      new Promise((_, r) => setTimeout(() => r(new Error("2nd browser close timeout")), 5000)),
    ]);
    const reason = reasonBuf ? reasonBuf.toString() : "";
    if (code !== 4001) throw new Error(`expected close 4001, got ${code} (${reason})`);
    console.log(`[verify] (c) PASS — 2nd browser (same user) rejected: code=${code} reason=${JSON.stringify(reason)}`);
  }

  // (d) owner-mismatch: a browser with a DIFFERENT user's valid token is refused.
  {
    const tokensB = await mintSessionTokens({ sub: ownerB, idea: "idea-X", sid: session, secret: SECRET });
    const foreign = new WebSocket(`${RELAY_URL}/?session=${session}&role=browser&token=${encodeURIComponent(tokensB.browser)}`);
    const [code, reasonBuf] = await Promise.race([
      once(foreign, "close"),
      new Promise((_, r) => setTimeout(() => r(new Error("foreign browser close timeout")), 5000)),
    ]);
    const reason = reasonBuf ? reasonBuf.toString() : "";
    if (code !== 4005) throw new Error(`expected close 4005 (owner mismatch), got ${code} (${reason})`);
    console.log(`[verify] (d) PASS — different-user browser rejected by real DO: code=${code} reason=${JSON.stringify(reason)}`);
  }

  // (e) expired token: refused with BAD_TOKEN.
  {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const expired = await signToken(
      { sub: ownerA, sid: session, idea: "idea-X", role: "browser", iat: past, exp: past + 60 },
      SECRET,
    );
    const stale = new WebSocket(`${RELAY_URL}/?session=${session}&role=browser&token=${encodeURIComponent(expired)}`);
    const [code, reasonBuf] = await Promise.race([
      once(stale, "close"),
      new Promise((_, r) => setTimeout(() => r(new Error("expired browser close timeout")), 5000)),
    ]);
    const reason = reasonBuf ? reasonBuf.toString() : "";
    if (code !== 4006) throw new Error(`expected close 4006 (bad/expired token), got ${code} (${reason})`);
    console.log(`[verify] (e) PASS — expired token rejected by real DO: code=${code} reason=${JSON.stringify(reason)}`);
  }

  console.log("[verify] ALL ASSERTIONS PASSED against the real Cloudflare DO");
  cleanup();
  setTimeout(() => process.exit(0), 200).unref();
} catch (e) {
  console.error("[verify] FAILED:", e.message);
  cleanup();
  setTimeout(() => process.exit(1), 200).unref();
}
