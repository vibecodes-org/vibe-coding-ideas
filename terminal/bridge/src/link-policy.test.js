import { test } from "node:test";
import assert from "node:assert/strict";
import { isWake, reconnectDelay, endCourtesyMs } from "./link-policy.js";

test("isWake only on a long gap between ticks", () => {
  assert.equal(isWake(null, 1000), false);
  assert.equal(isWake(0, 5000), false);
  assert.equal(isWake(0, 8 * 3600 * 1000), true);
});

test("reconnect delay doubles and caps at 30s", () => {
  const z = () => 0;
  assert.equal(reconnectDelay(0, z), 1000);
  assert.equal(reconnectDelay(3, z), 8000);
  assert.equal(reconnectDelay(5, z), 30_000);
  assert.equal(reconnectDelay(40, z), 30_000);
});

test("end courtesy windows", () => {
  assert.equal(endCourtesyMs("pty-exit"), 10_000);
  assert.equal(endCourtesyMs("agent-stopped-early:1"), 10_000);
  assert.equal(endCourtesyMs("SIGTERM"), 3_000);
  assert.equal(endCourtesyMs("helper-gone"), 0);
  assert.equal(endCourtesyMs("max-duration"), 0);
});
