// Unit tests for the pure quit-when-idle decision module (terminal/helper/lifecycle.js).
//
// Mirrors proto-reg.test.mjs's pattern: a plain CJS module under terminal/helper,
// required here via createRequire and exercised without an Electron runtime.
//
// Run: cd terminal/test && node helper-lifecycle-module.test.mjs   (or via `npm test`)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { LINGER_MS, decideLingerAction, shouldQuitOnLingerExpiry } = require("../helper/lifecycle.js");

test("LINGER_MS is the design's 60s window", () => {
  assert.equal(LINGER_MS, 60_000);
});

test("decideLingerAction: no bridges, always-on off -> start", () => {
  assert.equal(decideLingerAction({ bridgeCount: 0, alwaysOn: false }), "start");
});

test("decideLingerAction: any live bridge -> cancel, regardless of always-on", () => {
  assert.equal(decideLingerAction({ bridgeCount: 1, alwaysOn: false }), "cancel");
  assert.equal(decideLingerAction({ bridgeCount: 3, alwaysOn: false }), "cancel");
  assert.equal(decideLingerAction({ bridgeCount: 1, alwaysOn: true }), "cancel");
});

test("decideLingerAction: always-on on, no bridges -> cancel (never linger toward quit)", () => {
  assert.equal(decideLingerAction({ bridgeCount: 0, alwaysOn: true }), "cancel");
});

test("shouldQuitOnLingerExpiry: idle + always-on off -> true", () => {
  assert.equal(shouldQuitOnLingerExpiry({ bridgeCount: 0, alwaysOn: false }), true);
});

test("shouldQuitOnLingerExpiry: a bridge re-attached before the timer fired -> false", () => {
  assert.equal(shouldQuitOnLingerExpiry({ bridgeCount: 1, alwaysOn: false }), false);
});

test("shouldQuitOnLingerExpiry: always-on flipped on before the timer fired -> false", () => {
  assert.equal(shouldQuitOnLingerExpiry({ bridgeCount: 0, alwaysOn: true }), false);
});

test("shouldQuitOnLingerExpiry: always-on on AND a bridge live -> false", () => {
  assert.equal(shouldQuitOnLingerExpiry({ bridgeCount: 2, alwaysOn: true }), false);
});
