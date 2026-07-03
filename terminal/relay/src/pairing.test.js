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

// ── owner-binding (slice 2) ──────────────────────────────────────────────────

test("owner-binding: same-user bridge+browser pair is accepted", () => {
  let s = emptyState();
  assert.equal(decideAttach(s, "bridge", "user-A").ok, true);
  s = attach(s, "bridge", "user-A");
  assert.equal(s.owner, "user-A");
  assert.equal(decideAttach(s, "browser", "user-A").ok, true);
  s = attach(s, "browser", "user-A");
  assert.equal(s.owner, "user-A", "owner stays bound to the first leg's user");
});

test("owner-binding: a different user is rejected with OWNER_MISMATCH (before single-attach)", () => {
  let s = emptyState();
  s = attach(s, "bridge", "user-A"); // session now owned by A, browser slot free
  const d = decideAttach(s, "browser", "user-B");
  assert.equal(d.ok, false);
  assert.equal(d.code, CLOSE.OWNER_MISMATCH.code);
  assert.equal(d.code, 4005);
  assert.match(d.reason, /owner/);
});

test("owner-binding: releases the owner once the session is fully empty", () => {
  let s = emptyState();
  s = attach(s, "bridge", "user-A");
  s = detach(s, "bridge");
  assert.equal(s.owner, null, "owner released when no legs remain");
  // a fresh, different owner may now claim the freed session id
  assert.equal(decideAttach(s, "bridge", "user-B").ok, true);
});

test("owner-binding: omitting sub skips the owner check (slice-1 compatibility)", () => {
  let s = attach(emptyState(), "bridge", "user-A");
  // No sub passed → owner check is skipped, only single-attach applies.
  assert.equal(decideAttach(s, "browser").ok, true);
});

// ── same-owner browser preemption (fix/terminal-dock-heartbeat) ──────────────

test("preemption: an owner-verified 2nd browser is accepted with the preempt flag", () => {
  let s = emptyState();
  s = attach(s, "bridge", "user-A");
  s = attach(s, "browser", "user-A"); // possibly a silently-dead zombie leg
  const d = decideAttach(s, "browser", "user-A");
  assert.deepEqual(d, { ok: true, preempt: true }, "the newer same-owner browser wins");
});

test("preemption: a sub-less 2nd browser keeps the old DUP_BROWSER rejection", () => {
  const s = attach(emptyState(), "browser");
  const d = decideAttach(s, "browser");
  assert.equal(d.ok, false);
  assert.equal(d.code, CLOSE.DUP_BROWSER.code);
});

test("preemption: a foreign owner is still rejected OWNER_MISMATCH, never preempts", () => {
  let s = emptyState();
  s = attach(s, "browser", "user-A");
  const d = decideAttach(s, "browser", "user-B");
  assert.equal(d.ok, false);
  assert.equal(d.code, CLOSE.OWNER_MISMATCH.code);
});

test("preemption: never applies to the bridge role — a live 2nd bridge is a real conflict", () => {
  let s = emptyState();
  s = attach(s, "bridge", "user-A");
  const d = decideAttach(s, "bridge", "user-A");
  assert.equal(d.ok, false);
  assert.equal(d.code, CLOSE.DUP_BRIDGE.code);
});

test("preemption: the stale-leg close reuses the DUP_BROWSER code with a distinct reason", () => {
  assert.equal(CLOSE.PREEMPTED.code, CLOSE.DUP_BROWSER.code);
  assert.equal(CLOSE.PREEMPTED.code, 4001);
  assert.match(CLOSE.PREEMPTED.reason, /preempted/);
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
