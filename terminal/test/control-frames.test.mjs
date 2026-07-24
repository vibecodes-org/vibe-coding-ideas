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
  sanitizeHelperVersion,
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
