// Relay-host allowlist — the fix for the `vibecodes://launch?relay=<HOST>` RCE
// vector (see the Reproduce & Investigate step). Two layers of proof:
//
//   1. UNIT — the pure `isRelayHostAllowed` predicate: prod wss ✅, prod ws ❌,
//      loopback gated on `allowLoopback`, and a battery of bypass strings ❌
//      (fake-suffix host, fake-prefix host, userinfo trick, wrong scheme, garbage).
//   2. BRIDGE e2e — the load-bearing gate: with VIBECODES_PACKAGED=1 a loopback
//      `relay=` is rejected → the bridge exits 1 with ZERO `spawning PTY`; the
//      positive control (no VIBECODES_PACKAGED) dials the loopback stand-in and
//      attaches + spawns normally, byte round-trip through the relay.
//
// Run: cd terminal/test && node relay-allowlist.test.mjs   (or via `npm test`)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import {
  isRelayHostAllowed,
  assertRelayAllowed,
  PROD_RELAY_HOST,
} from "../shared/relay-allowlist.mjs";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { buildLaunchDeepLink } from "../shared/deep-link.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SENTINEL = path.resolve(__dirname, "./sentinel-cmd.mjs");
const HARD_TIMEOUT_MS = 20000;
const SECRET = "relay-allowlist-test-secret";
const PROD_WSS = `wss://${PROD_RELAY_HOST}`;

// ── UNIT: the pure predicate ───────────────────────────────────────────────────

test("prod relay over wss is allowed (both allowLoopback modes)", () => {
  assert.equal(isRelayHostAllowed(PROD_WSS, { allowLoopback: false }), true);
  assert.equal(isRelayHostAllowed(PROD_WSS, { allowLoopback: true }), true);
  assert.equal(isRelayHostAllowed(`${PROD_WSS}/?session=x&role=bridge`, { allowLoopback: false }), true);
});

test("prod relay over insecure ws is REJECTED (wss-only)", () => {
  assert.equal(isRelayHostAllowed(`ws://${PROD_RELAY_HOST}`, { allowLoopback: false }), false);
  assert.equal(isRelayHostAllowed(`ws://${PROD_RELAY_HOST}`, { allowLoopback: true }), false);
});

test("loopback is allowed ONLY when allowLoopback is set", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    assert.equal(isRelayHostAllowed(`ws://${host}:8787`, { allowLoopback: true }), true, `${host} ws dev`);
    assert.equal(isRelayHostAllowed(`wss://${host}:8787`, { allowLoopback: true }), true, `${host} wss dev`);
    assert.equal(isRelayHostAllowed(`ws://${host}:8787`, { allowLoopback: false }), false, `${host} packaged`);
  }
});

test("bypass strings are all REJECTED", () => {
  const bypass = [
    "wss://evil.example",
    // fake SUFFIX — endsWith() would have let this through
    `wss://${PROD_RELAY_HOST}.evil.com`,
    // fake PREFIX — substring/includes() would have let this through
    `wss://evil-${PROD_RELAY_HOST}`,
    // userinfo trick — real host in the userinfo, evil host is the authority
    `wss://${PROD_RELAY_HOST}@evil.com`,
    "wss://real@evil.com",
    // wrong scheme entirely
    `https://${PROD_RELAY_HOST}`,
    `http://${PROD_RELAY_HOST}`,
    // garbage / non-strings
    "not a url",
    "",
    "://///",
    null,
    undefined,
    42,
    {},
  ];
  for (const b of bypass) {
    assert.equal(isRelayHostAllowed(b, { allowLoopback: true }), false, `must reject: ${String(b)}`);
    assert.equal(isRelayHostAllowed(b, { allowLoopback: false }), false, `must reject (packaged): ${String(b)}`);
  }
});

test("assertRelayAllowed throws host-only (never the token) on reject", () => {
  const withToken = `wss://evil.example/?token=SUPERSECRET&role=bridge`;
  assert.throws(
    () => assertRelayAllowed(withToken, { allowLoopback: false }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("evil.example"), "message names the host");
      assert.ok(!err.message.includes("SUPERSECRET"), "message must NOT leak the token");
      return true;
    },
  );
  assert.equal(assertRelayAllowed(PROD_WSS, { allowLoopback: false }), PROD_WSS);
});

// ── BRIDGE e2e helpers (mirror prompt-launch.test.mjs) ─────────────────────────

function spawnBridge(argv, env = {}) {
  const child = spawn(process.execPath, [BRIDGE_ENTRY, ...argv], {
    env: { PATH: process.env.PATH, BRIDGE_MAX_SECONDS: "60", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { stderr += d; });
  return { child, getStderr: () => stderr };
}

function waitForText(getBuf, text, ms, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (getBuf().includes(text)) { clearInterval(iv); resolve(Date.now() - started); }
      else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`timed out waiting for ${label}`)); }
    }, 25);
  });
}

async function waitForExit(child, ms, label) {
  const [code] = await Promise.race([
    once(child, "exit"),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} exit timeout`)), ms)),
  ]);
  return { code };
}

async function connectBrowserLeg(relayUrl, session, browserToken) {
  let buf = "";
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=browser&token=${encodeURIComponent(browserToken)}`);
  ws.on("message", (data) => { buf += Buffer.isBuffer(data) ? data.toString("utf8") : String(data); });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("browser ws open timeout")), 5000)),
  ]);
  return { ws, getBuf: () => buf };
}

// ── e2e NEGATIVE: packaged bridge + loopback relay ⇒ exit 1, ZERO spawn ────────
test("packaged bridge (VIBECODES_PACKAGED=1) rejects a loopback relay before any spawn", { timeout: 60000 }, async (t) => {
  const session = `ra-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-RA-" + Math.random().toString(36).slice(2, 8);
  let relay;
  let bridge;

  t.after(async () => {
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
  });

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RA", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });

  // Loopback stand-in URL — allowed in dev, but VIBECODES_PACKAGED=1 pins to prod.
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge });
  const spawned = spawnBridge(
    ["--launch-url", launchUrl, "--cmd", `${process.execPath} ${SENTINEL}`],
    { VIBECODES_PACKAGED: "1" },
  );
  bridge = spawned.child;

  const { code } = await waitForExit(spawned.child, HARD_TIMEOUT_MS, "packaged bridge");
  const logs = spawned.getStderr();
  assert.ok(logs.includes("relay host not allowed"), "bridge logs the allowlist rejection");
  assert.ok(!logs.includes("spawning PTY"), "NO PTY spawn on a rejected relay host");
  assert.ok(!logs.includes("connecting to relay"), "bridge must not even dial the relay");
  assert.equal(code, 1, "a rejected relay host exits non-zero");
  console.log("[test/ra] PASS — packaged + loopback relay ⇒ exit 1, zero spawn");
});

// ── e2e POSITIVE control: dev bridge + loopback relay ⇒ normal attach+spawn ─────
test("dev bridge (no VIBECODES_PACKAGED) dials the loopback stand-in and spawns normally", { timeout: 60000 }, async (t) => {
  const session = `rap-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-RAP-" + Math.random().toString(36).slice(2, 8);
  let relay;
  let bridge;
  let browser;

  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
  });

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-RAP", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });

  const leg = await connectBrowserLeg(relay.url, session, tokens.browser);
  browser = leg.ws;

  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge });
  const spawned = spawnBridge(["--launch-url", launchUrl, "--cmd", `${process.execPath} ${SENTINEL}`]);
  bridge = spawned.child;

  await waitForText(leg.getBuf, "READY", HARD_TIMEOUT_MS, "sentinel via relay");
  const logs = spawned.getStderr();
  assert.ok(!logs.includes("relay host not allowed"), "loopback relay is NOT rejected in dev");
  assert.ok(logs.includes("spawning PTY"), "dev bridge spawns the PTY");
  assert.ok(logs.includes("connecting to relay"), "dev bridge dials the loopback relay");
  console.log("[test/rap] PASS — dev + loopback relay ⇒ normal attach + spawn");
});
