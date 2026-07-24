// Unit tests for the relay's activity-persist throttle (MITIGATION 1).
// Run: cd terminal/relay && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldPersistActivity, DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS } from "./activity-throttle.js";

test("first call with no cached last-persisted time always persists", () => {
  assert.equal(shouldPersistActivity(1_000, null), true);
  assert.equal(shouldPersistActivity(1_000, undefined), true);
});

test("a message inside the throttle window is suppressed", () => {
  const last = 10_000;
  assert.equal(shouldPersistActivity(last + 1, last), false);
  assert.equal(shouldPersistActivity(last + DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS - 1, last), false);
});

test("a message at/after the throttle window persists", () => {
  const last = 10_000;
  assert.equal(shouldPersistActivity(last + DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS, last), true);
  assert.equal(shouldPersistActivity(last + DEFAULT_ACTIVITY_PERSIST_THROTTLE_MS + 500, last), true);
});

test("a custom throttleMs is honored", () => {
  const last = 5_000;
  assert.equal(shouldPersistActivity(last + 100, last, 200), false);
  assert.equal(shouldPersistActivity(last + 200, last, 200), true);
});

test("clock skew / stale timestamp (now < lastPersistedAt) never throws and suppresses", () => {
  assert.equal(shouldPersistActivity(500, 1_000), false);
});
