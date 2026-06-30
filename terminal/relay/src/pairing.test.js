// Unit tests for the relay pairing / single-attach state machine.
// Run: cd terminal/relay && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyState,
  isValidSession,
  decideAttach,
  attach,
  detach,
  peerRole,
  CLOSE,
} from "./pairing.js";

test("empty session accepts a first bridge and a first browser", () => {
  let s = emptyState();
  assert.deepEqual(decideAttach(s, "bridge"), { ok: true });
  s = attach(s, "bridge");
  assert.deepEqual(decideAttach(s, "browser"), { ok: true });
});

test("single-attach: a 2nd browser is rejected with DUP_BROWSER", () => {
  let s = emptyState();
  s = attach(s, "browser");
  const d = decideAttach(s, "browser");
  assert.equal(d.ok, false);
  assert.equal(d.code, CLOSE.DUP_BROWSER.code);
  assert.equal(d.code, 4001);
  assert.match(d.reason, /single-attach/);
});

test("a 2nd bridge is rejected with DUP_BRIDGE", () => {
  let s = emptyState();
  s = attach(s, "bridge");
  const d = decideAttach(s, "bridge");
  assert.equal(d.ok, false);
  assert.equal(d.code, CLOSE.DUP_BRIDGE.code);
  assert.equal(d.code, 4002);
});

test("an invalid role is rejected with BAD_ROLE", () => {
  const d = decideAttach(emptyState(), "spectator");
  assert.equal(d.ok, false);
  assert.equal(d.code, CLOSE.BAD_ROLE.code);
});

test("after a browser detaches, a new browser may attach (re-pair)", () => {
  let s = emptyState();
  s = attach(s, "browser");
  assert.equal(decideAttach(s, "browser").ok, false);
  s = detach(s, "browser");
  assert.deepEqual(decideAttach(s, "browser"), { ok: true });
});

test("attach/detach are pure — they do not mutate the input state", () => {
  const s = emptyState();
  const s2 = attach(s, "bridge");
  assert.equal(s.bridge, false, "original state must be untouched");
  assert.equal(s2.bridge, true);
  const s3 = detach(s2, "bridge");
  assert.equal(s2.bridge, true, "original state must be untouched");
  assert.equal(s3.bridge, false);
});

test("peerRole returns the opposite leg", () => {
  assert.equal(peerRole("bridge"), "browser");
  assert.equal(peerRole("browser"), "bridge");
});

test("isValidSession accepts url-safe tokens and rejects junk", () => {
  assert.equal(isValidSession("a3f9"), true);
  assert.equal(isValidSession("dev-abc_123.4"), true);
  assert.equal(isValidSession(""), false);
  assert.equal(isValidSession("has space"), false);
  assert.equal(isValidSession("has/slash"), false);
  assert.equal(isValidSession(null), false);
  assert.equal(isValidSession("x".repeat(129)), false);
});
