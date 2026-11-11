import { test } from "node:test";
import assert from "node:assert/strict";
import { createBusyTracker, isBusy } from "./busy-tracker.js";

test("isBusy is false with no output and true inside the window", () => {
  assert.equal(isBusy(null, 1000), false);
  assert.equal(isBusy(1000, 1000 + 119_999), true);
  assert.equal(isBusy(1000, 1000 + 120_000), false);
});

test("reports busy on output and quiet after the window, once each", () => {
  const events = [];
  const t = createBusyTracker((b) => events.push(b));
  t.output(0);
  t.output(1000);
  t.tick(60_000);
  assert.deepEqual(events, [true]);
  t.tick(121_001);
  assert.deepEqual(events, [true, false]);
  t.tick(200_000);
  assert.deepEqual(events, [true, false]);
});

test("stop clears busy at once", () => {
  const events = [];
  const t = createBusyTracker((b) => events.push(b));
  t.output(5);
  t.stop();
  assert.deepEqual(events, [true, false]);
});
