// Unit tests for the shared relay→bridge `attached` control frame (R1).
//
// The frame is the ONLY signal that releases a prompt-carrying PTY spawn, so its
// encode/detect pair must be strict, symmetric, and disjoint from the existing
// browser→bridge control namespace ({"type":"resize",…}).
//
// Run: cd terminal/test && node --test

import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAttachedFrame, isAttachedFrame } from "../shared/control-frames.mjs";
import { parseControlMessage } from "../bridge/src/framing.js";

test("encode ⇄ detect round-trips", () => {
  assert.equal(isAttachedFrame(encodeAttachedFrame()), true);
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
