// End-to-end round-trip proof — SLICE 1.
//
// Wires up the real moving parts:
//   sentinel-cmd  --[node-pty PTY]-->  BRIDGE  --ws-->  RELAY  --ws-->  BROWSER leg
//
// and asserts the three things slice 1 must prove:
//   (a) the browser leg receives the bridge's PTY output (the READY sentinel),
//   (b) bytes sent from the browser leg reach the PTY and echo back (round-trip),
//   (c) a 2nd browser attach for the same session is rejected (single-attach).
//
// The relay here is the Node stand-in (../test/standin-relay.mjs), which shares
// the exact pairing/single-attach logic with the Cloudflare DO. The real DO is
// exercised manually with `npx wrangler dev` (see RUN.md).
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SENTINEL = path.resolve(__dirname, "./sentinel-cmd.mjs");
const HARD_TIMEOUT_MS = 20000;

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

test("bridge <-> relay <-> browser round-trip + single-attach", { timeout: 60000 }, async (t) => {
  const session = `test-${Math.random().toString(36).slice(2, 8)}`;
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

  // 1) Start the stand-in relay.
  relay = await startStandinRelay({ port: 0 });
  console.log(`[test] relay listening at ${relay.url}`);

  // 2) Connect the BROWSER leg FIRST so it is attached before the bridge's PTY
  //    emits its banner (slice-1 relay has no buffering).
  let browserBuf = "";
  browser = new WebSocket(`${relay.url}/?session=${session}&role=browser`);
  browser.on("message", (data) => {
    browserBuf += Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  });
  await Promise.race([
    once(browser, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("browser ws open timeout")), 5000)),
  ]);
  console.log("[test] browser leg connected");

  // 3) Start the BRIDGE leg, running the cheap sentinel command in a node-pty PTY.
  bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--cmd", `${process.execPath} ${SENTINEL}`], {
    env: {
      ...process.env,
      RELAY_URL: relay.url,
      SESSION_ID: session,
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

  // (c) a 2nd browser attach for the same session is rejected (single-attach).
  const second = new WebSocket(`${relay.url}/?session=${session}&role=browser`);
  const [code, reasonBuf] = await Promise.race([
    once(second, "close"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("2nd browser close timeout")), 5000)),
  ]);
  const reason = reasonBuf ? reasonBuf.toString() : "";
  console.log(`[test] (c) 2nd browser closed with code=${code} reason=${JSON.stringify(reason)}`);
  assert.equal(code, 4001, "2nd browser must be rejected with single-attach close code 4001");
  assert.match(reason, /single-attach/, "close reason should explain single-attach");
  console.log("[test] (c) PASS — single-attach enforced");

  // sanity: the original browser is still attached and live.
  assert.equal(browser.readyState, WebSocket.OPEN, "first browser must remain connected");
  console.log("[test] ALL ASSERTIONS PASSED");
});
