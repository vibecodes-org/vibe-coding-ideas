// Manual verification of the REAL Durable Object's idle-timeout against a running
// `wrangler dev` — slice 6. Unlike lifecycle.test.mjs (Node stand-in), this drives
// two raw WebSocket legs at the actual Cloudflare runtime and proves an idle
// session is closed by the DO ALARM with code 1000 + an "idle" reason.
//
// Start the relay with a SHORT idle so the test is fast (overrides the 30-min
// default; `--var` injects an env binding the DO reads as env.TERMINAL_IDLE_MS):
//
//   cd terminal/relay && npx wrangler dev --port 8787 --var TERMINAL_IDLE_MS:3000
//
// then (matching the relay's .dev.vars secret):
//   cd terminal/test && TERMINAL_SESSION_SECRET=<same-as-.dev.vars> \
//     RELAY_URL=ws://127.0.0.1:8787 EXPECT_IDLE_MS=3000 node verify-lifecycle.mjs
//
// Exits 0 on success, non-zero on any failure. Hard timeouts throughout.

import { once } from "node:events";
import WebSocket from "ws";
import { mintSessionTokens } from "../shared/session-token.mjs";

const RELAY_URL = process.env.RELAY_URL || "ws://127.0.0.1:8787";
const SECRET = process.env.TERMINAL_SESSION_SECRET;
const EXPECT_IDLE_MS = Number(process.env.EXPECT_IDLE_MS || 3000);
const session = `idle-${Math.random().toString(36).slice(2, 8)}`;
const owner = `user-${Math.random().toString(36).slice(2, 8)}`;

if (!SECRET) {
  console.error("[verify-lifecycle] set TERMINAL_SESSION_SECRET to match the relay's .dev.vars");
  process.exit(2);
}

async function openLeg(role, token) {
  const ws = new WebSocket(`${RELAY_URL}/?session=${session}&role=${role}&token=${encodeURIComponent(token)}`);
  await Promise.race([
    once(ws, "open"),
    new Promise((_, r) => setTimeout(() => r(new Error(`${role} open timeout`)), 5000)),
  ]);
  return ws;
}

/** Capture a leg's close (code+reason) — listener attached EAGERLY so a near-
 *  simultaneous close on both legs can't be missed by listening too late. */
function captureClose(ws) {
  return new Promise((resolve) => {
    ws.once("close", (code, reasonBuf) => resolve([code, reasonBuf ? reasonBuf.toString() : ""]));
  });
}
function withTimeout(p, label, ms) {
  return Promise.race([
    p,
    new Promise((_, r) => setTimeout(() => r(new Error(`${label} idle close timeout`)), ms)),
  ]);
}

let browser, bridge;
try {
  console.log(`[verify-lifecycle] relay=${RELAY_URL} session=${session} expectIdleMs=${EXPECT_IDLE_MS}`);
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-L", sid: session, secret: SECRET });

  browser = await openLeg("browser", tokens.browser);
  bridge = await openLeg("bridge", tokens.bridge);
  // Attach close-captures BEFORE going idle so neither near-simultaneous close is missed.
  const browserClosed = captureClose(browser);
  const bridgeClosed = captureClose(bridge);
  console.log("[verify-lifecycle] both legs attached; sending one byte then going idle…");
  bridge.send(Buffer.from("READY\n", "utf8"), { binary: true });

  const started = Date.now();
  const waitMs = EXPECT_IDLE_MS + 8000;
  const [bCode, bReason] = await withTimeout(browserClosed, "browser", waitMs);
  const [gCode, gReason] = await withTimeout(bridgeClosed, "bridge", waitMs);
  const elapsed = Date.now() - started;

  if (bCode !== 1000 || gCode !== 1000) {
    throw new Error(`expected both legs to close 1000, got browser=${bCode} bridge=${gCode}`);
  }
  if (!/idle/.test(bReason) || !/idle/.test(gReason)) {
    throw new Error(`expected an 'idle' reason, got browser=${JSON.stringify(bReason)} bridge=${JSON.stringify(gReason)}`);
  }
  console.log(`[verify-lifecycle] PASS — DO alarm closed BOTH legs after ~${elapsed}ms`);
  console.log(`[verify-lifecycle]   browser: code=${bCode} reason=${JSON.stringify(bReason)}`);
  console.log(`[verify-lifecycle]   bridge:  code=${gCode} reason=${JSON.stringify(gReason)}`);
  process.exit(0);
} catch (e) {
  console.error("[verify-lifecycle] FAILED:", e.message);
  try { browser?.terminate(); } catch { /* ignore */ }
  try { bridge?.terminate(); } catch { /* ignore */ }
  process.exit(1);
}
