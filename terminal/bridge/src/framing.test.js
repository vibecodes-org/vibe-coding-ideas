// Unit tests for the bridge<->browser framing helpers.
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeResize, parseControlMessage, isValidDim } from "./framing.js";

test("encodeResize round-trips through parseControlMessage", () => {
  const wire = encodeResize(120, 30);
  assert.deepEqual(parseControlMessage(wire), { type: "resize", cols: 120, rows: 30 });
});

test("parseControlMessage rejects non-JSON (so raw terminal text is never parsed)", () => {
  assert.equal(parseControlMessage("npm run test\n"), null);
  assert.equal(parseControlMessage(""), null);
  assert.equal(parseControlMessage("{not json"), null);
});

test("parseControlMessage rejects unknown control types", () => {
  assert.equal(parseControlMessage(JSON.stringify({ type: "explode" })), null);
});

test("parseControlMessage rejects resize with bad dimensions", () => {
  assert.equal(parseControlMessage(JSON.stringify({ type: "resize", cols: 0, rows: 24 })), null);
  assert.equal(parseControlMessage(JSON.stringify({ type: "resize", cols: 80, rows: -1 })), null);
  assert.equal(parseControlMessage(JSON.stringify({ type: "resize", cols: 80 })), null);
  assert.equal(parseControlMessage(JSON.stringify({ type: "resize", cols: 99999, rows: 24 })), null);
});

test("parseControlMessage coerces numeric strings (xterm sometimes sends strings)", () => {
  assert.deepEqual(parseControlMessage(JSON.stringify({ type: "resize", cols: "80", rows: "24" })), {
    type: "resize",
    cols: 80,
    rows: 24,
  });
});

test("isValidDim guards the PTY against insane values", () => {
  assert.equal(isValidDim(80), true);
  assert.equal(isValidDim(1), true);
  assert.equal(isValidDim(1000), true);
  assert.equal(isValidDim(0), false);
  assert.equal(isValidDim(-5), false);
  assert.equal(isValidDim(1001), false);
  assert.equal(isValidDim(3.5), false);
  assert.equal(isValidDim(NaN), false);
});
