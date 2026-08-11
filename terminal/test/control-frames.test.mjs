// Unit tests for the shared relay→bridge `attached` control frame (R1).
//
// The frame is the ONLY signal that releases a prompt-carrying PTY spawn, so its
// encode/detect pair must be strict, symmetric, and disjoint from the existing
// browser→bridge control namespace ({"type":"resize",…}).
//
// Run: cd terminal/test && node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeAttachedFrame,
  isAttachedFrame,
  encodePeerDegradedFrame,
  isPeerDegradedFrame,
  encodePeerReattachedFrame,
  isPeerReattachedFrame,
  encodeHeartbeatFrame,
  isHeartbeatFrame,
  encodeHeartbeatAckFrame,
  isHeartbeatAckFrame,
  encodeBridgeVersionFrame,
  isBridgeVersionFrame,
  parseBridgeVersionFrame,
  parseBridgeVersionHost,
  parseBridgeVersionConv,
  sanitizeHelperVersion,
  sanitizeMachineLabel,
  sanitizeConversationId,
  encodeHelperCommandFrame,
  isHelperCommandFrame,
  parseHelperCommandFrame,
  encodeGoodbyeFrame,
  isGoodbyeFrame,
  parseGoodbyeReason,
  encodeAlwaysOnFrame,
  isAlwaysOnFrame,
  parseAlwaysOnValue,
} from "../shared/control-frames.mjs";
import { parseControlMessage } from "../bridge/src/framing.js";

test("encode ⇄ detect round-trips", () => {
  assert.equal(isAttachedFrame(encodeAttachedFrame()), true);
});

test("grace-window frames encode ⇄ detect round-trip and stay mutually disjoint", () => {
  assert.equal(isPeerDegradedFrame(encodePeerDegradedFrame()), true);
  assert.equal(isPeerReattachedFrame(encodePeerReattachedFrame()), true);
  // Each detector is strict to its own tag — no cross-matching between the frames.
  assert.equal(isPeerReattachedFrame(encodePeerDegradedFrame()), false);
  assert.equal(isPeerDegradedFrame(encodePeerReattachedFrame()), false);
  assert.equal(isAttachedFrame(encodePeerDegradedFrame()), false);
  assert.equal(isAttachedFrame(encodePeerReattachedFrame()), false);
  assert.equal(isPeerDegradedFrame(encodeAttachedFrame()), false);
  // Neither is a resize control frame.
  assert.equal(parseControlMessage(encodePeerDegradedFrame()), null);
  assert.equal(parseControlMessage(encodePeerReattachedFrame()), null);
});

test("heartbeat frames encode ⇄ detect round-trip and stay disjoint from everything else", () => {
  assert.equal(isHeartbeatFrame(encodeHeartbeatFrame()), true);
  assert.equal(isHeartbeatAckFrame(encodeHeartbeatAckFrame()), true);
  // The probe and its echo never cross-match, nor match any other control frame.
  assert.equal(isHeartbeatFrame(encodeHeartbeatAckFrame()), false);
  assert.equal(isHeartbeatAckFrame(encodeHeartbeatFrame()), false);
  assert.equal(isAttachedFrame(encodeHeartbeatFrame()), false);
  assert.equal(isPeerDegradedFrame(encodeHeartbeatAckFrame()), false);
  assert.equal(isHeartbeatFrame(encodeAttachedFrame()), false);
  // Neither is a resize control frame (browser→bridge namespace stays disjoint).
  assert.equal(parseControlMessage(encodeHeartbeatFrame()), null);
  assert.equal(parseControlMessage(encodeHeartbeatAckFrame()), null);
});

test("rejects non-attached / malformed / hostile inputs", () => {
  assert.equal(isAttachedFrame(""), false);
  assert.equal(isAttachedFrame(null), false);
  assert.equal(isAttachedFrame(undefined), false);
  assert.equal(isAttachedFrame("attached"), false);
  assert.equal(isAttachedFrame('{"type":"resize","cols":80,"rows":24}'), false);
  assert.equal(isAttachedFrame('{"t":"detached"}'), false);
  assert.equal(isAttachedFrame('{"t":"attached"' /* truncated */), false);
  // Oversized frames are rejected outright (bounded parse).
  assert.equal(isAttachedFrame(`{"t":"attached","pad":"${"x".repeat(200)}"}`), false);
});

test("stays disjoint from the resize control namespace (an attached frame is NOT a resize)", () => {
  assert.equal(parseControlMessage(encodeAttachedFrame()), null);
  assert.equal(isAttachedFrame(JSON.stringify({ type: "resize", cols: 80, rows: 24 })), false);
});

test("bridge-version frame encode ⇄ detect ⇄ parse round-trips and stays disjoint", () => {
  const frame = encodeBridgeVersionFrame("0.2.0");
  assert.equal(isBridgeVersionFrame(frame), true);
  assert.equal(parseBridgeVersionFrame(frame), "0.2.0");
  // Disjoint from every other control frame.
  assert.equal(isAttachedFrame(frame), false);
  assert.equal(isPeerDegradedFrame(frame), false);
  assert.equal(isPeerReattachedFrame(frame), false);
  assert.equal(isHeartbeatFrame(frame), false);
  assert.equal(isHeartbeatAckFrame(frame), false);
  assert.equal(isBridgeVersionFrame(encodeAttachedFrame()), false);
  assert.equal(parseControlMessage(frame), null);
});

test("parseBridgeVersionFrame rejects a malformed/hostile `v` even inside a well-formed frame", () => {
  assert.equal(parseBridgeVersionFrame(JSON.stringify({ t: "bridge-version", v: "not-a-version" })), null);
  assert.equal(parseBridgeVersionFrame(JSON.stringify({ t: "bridge-version", v: "0.2.0-beta" })), null);
  assert.equal(parseBridgeVersionFrame(JSON.stringify({ t: "bridge-version" })), null);
  assert.equal(parseBridgeVersionFrame(JSON.stringify({ t: "bridge-version", v: 123 })), null);
  assert.equal(parseBridgeVersionFrame("not json"), null);
  assert.equal(parseBridgeVersionFrame(null), null);
});

// ── machine identity (Nick's sign-off change 2 — the SAME frame's `host` field) ──

test("bridge-version frame's `host` field encode ⇄ detect ⇄ parse round-trips alongside `v`", () => {
  const frame = encodeBridgeVersionFrame("0.3.2", "Nicks-MacBook-Pro");
  assert.equal(isBridgeVersionFrame(frame), true);
  assert.equal(parseBridgeVersionFrame(frame), "0.3.2");
  assert.equal(parseBridgeVersionHost(frame), "Nicks-MacBook-Pro");
});

test("a frame with no `host` (old bridge) parses host as null — the version still parses fine", () => {
  const frame = encodeBridgeVersionFrame("0.3.2");
  assert.equal(parseBridgeVersionHost(frame), null);
  assert.equal(parseBridgeVersionFrame(frame), "0.3.2");
});

test("a frame carrying only `host` (no version) is still a valid, parseable frame", () => {
  const frame = encodeBridgeVersionFrame(undefined, "Nicks-MacBook-Pro");
  assert.equal(isBridgeVersionFrame(frame), true);
  assert.equal(parseBridgeVersionFrame(frame), null);
  assert.equal(parseBridgeVersionHost(frame), "Nicks-MacBook-Pro");
});

test("parseBridgeVersionHost rejects a malformed/hostile `host` even inside a well-formed frame", () => {
  assert.equal(parseBridgeVersionHost(JSON.stringify({ t: "bridge-version", v: "0.3.2", host: 42 })), null);
  assert.equal(parseBridgeVersionHost(JSON.stringify({ t: "bridge-version" })), null);
  assert.equal(parseBridgeVersionHost("not json"), null);
  assert.equal(parseBridgeVersionHost(null), null);
});

test("parseBridgeVersionHost re-sanitizes (trims + bounds) even a well-formed `host`", () => {
  assert.equal(
    parseBridgeVersionHost(JSON.stringify({ t: "bridge-version", host: " Nicks-MacBook-Pro " })),
    "Nicks-MacBook-Pro",
  );
  assert.equal(
    parseBridgeVersionHost(JSON.stringify({ t: "bridge-version", host: "" })),
    null,
  );
});

test("a bridge-version frame carrying a full-length host stays within the control-frame length bound", () => {
  const frame = encodeBridgeVersionFrame("999.999.999", "x".repeat(80));
  assert.equal(isBridgeVersionFrame(frame), true);
  assert.equal(parseBridgeVersionHost(frame), "x".repeat(80));
});

// ── exact-conversation resume (rework 5, card cbe60db5) ────────────────────

const CONV_ID = "99999999-8888-7777-6666-555555555555";

test("bridge-version frame's `conv` field encode ⇄ detect ⇄ parse round-trips alongside v/host", () => {
  const frame = encodeBridgeVersionFrame("0.3.3", "Nicks-MacBook-Pro", CONV_ID);
  assert.equal(isBridgeVersionFrame(frame), true);
  assert.equal(parseBridgeVersionFrame(frame), "0.3.3");
  assert.equal(parseBridgeVersionHost(frame), "Nicks-MacBook-Pro");
  assert.equal(parseBridgeVersionConv(frame), CONV_ID);
});

test("a frame with no `conv` (old bridge) parses conv as null — v/host still parse fine", () => {
  const frame = encodeBridgeVersionFrame("0.3.3", "Nicks-MacBook-Pro");
  assert.equal(parseBridgeVersionConv(frame), null);
  assert.equal(parseBridgeVersionFrame(frame), "0.3.3");
  assert.equal(parseBridgeVersionHost(frame), "Nicks-MacBook-Pro");
});

test("a frame carrying only `conv` (no version/host) is still a valid, parseable frame", () => {
  const frame = encodeBridgeVersionFrame(undefined, undefined, CONV_ID);
  assert.equal(isBridgeVersionFrame(frame), true);
  assert.equal(parseBridgeVersionFrame(frame), null);
  assert.equal(parseBridgeVersionHost(frame), null);
  assert.equal(parseBridgeVersionConv(frame), CONV_ID);
});

test("parseBridgeVersionConv rejects a non-UUID, non-string, or malformed `conv`", () => {
  assert.equal(parseBridgeVersionConv(JSON.stringify({ t: "bridge-version", conv: "not-a-uuid" })), null);
  assert.equal(parseBridgeVersionConv(JSON.stringify({ t: "bridge-version", conv: 42 })), null);
  assert.equal(parseBridgeVersionConv(JSON.stringify({ t: "bridge-version" })), null);
  assert.equal(parseBridgeVersionConv("not json"), null);
  assert.equal(parseBridgeVersionConv(null), null);
});

test("a bridge-version frame carrying full-length v + host + conv stays within the control-frame length bound", () => {
  const frame = encodeBridgeVersionFrame("999.999.999", "x".repeat(80), CONV_ID);
  assert.equal(isBridgeVersionFrame(frame), true);
  assert.equal(parseBridgeVersionHost(frame), "x".repeat(80));
  assert.equal(parseBridgeVersionConv(frame), CONV_ID);
});

test("sanitizeConversationId accepts only a strict UUID shape, case-insensitive, lower-cased", () => {
  assert.equal(sanitizeConversationId(CONV_ID), CONV_ID);
  assert.equal(sanitizeConversationId(CONV_ID.toUpperCase()), CONV_ID);
  assert.equal(sanitizeConversationId(` ${CONV_ID} `), CONV_ID);
  assert.equal(sanitizeConversationId(""), null);
  assert.equal(sanitizeConversationId(null), null);
  assert.equal(sanitizeConversationId(undefined), null);
  assert.equal(sanitizeConversationId("not-a-uuid"), null);
  assert.equal(sanitizeConversationId(CONV_ID + "; DROP TABLE users;"), null);
  assert.equal(sanitizeConversationId(CONV_ID.slice(0, -1)), null); // one char short
});

test("sanitizeHelperVersion accepts only strict x.y.z", () => {
  assert.equal(sanitizeHelperVersion("0.2.0"), "0.2.0");
  assert.equal(sanitizeHelperVersion(" 0.2.0 "), "0.2.0");
  assert.equal(sanitizeHelperVersion(""), null);
  assert.equal(sanitizeHelperVersion(null), null);
  assert.equal(sanitizeHelperVersion(undefined), null);
  assert.equal(sanitizeHelperVersion("0.2"), null);
  assert.equal(sanitizeHelperVersion("v0.2.0"), null);
  assert.equal(sanitizeHelperVersion("0.2.0; DROP TABLE users;"), null);
});

test("sanitizeMachineLabel trims, bounds length, and rejects non-strings", () => {
  assert.equal(sanitizeMachineLabel(" Nick's MacBook Pro "), "Nick's MacBook Pro");
  assert.equal(sanitizeMachineLabel(""), null);
  assert.equal(sanitizeMachineLabel("   "), null);
  assert.equal(sanitizeMachineLabel(null), null);
  assert.equal(sanitizeMachineLabel(undefined), null);
  assert.equal(sanitizeMachineLabel(42), null);
  assert.equal(sanitizeMachineLabel("x".repeat(200)).length, 80);
});

// ── helper lifecycle frames (card cc74a067) ────────────────────────────────

test("helper-command frame encode ⇄ detect ⇄ parse round-trips for stop/quiesce", () => {
  for (const cmd of ["stop", "quiesce"]) {
    const frame = encodeHelperCommandFrame(cmd);
    assert.equal(isHelperCommandFrame(frame), true);
    assert.deepEqual(parseHelperCommandFrame(frame), { cmd });
  }
});

test("helper-command frame carries a boolean value for set-always-on", () => {
  const on = encodeHelperCommandFrame("set-always-on", true);
  assert.deepEqual(parseHelperCommandFrame(on), { cmd: "set-always-on", value: true });
  const off = encodeHelperCommandFrame("set-always-on", false);
  assert.deepEqual(parseHelperCommandFrame(off), { cmd: "set-always-on", value: false });
});

test("parseHelperCommandFrame rejects unknown commands and a missing/non-boolean value", () => {
  assert.equal(parseHelperCommandFrame(JSON.stringify({ t: "helper-cmd", cmd: "shutdown-everything" })), null);
  assert.equal(parseHelperCommandFrame(JSON.stringify({ t: "helper-cmd", cmd: "set-always-on" })), null);
  assert.equal(parseHelperCommandFrame(JSON.stringify({ t: "helper-cmd", cmd: "set-always-on", value: "yes" })), null);
  assert.equal(parseHelperCommandFrame(JSON.stringify({ t: "helper-cmd" })), null);
  assert.equal(parseHelperCommandFrame("not json"), null);
  assert.equal(parseHelperCommandFrame(null), null);
});

test("goodbye frame encode ⇄ detect ⇄ parse round-trips for every valid reason", () => {
  for (const reason of ["idle-quit", "stop", "quiesce", "quit", "crash"]) {
    const frame = encodeGoodbyeFrame(reason);
    assert.equal(isGoodbyeFrame(frame), true);
    assert.equal(parseGoodbyeReason(frame), reason);
  }
});

test("parseGoodbyeReason rejects a reason outside the closed set", () => {
  assert.equal(parseGoodbyeReason(JSON.stringify({ t: "goodbye", reason: "bored" })), null);
  assert.equal(parseGoodbyeReason(JSON.stringify({ t: "goodbye" })), null);
  assert.equal(parseGoodbyeReason("not json"), null);
});

test("always-on frame encode ⇄ detect ⇄ parse round-trips both booleans", () => {
  assert.equal(parseAlwaysOnValue(encodeAlwaysOnFrame(true)), true);
  assert.equal(parseAlwaysOnValue(encodeAlwaysOnFrame(false)), false);
  assert.equal(isAlwaysOnFrame(encodeAlwaysOnFrame(true)), true);
});

test("parseAlwaysOnValue rejects a non-boolean value", () => {
  assert.equal(parseAlwaysOnValue(JSON.stringify({ t: "always-on", value: "true" })), null);
  assert.equal(parseAlwaysOnValue(JSON.stringify({ t: "always-on" })), null);
});

test("the three new helper frames stay mutually disjoint and disjoint from every existing frame", () => {
  const frames = [
    encodeHelperCommandFrame("stop"),
    encodeGoodbyeFrame("crash"),
    encodeAlwaysOnFrame(true),
  ];
  const detectors = [isHelperCommandFrame, isGoodbyeFrame, isAlwaysOnFrame];
  for (let i = 0; i < frames.length; i++) {
    for (let j = 0; j < detectors.length; j++) {
      assert.equal(detectors[j](frames[i]), i === j, `frame ${i} vs detector ${j}`);
    }
    assert.equal(isAttachedFrame(frames[i]), false);
    assert.equal(isHeartbeatFrame(frames[i]), false);
    assert.equal(isBridgeVersionFrame(frames[i]), false);
    assert.equal(parseControlMessage(frames[i]), null);
  }
});
