// Unit tests for terminal/helper/open-terminal-gate.mjs — the pure WAIT logic
// behind the desktop-Codex open-terminal relay-authorization gate (security
// review Finding 1 — CRITICAL). No network, no relay, no Electron, no real
// WebSocket: a minimal fake EventEmitter-shaped socket stands in for the
// control-connection `ws.WebSocket` main.js actually uses.
//
// Run: cd terminal/test && node --test open-terminal-gate.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { waitForOpenTerminalAuthorization, OPEN_TERMINAL_AUTH_TIMEOUT_MS } from "../helper/open-terminal-gate.mjs";

/** A minimal `ws.WebSocket`-shaped fake: EventEmitter's `.on`/`.off` are exactly
 *  what the gate uses; nothing else is needed. */
function fakeSocket() {
  return new EventEmitter();
}

const AUTHORIZED_TEXT = JSON.stringify({ t: "open-terminal-authorized" });
function isAuthorizedFrame(text) {
  try {
    return JSON.parse(text)?.t === "open-terminal-authorized";
  } catch {
    return false;
  }
}

test("resolves when the authorized frame arrives", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame });
  socket.emit("message", AUTHORIZED_TEXT, false);
  await assert.doesNotReject(p);
});

test("ignores an unrelated control frame and still waits for the real ack", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame });
  socket.emit("message", JSON.stringify({ t: "always-on", value: true }), false);
  socket.emit("message", AUTHORIZED_TEXT, false);
  await assert.doesNotReject(p);
});

test("ignores a binary message (this control channel never sends binary)", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame, timeoutMs: 50 });
  socket.emit("message", Buffer.from(AUTHORIZED_TEXT), true);
  await assert.rejects(p, /timed out/);
});

test("REJECTS on close before any ack — a forged/rejected token must never resolve (BAD_TOKEN close simulation)", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame });
  socket.emit("close", 4006, Buffer.from("bad token"));
  await assert.rejects(p, /before authorization/);
  await assert.rejects(p, /4006/);
});

test("REJECTS on close with no reason buffer (still shaped correctly)", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame });
  socket.emit("close", 1000);
  await assert.rejects(p, /code 1000/);
});

test("REJECTS on timeout when nothing ever arrives", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame, timeoutMs: 30 });
  await assert.rejects(p, /timed out/);
});

test("a close AFTER the ack already resolved never rejects the settled promise", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame });
  socket.emit("message", AUTHORIZED_TEXT, false);
  await assert.doesNotReject(p);
  // A subsequent close must not throw an unhandled rejection or otherwise
  // affect the already-settled promise.
  assert.doesNotThrow(() => socket.emit("close", 1000, Buffer.from("later")));
});

test("an ack AFTER a close already rejected never resolves the settled promise", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame });
  socket.emit("close", 4006, Buffer.from("bad token"));
  await assert.rejects(p);
  // A late, spoofed-looking ack after close must not flip the outcome.
  assert.doesNotThrow(() => socket.emit("message", AUTHORIZED_TEXT, false));
});

test("listeners are removed once settled (no leak, no double-fire)", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame });
  socket.emit("message", AUTHORIZED_TEXT, false);
  await p;
  assert.equal(socket.listenerCount("message"), 0);
  assert.equal(socket.listenerCount("close"), 0);
  assert.equal(socket.listenerCount("error"), 0);
});

test("an error event alone (no close) does not resolve, and still eventually times out", async () => {
  const socket = fakeSocket();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame, timeoutMs: 30 });
  socket.emit("error", new Error("boom"));
  await assert.rejects(p, /timed out/);
});

test("default timeout constant is a sane, generous-but-bounded value", () => {
  assert.equal(OPEN_TERMINAL_AUTH_TIMEOUT_MS, 8000);
});

test("a custom timeoutMs is honored over the default", async () => {
  const socket = fakeSocket();
  const started = Date.now();
  const p = waitForOpenTerminalAuthorization(socket, { isAuthorizedFrame, timeoutMs: 25 });
  await assert.rejects(p, /timed out/);
  assert.ok(Date.now() - started < OPEN_TERMINAL_AUTH_TIMEOUT_MS, "did not wait for the full default timeout");
});
