// Unit test for ghost-sessions fix A: `TerminalRelay.endGrace()` must tell the
// app the session died, the same way `endSession()`'s idle/max-duration
// branches already do (card 9fb9fced, Fix 2) — see index.js's endGrace() doc
// for why: previously a Mac sleeping with the dock open (which drops BOTH
// legs, opening the grace window, then letting it expire here) left the
// Supabase registry row "active" for up to 4h, filling the 5-session cap
// with ghosts.
//
// This exercises `TerminalRelay` directly (not through a WebSocket) with a
// minimal fake DurableObjectState — the lightest honest way to pin
// `endGrace`'s side effects without booting `wrangler dev`: neither the
// stand-in relay (terminal/test/standin-relay.mjs, plain setTimeout, no HTTP
// callback support) nor the round-trip harness model
// `notifyAppSessionClosed` at all. `session-end.test.mjs` proves the
// WebSocket-facing behaviour of `/end`; this proves the callback contract of
// the sibling teardown path.
//
// Run: cd terminal/relay && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerminalRelay } from "./index.js";
import { CLOSE } from "./pairing.js";
import { authorizeNotify } from "../../shared/session-token.mjs";

const SECRET = "end-grace-test-secret";

/** Minimal in-memory stand-in for DurableObjectStorage (get/put/delete only). */
function makeFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : undefined;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
    async deleteAlarm() {
      /* no-op — not exercised here */
    },
    async setAlarm() {
      /* no-op — not exercised here */
    },
    _map: map,
  };
}

/** Minimal fake DurableObjectState: just enough for endGrace + clearSessionState. */
function makeFakeState(storage, sockets) {
  return {
    storage,
    getWebSockets: () => sockets,
  };
}

function makeFakeSocket() {
  const closes = [];
  return { closes, close: (code, reason) => closes.push([code, reason]) };
}

test("endGrace closes every leg PEER_GONE and delivers the session-closed callback with reason peer_gone", async () => {
  const sid = "sess-grace-1";
  const socketA = makeFakeSocket();
  const socketB = makeFakeSocket();
  const storage = makeFakeStorage({ owner: "user-A", sid, sessionStartedAt: 1, lastActivityAt: 1 });
  const state = makeFakeState(storage, [socketA, socketB]);
  const env = { VIBECODES_APP_URL: "https://app.example.test", TERMINAL_SESSION_SECRET: SECRET };
  const relay = new TerminalRelay(state, env);

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  try {
    await relay.endGrace(sid);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Both legs closed with the PEER_GONE code/reason — unchanged from before this fix.
  assert.deepEqual(socketA.closes, [[CLOSE.PEER_GONE.code, CLOSE.PEER_GONE.reason]]);
  assert.deepEqual(socketB.closes, [[CLOSE.PEER_GONE.code, CLOSE.PEER_GONE.reason]]);

  // The new part: the app callback fired, authorized with a real notify token
  // for this sid, carrying reason "peer_gone".
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.example.test/api/terminal/session/closed");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { sid, reason: "peer_gone" });
  const authHeader = calls[0].init.headers.authorization;
  const token = authHeader.replace(/^Bearer /, "");
  const auth = await authorizeNotify({ token, secret: SECRET, session: sid });
  assert.equal(auth.ok, true);

  // Session state released, same as before this fix.
  assert.equal(await storage.get("owner"), undefined);
  assert.equal(await storage.get("sid"), undefined);
});

test("endGrace with no sid skips the callback (best-effort, matches notifyAppSessionClosed's existing not-configured guard)", async () => {
  const storage = makeFakeStorage({ owner: "user-A" });
  const state = makeFakeState(storage, []);
  const env = { VIBECODES_APP_URL: "https://app.example.test", TERMINAL_SESSION_SECRET: SECRET };
  const relay = new TerminalRelay(state, env);

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  try {
    await relay.endGrace(undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 0, "no sid → notifyAppSessionClosed's guard skips the fetch entirely");
  assert.equal(await storage.get("owner"), undefined, "teardown still happens even when the callback is skipped");
});
