// End-to-end round-trip + auth proof — SLICE 2.
//
// Wires up the real moving parts WITH owner-bound tokens:
//   sentinel-cmd  --[node-pty PTY]-->  BRIDGE  --ws(+token)-->  RELAY  --ws(+token)-->  BROWSER leg
//
// and asserts everything slice 2 must prove:
//   (a) the browser leg receives the bridge's PTY output (the READY sentinel),
//   (b) bytes sent from the browser leg reach the PTY and echo back (round-trip),
//   (c) a 2nd browser attach (same user, valid token) is rejected (single-attach),
//   (d) a browser whose token is for a DIFFERENT user is rejected (owner-mismatch),
//   (e) a browser with an EXPIRED token is rejected (bad/expired token).
//
// Tokens are minted by the SHARED module (../shared/session-token.mjs) — the same
// code the relay verifies with. The relay here is the Node stand-in
// (../test/standin-relay.mjs), which shares the exact pairing/single-attach/owner
// logic with the Cloudflare DO. The real DO is exercised manually with
// `npx wrangler dev` (see RUN.md / verify-against-relay.mjs).
//
// Hard timeouts guard every wait; the process exits non-zero on any failure and
// always tears down the bridge child + relay server.
//
// Run: cd terminal/test && node --test   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens, signToken } from "../shared/session-token.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SENTINEL = path.resolve(__dirname, "./sentinel-cmd.mjs");
const HARD_TIMEOUT_MS = 20000;
const SECRET = "roundtrip-test-secret";

/** Resolve when `text` appears in accumulated browser-leg output, else reject. */
function waitForText(getBuf, text, ms, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (getBuf().includes(text)) {
        clearInterval(iv);
        resolve(Date.now() - started);
      } else if (Date.now() - started > ms) {
        clearInterval(iv);
        reject(new Error(`timed out after ${ms}ms waiting for ${label}: ${JSON.stringify(text)}`));
      }
    }, 25);
  });
}

test("bridge <-> relay <-> browser round-trip + single-attach + owner-binding", { timeout: 60000 }, async (t) => {
  const session = `test-${Math.random().toString(36).slice(2, 8)}`;
  const ownerA = "user-A-" + Math.random().toString(36).slice(2, 8);
  const ownerB = "user-B-" + Math.random().toString(36).slice(2, 8);
  let relay;
  let bridge;
  let browser;

  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) {
      bridge.kill("SIGKILL");
    }
    if (relay) await relay.close();
  });

  // 0) Mint the owner-bound leg tokens (this is what the app's mint endpoint does).
  const tokensA = await mintSessionTokens({ sub: ownerA, idea: "idea-X", sid: session, secret: SECRET });
  console.log(`[test] minted owner-bound tokens for ${ownerA} on session ${session}`);

  // 1) Start the stand-in relay WITH the same secret it must verify against.
  relay = await startStandinRelay({ port: 0, secret: SECRET });
  console.log(`[test] relay listening at ${relay.url}`);

  // 2) Connect the BROWSER leg FIRST (with its browser-role token) so it is attached
  //    before the bridge's PTY emits its banner (the relay has no buffering).
  let browserBuf = "";
  browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokensA.browser)}`);
  browser.on("message", (data) => {
    browserBuf += Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  });
  await Promise.race([
    once(browser, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("browser ws open timeout")), 5000)),
  ]);
  console.log("[test] browser leg connected (authenticated)");

  // 3) Start the BRIDGE leg with its bridge-role token, running the cheap sentinel.
  bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--cmd", `${process.execPath} ${SENTINEL}`], {
    env: {
      ...process.env,
      RELAY_URL: relay.url,
      SESSION_ID: session,
      BRIDGE_TOKEN: tokensA.bridge,
      // keep timeouts short so a hang fails fast rather than dangling
      "BRIDGE_MAX_SECONDS": "60",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  bridge.on("exit", (code, sig) => console.log(`[test] bridge exited code=${code} sig=${sig}`));

  // (a) browser receives the bridge's PTY output through the relay.
  const tReady = await waitForText(() => browserBuf, "READY", HARD_TIMEOUT_MS, "PTY sentinel");
  console.log(`[test] (a) PASS — browser received "READY" via relay in ${tReady}ms`);

  // (b) bytes from the browser leg reach the PTY and echo back (round-trip).
  const token = `PING-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  browserBuf = ""; // reset so we only match the echo, not the sentinel
  browser.send(Buffer.from(token + "\n", "utf8"), { binary: true });
  const tEcho = await waitForText(() => browserBuf, token, HARD_TIMEOUT_MS, "PTY echo");
  console.log(`[test] (b) PASS — browser->PTY->browser round-trip of ${token} in ${tEcho}ms`);

  /** Connect a browser leg and resolve with its [closeCode, reason]. */
  async function expectClose(token, label) {
    const ws = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(token)}`);
    const [code, reasonBuf] = await Promise.race([
      once(ws, "close"),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} close timeout`)), 5000)),
    ]);
    return [code, reasonBuf ? reasonBuf.toString() : ""];
  }

  // (c) a 2nd browser (SAME user, valid token) is rejected (single-attach).
  {
    const [code, reason] = await expectClose(tokensA.browser, "2nd browser");
    console.log(`[test] (c) 2nd browser (same user) closed code=${code} reason=${JSON.stringify(reason)}`);
    assert.equal(code, 4001, "2nd browser must be rejected with single-attach close code 4001");
    assert.match(reason, /single-attach/, "close reason should explain single-attach");
    console.log("[test] (c) PASS — single-attach enforced");
  }

  // (d) a browser whose token is for a DIFFERENT user is rejected (owner-mismatch).
  {
    const tokensB = await mintSessionTokens({ sub: ownerB, idea: "idea-X", sid: session, secret: SECRET });
    const [code, reason] = await expectClose(tokensB.browser, "foreign-user browser");
    console.log(`[test] (d) different-user browser closed code=${code} reason=${JSON.stringify(reason)}`);
    assert.equal(code, 4005, "cross-user attach must be rejected with OWNER_MISMATCH code 4005");
    assert.match(reason, /owner/, "close reason should explain the owner mismatch");
    console.log("[test] (d) PASS — owner-mismatch rejected");
  }

  // (e) a browser with an EXPIRED token is rejected (bad/expired token).
  {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const expired = await signToken(
      { sub: ownerA, sid: session, idea: "idea-X", role: "browser", iat: past, exp: past + 60 },
      SECRET,
    );
    const [code, reason] = await expectClose(expired, "expired browser");
    console.log(`[test] (e) expired-token browser closed code=${code} reason=${JSON.stringify(reason)}`);
    assert.equal(code, 4006, "expired token must be rejected with BAD_TOKEN code 4006");
    console.log("[test] (e) PASS — expired token rejected");
  }

  // sanity: the original (authenticated) browser is still attached and live.
  assert.equal(browser.readyState, WebSocket.OPEN, "first browser must remain connected");
  console.log("[test] ALL ASSERTIONS PASSED");
});
