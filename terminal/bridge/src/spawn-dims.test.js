// Unit tests for the PTY spawn-size resolution (Bug B, card cbe60db5 — Nick's
// field test 2026-08-15: a promptless/Resume launch rendered narrow because
// the PTY spawned at a hardcoded 80x24 before any real resize could land).
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSpawnDims, DEFAULT_SPAWN_COLS, DEFAULT_SPAWN_ROWS } from "./spawn-dims.js";

test("a validated cols/rows pair on the launch is used verbatim", () => {
  const result = resolveSpawnDims({ cols: 137, rows: 42 });
  assert.deepEqual(result, { cols: 137, rows: 42 });
});

test("no launch (bare CLI run, no --launch-url) falls back to the historical default", () => {
  assert.deepEqual(resolveSpawnDims(null), { cols: DEFAULT_SPAWN_COLS, rows: DEFAULT_SPAWN_ROWS });
  assert.deepEqual(resolveSpawnDims(undefined), { cols: DEFAULT_SPAWN_COLS, rows: DEFAULT_SPAWN_ROWS });
});

test("a launch that carried no dims at all falls back to the default — no regression for an old app build", () => {
  assert.deepEqual(
    resolveSpawnDims({ relay: "ws://x", session: "s", token: "t" }),
    { cols: DEFAULT_SPAWN_COLS, rows: DEFAULT_SPAWN_ROWS },
  );
});

test("a lone valid dimension (the other missing/malformed) falls back on the missing side only", () => {
  assert.deepEqual(resolveSpawnDims({ cols: 120 }), { cols: 120, rows: DEFAULT_SPAWN_ROWS });
  assert.deepEqual(resolveSpawnDims({ rows: 40 }), { cols: DEFAULT_SPAWN_COLS, rows: 40 });
});

test("non-sane dims (zero, negative, non-integer, absurdly large, NaN) fall back to the default", () => {
  for (const bad of [0, -5, 12.5, 100000, NaN, "abc"]) {
    assert.deepEqual(
      resolveSpawnDims({ cols: bad, rows: 40 }),
      { cols: DEFAULT_SPAWN_COLS, rows: 40 },
      `cols=${bad} must fall back`,
    );
  }
});

test("string-shaped numeric dims (URL params are always strings before parseLaunchDeepLink coerces them) still resolve", () => {
  // Defense-in-depth: resolveSpawnDims itself re-validates with Number(), so
  // it stays correct even if a caller hands it raw, un-coerced values.
  assert.deepEqual(resolveSpawnDims({ cols: "137", rows: "42" }), { cols: 137, rows: 42 });
});
