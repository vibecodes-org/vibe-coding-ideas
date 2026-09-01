// Full-stack ENCRYPTED round-trip — Terminal P2 (E2EE) gap closure.
//
// roundtrip.test.mjs deliberately points its bridge's E2EE key-fetch off-
// network (`TERMINAL_APP_URL: "http://127.0.0.1:1"`) so the existing
// integration test never actually negotiates encryption — every one of its
// assertions runs over PLAINTEXT frames. This file is the missing case: a
// real bridge process, given a real key via a tiny local stand-in for the
// app's `/api/terminal/session/key` route, actually encrypting the PTY byte
// stream — proving:
//   (a) the browser leg can decrypt the bridge's PTY output (the READY
//       sentinel) using the SAME session key,
//   (b) bytes encrypted by a simulated browser leg reach the PTY and the
//       (encrypted) echo decrypts back correctly — a real round-trip,
//   (c) the bytes actually crossing the relay are NOT the plaintext — proof
//       encryption is active end to end, not merely unit-tested on the
//       crypto core in isolation (pty-crypto.test.mjs / pty-crypto.test.ts).
//
// The relay itself never has any part in this — it forwards opaque binary
// frames verbatim (FR-3), exactly as it does for the plaintext test. What's
// different here is only: the bridge has a real key (via the stand-in HTTP
// server below) and this test's simulated browser leg is E2EE-aware.
//
// Run: cd terminal/test && node --test roundtrip-e2ee.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import {
  FrameEncryptor,
  FrameDecryptor,
  DIRECTION_BRIDGE_TO_BROWSER,
  DIRECTION_BROWSER_TO_BRIDGE,
} from "../shared/pty-crypto.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SENTINEL = path.resolve(__dirname, "./sentinel-cmd.mjs");
const HARD_TIMEOUT_MS = 20000;
const SECRET = "roundtrip-e2ee-test-secret";

/** Resolve when `predicate()` is true, else reject after `ms`. */
function waitFor(predicate, ms, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (predicate()) {
        clearInterval(iv);
        resolve(Date.now() - started);
      } else if (Date.now() - started > ms) {
        clearInterval(iv);
        reject(new Error(`timed out after ${ms}ms waiting for ${label}`));
      }
    }, 25);
  });
}

/**
 * A tiny stand-in for the app's `POST /api/terminal/session/key` route
 * (src/app/api/terminal/session/key/route.ts) — the bridge's real key-
 * delivery endpoint. This fixture skips auth/DB entirely and just hands
 * back `sessionKey` (base64) for the one sid it's configured with, mirroring
 * the real route's `{ delivered, sessionKey }` response shape exactly (the
 * bridge's fetchE2eeSessionKey() only cares about that shape).
 */
function startKeyServer({ sid, key }) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/terminal/session/key") {
        res.writeHead(404).end();
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        if (parsed?.sid === sid) {
          res.end(JSON.stringify({ delivered: true, sessionKey: key.toString("base64") }));
        } else {
          res.end(JSON.stringify({ delivered: false }));
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("bridge <-> relay <-> browser round-trip is ACTUALLY ENCRYPTED end to end", { timeout: 60000 }, async (t) => {
  const session = `e2ee-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-E2EE-" + Math.random().toString(36).slice(2, 8);
  const sessionKey = crypto.randomBytes(32);
  let relay;
  let keyServer;
  let bridge;
  let browser;

  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
    if (keyServer) await new Promise((r) => keyServer.close(r));
  });

  // 0) Mint the owner-bound leg tokens (this is what the app's mint endpoint does).
  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-E2EE", sid: session, secret: SECRET });

  // 1) Start the stand-in relay and the stand-in key-delivery server.
  relay = await startStandinRelay({ port: 0, secret: SECRET });
  keyServer = await startKeyServer({ sid: session, key: sessionKey });
  const keyServerUrl = `http://127.0.0.1:${keyServer.address().port}`;
  console.log(`[test/e2ee] relay=${relay.url} keyServer=${keyServerUrl}`);

  // 2) The simulated BROWSER leg: this test's own encryptor/decryptor pair,
  // built from the SAME session key the bridge is about to fetch. Real
  // production code for this side is src/lib/terminal/pty-crypto.ts
  // (WebCrypto) — this .mjs implementation is the shared spec both sides
  // must produce/consume identically (see pty-crypto.mjs's module doc).
  const browserEnc = new FrameEncryptor(sessionKey, DIRECTION_BROWSER_TO_BRIDGE, session);
  const browserDec = new FrameDecryptor(sessionKey, DIRECTION_BRIDGE_TO_BROWSER, session);

  // Every raw binary frame the browser leg receives, kept alongside the
  // decrypted plaintext buffer — this is what proves (c): the wire bytes are
  // not the plaintext.
  /** @type {Buffer[]} */
  const rawBinaryFrames = [];
  let plaintextBuf = "";
  browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (data, isBinary) => {
    if (!isBinary) return; // control/text frames (attached, bridge-version, …) — not PTY data
    const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
    rawBinaryFrames.push(frame);
    const plaintext = browserDec.decrypt(frame); // throws (fails the test) on any verification failure
    plaintextBuf += plaintext.toString("utf8");
  });
  await Promise.race([
    once(browser, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("browser ws open timeout")), 5000)),
  ]);
  console.log("[test/e2ee] browser leg connected");

  // 3) Start the BRIDGE leg pointed at the stand-in key server — the bridge
  // fetches this session's real key exactly as it would from the app in
  // production (src/app/api/terminal/session/key/route.ts), then encrypts
  // every binary frame it sends and requires every binary frame it receives
  // to decrypt cleanly.
  bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--cmd", `${process.execPath} ${SENTINEL}`], {
    env: {
      // Deliberately NOT `...process.env` — this test's own shell may run
      // inside a packaged helper (VIBECODES_PACKAGED=1), which would make
      // the bridge's relay-host allowlist reject the loopback stand-in relay
      // (see relay-allowlist.mjs). An explicit safe env, same shape as
      // roundtrip.test.mjs's --launch-url spawn, keeps this test hermetic.
      PATH: process.env.PATH,
      RELAY_URL: relay.url,
      SESSION_ID: session,
      BRIDGE_TOKEN: tokens.bridge,
      BRIDGE_MAX_SECONDS: "60",
      TERMINAL_APP_URL: keyServerUrl,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  bridge.on("exit", (code, sig) => console.log(`[test/e2ee] bridge exited code=${code} sig=${sig}`));

  // (a) the browser leg decrypts the bridge's PTY output (the READY sentinel).
  const tReady = await waitFor(() => plaintextBuf.includes("READY"), HARD_TIMEOUT_MS, "decrypted PTY sentinel");
  console.log(`[test/e2ee] (a) PASS — decrypted "READY" via relay in ${tReady}ms`);
  assert.ok(rawBinaryFrames.length > 0, "at least one encrypted binary frame must have crossed the relay");

  // (c) the RAW wire bytes are not the plaintext — this is the actual proof
  // encryption is active end to end, not just correct in the crypto-core
  // unit tests. Every raw frame received so far is checked, not just the
  // last one.
  for (const frame of rawBinaryFrames) {
    assert.ok(
      !frame.toString("utf8").includes("READY") && !frame.toString("latin1").includes("READY"),
      "the wire bytes must never contain the plaintext sentinel",
    );
  }
  console.log("[test/e2ee] (c) PASS — wire bytes are ciphertext, not plaintext");

  // (b) bytes ENCRYPTED by the simulated browser leg reach the PTY and the
  // (encrypted) echo decrypts back to the same token — a real round-trip
  // through the bridge's e2eeDec (input) and e2eeEnc (output).
  const token = `PING-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  plaintextBuf = "";
  rawBinaryFrames.length = 0;
  const frame = browserEnc.encrypt(Buffer.from(token + "\n", "utf8"));
  browser.send(frame, { binary: true });
  const tEcho = await waitFor(() => plaintextBuf.includes(token), HARD_TIMEOUT_MS, "decrypted PTY echo");
  console.log(`[test/e2ee] (b) PASS — encrypted browser->PTY->browser round-trip of ${token} in ${tEcho}ms`);
  for (const f of rawBinaryFrames) {
    assert.ok(!f.toString("utf8").includes(token), "the echoed wire bytes must never contain the plaintext token");
  }

  assert.equal(browser.readyState, WebSocket.OPEN, "browser must remain connected");
  console.log("[test/e2ee] ALL ASSERTIONS PASSED");
});
