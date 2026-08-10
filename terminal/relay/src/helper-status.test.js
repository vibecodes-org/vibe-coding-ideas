// Unit tests for the pure helper-status derivation (card cc74a067).
//
// Run: cd terminal/relay && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHelperStatus, STOPPED_UNEXPECTEDLY_TTL_MS } from "./helper-status.js";

const NOW = 1_700_000_000_000;

test("connected: reports the live fields, never stoppedUnexpectedly", () => {
  const status = computeHelperStatus({
    connected: true,
    version: "0.3.0",
    machineLabel: "Nick's MacBook Pro",
    alwaysOn: true,
    uncleanAt: NOW - 5000, // stale from a PRIOR disconnect — connected now overrides it
    now: NOW,
  });
  assert.deepEqual(status, {
    connected: true,
    version: "0.3.0",
    machineLabel: "Nick's MacBook Pro",
    alwaysOn: true,
    stoppedUnexpectedly: false,
    lastEventAt: null,
  });
});

test("not connected, no unclean disconnect on file -> plain 'not running'", () => {
  const status = computeHelperStatus({ connected: false, now: NOW });
  assert.equal(status.stoppedUnexpectedly, false);
  assert.equal(status.lastEventAt, null);
});

test("not connected + a recent unclean disconnect -> stoppedUnexpectedly with its timestamp", () => {
  const uncleanAt = NOW - 1000;
  const status = computeHelperStatus({ connected: false, uncleanAt, now: NOW });
  assert.equal(status.stoppedUnexpectedly, true);
  assert.equal(status.lastEventAt, uncleanAt);
});

test("the unclean flag clears on its own after STOPPED_UNEXPECTEDLY_TTL_MS (design's 24h rule)", () => {
  const uncleanAt = NOW - STOPPED_UNEXPECTEDLY_TTL_MS - 1;
  const status = computeHelperStatus({ connected: false, uncleanAt, now: NOW });
  assert.equal(status.stoppedUnexpectedly, false);
  assert.equal(status.lastEventAt, null);
});

test("exactly at the TTL boundary is no longer stoppedUnexpectedly (strict <)", () => {
  const uncleanAt = NOW - STOPPED_UNEXPECTEDLY_TTL_MS;
  const status = computeHelperStatus({ connected: false, uncleanAt, now: NOW });
  assert.equal(status.stoppedUnexpectedly, false);
});

test("defaults: version/machineLabel null, alwaysOn false when omitted", () => {
  const status = computeHelperStatus({ connected: true, now: NOW });
  assert.equal(status.version, null);
  assert.equal(status.machineLabel, null);
  assert.equal(status.alwaysOn, false);
});

test("a custom unexpectedTtlMs overrides the default (relay env override parity)", () => {
  const uncleanAt = NOW - 1000;
  const status = computeHelperStatus({ connected: false, uncleanAt, now: NOW, unexpectedTtlMs: 500 });
  assert.equal(status.stoppedUnexpectedly, false, "1000ms ago is past a 500ms TTL");
});
