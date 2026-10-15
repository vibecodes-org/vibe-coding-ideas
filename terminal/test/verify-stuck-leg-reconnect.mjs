// Manual verification against an EXTERNALLY-running relay (`wrangler dev`) for
// board task b829d62d ("Reconnect often doesn't work"): a reconnect whose OLD
// leg is stuck must still work.
//
// A leg's network path can die silently (the laptop slept, Wi-Fi changed) or
// its tab can be frozen in the background — no close ever completes. The relay
// used to keep forwarding to that old leg after a newer one replaced it, so the
// reconnected view read "Connected" while keystrokes and output went nowhere,
// for good; only a fresh sid (Resume) escaped. This drives two scenarios
// through a TCP proxy that freezes connections without closing them:
//
//   old-tab      only the old browser leg is stuck (bridge healthy)
//                → typing must work straight after the reconnect
//   sleep        both legs stuck (bridge and old browser)
//                → typing must work once the bridge's own keepalive reconnects
//
// The Node stand-in relay never had this bug (it swaps its slot on preempt),
// so this needs the real Durable Object:
//
//   cd terminal/relay && npx wrangler dev          # terminal 1 (loads .dev.vars)
//   TERMINAL_SESSION_SECRET=<same-as-.dev.vars> \
//     RELAY_URL=ws://127.0.0.1:8787 node verify-stuck-leg-reconnect.mjs     # terminal 2 (from terminal/test)
//
// Exits non-zero if either scenario never recovers.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
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
const RELAY_URL = process.env.RELAY_URL;
const SECRET = process.env.TERMINAL_SESSION_SECRET;
// Short keepalive so the "sleep" scenario's bridge notices its dead link in
// seconds, not the production ~60 s.
const PING_MS = process.env.PING_MS || "2000";
const RECOVER_WITHIN_MS = 20_000;

if (!RELAY_URL || !SECRET) {
  console.error("RELAY_URL and TERMINAL_SESSION_SECRET are required (see header).");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** TCP proxy whose CURRENT connections can be frozen: data silently dropped, sockets left open. */
function startFreezableProxy(targetPort) {
  const conns = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    const c = { client, upstream, frozen: false };
    conns.add(c);
    client.on("data", (d) => { if (!c.frozen) upstream.write(d); });
    upstream.on("data", (d) => { if (!c.frozen) client.write(d); });
    const end = () => { conns.delete(c); client.destroy(); upstream.destroy(); };
    client.on("close", () => { if (!c.frozen) end(); });
    upstream.on("close", () => { if (!c.frozen) end(); });
    client.on("error", () => {});
    upstream.on("error", () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: server.address().port,
        freezeAll() { for (const c of conns) c.frozen = true; },
        close() { for (const c of conns) { c.client.destroy(); c.upstream.destroy(); } server.close(); },
      }),
    ),
  );
}

/** Stand-in for the app's /api/terminal/session/key route (see roundtrip-e2ee.test.mjs). */
function startKeyServer({ sid, key }) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(parsed?.sid === sid ? { delivered: true, sessionKey: key.toString("base64") } : { delivered: false }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** A browser leg following the dock's E2EE rules (use-terminal-session.ts) and its "Connected" signal. */
function openBrowser(relayUrl, session, token, sessionKey) {
  const b = { buf: "", enc: null, dec: null, connected: false };
  const ws = new WebSocket(`${relayUrl}/?session=${session}&role=browser&token=${encodeURIComponent(token)}`);
  b.ws = ws;
  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      let msg = null;
      try { msg = JSON.parse(data.toString("utf8")); } catch { /* not a control frame */ }
      if (msg?.t === "bridge-version" && !b.enc) {
        b.enc = new FrameEncryptor(sessionKey, DIRECTION_BROWSER_TO_BRIDGE, session);
        b.dec = new FrameDecryptor(sessionKey, DIRECTION_BRIDGE_TO_BROWSER, session);
      } else if (msg?.t === "peer-reattached") {
        if (b.enc && b.dec) {
          b.enc = new FrameEncryptor(sessionKey, DIRECTION_BROWSER_TO_BRIDGE, session);
          b.dec = new FrameDecryptor(sessionKey, DIRECTION_BRIDGE_TO_BROWSER, session);
        }
        b.connected = true;
      }
      return;
    }
    if (!b.dec) return;
    const pt = b.dec.decrypt(Buffer.from(data));
    if (pt) b.buf += pt.toString("utf8");
  });
  b.opened = new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  b.type = (s) => { if (b.enc && b.connected) ws.send(b.enc.encrypt(Buffer.from(s)), { binary: true }); };
  return b;
}

async function scenario(name, { bridgeThroughProxy }) {
  const session = `stuck-${Math.random().toString(36).slice(2, 8)}`;
  const sessionKey = crypto.randomBytes(32);
  const tokens = await mintSessionTokens({ sub: "user-stuck", idea: "idea-stuck", sid: session, secret: SECRET });
  const tokens2 = await mintSessionTokens({ sub: "user-stuck", idea: "idea-stuck", sid: session, secret: SECRET });
  const proxy = await startFreezableProxy(Number(new URL(RELAY_URL.replace(/^ws/, "http")).port));
  const proxied = `ws://127.0.0.1:${proxy.port}`;
  const keyServer = await startKeyServer({ sid: session, key: sessionKey });
  const b1 = openBrowser(proxied, session, tokens.browser, sessionKey);
  await b1.opened;
  const bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--cmd", `${process.execPath} ${SENTINEL}`], {
    // Explicit env, not ...process.env (same reason as roundtrip-e2ee.test.mjs).
    env: {
      PATH: process.env.PATH,
      RELAY_URL: bridgeThroughProxy ? proxied : RELAY_URL,
      SESSION_ID: session,
      BRIDGE_TOKEN: tokens.bridge,
      BRIDGE_MAX_SECONDS: "120",
      TERMINAL_APP_URL: `http://127.0.0.1:${keyServer.address().port}`,
      BRIDGE_PING_INTERVAL_MS: PING_MS,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    const t0 = Date.now();
    while (!b1.buf.includes("READY")) {
      if (Date.now() - t0 > 10_000) throw new Error("bridge never came up");
      await sleep(25);
    }
    proxy.freezeAll(); // the network path dies silently — nobody is told
    await sleep(500);
    const b2 = openBrowser(RELAY_URL, session, tokens2.browser, sessionKey); // the user's Reconnect
    await b2.opened;
    const started = Date.now();
    for (let i = 0; Date.now() - started < RECOVER_WITHIN_MS; i++) {
      const tok = `K${i}-${session}`;
      b2.type(`${tok}\n`);
      await sleep(250);
      if (b2.buf.includes(tok)) {
        console.log(`PASS ${name}: typing works ${((Date.now() - started) / 1000).toFixed(1)}s after the reconnect`);
        b2.ws.terminate();
        return true;
      }
    }
    console.log(`FAIL ${name}: reconnected view ${b2.connected ? "reads Connected" : "never connected"} but typing never got through in ${RECOVER_WITHIN_MS / 1000}s`);
    b2.ws.terminate();
    return false;
  } finally {
    bridge.kill("SIGKILL");
    b1.ws.terminate();
    proxy.close();
    keyServer.close();
  }
}

const results = [
  await scenario("old-tab (only the old browser leg stuck)", { bridgeThroughProxy: false }),
  await scenario("sleep (bridge and old browser leg stuck)", { bridgeThroughProxy: true }),
];
process.exit(results.every(Boolean) ? 0 : 1);
