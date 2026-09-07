// Unit tests for terminal/helper/control-url.mjs — the pure control-connection
// URL/param builder shared by main.js's connectControl (primary) and
// connectOpenTerminalControl (dedicated open-terminal handshake). No
// Electron, no `ws`, no network.
//
// Run: cd terminal/test && node --test control-url.test.mjs   (or: npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildControlConnectUrl } from "../helper/control-url.mjs";

function baseArgs(extra = {}) {
  return {
    relayBase: "wss://relay.example.com",
    sid: "sess-123",
    token: "tok-abc",
    helperVersion: "0.3.12",
    machineLabel: "Nicks-MBP",
    alwaysOn: false,
    ...extra,
  };
}

test("builds the expected params for a primary connect (no purpose)", () => {
  const url = buildControlConnectUrl(baseArgs());
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("session"), "sess-123");
  assert.equal(parsed.searchParams.get("role"), "helper");
  assert.equal(parsed.searchParams.get("token"), "tok-abc");
  assert.equal(parsed.searchParams.get("helperVersion"), "0.3.12");
  assert.equal(parsed.searchParams.get("machineLabel"), "Nicks-MBP");
  assert.equal(parsed.searchParams.get("alwaysOn"), "0");
  assert.equal(parsed.searchParams.has("purpose"), false, "no purpose param for a primary connect");
});

test("alwaysOn true is reported as \"1\"", () => {
  const url = buildControlConnectUrl(baseArgs({ alwaysOn: true }));
  assert.equal(new URL(url).searchParams.get("alwaysOn"), "1");
});

test("includes purpose=open-terminal when passed (the handshake socket's marker)", () => {
  const url = buildControlConnectUrl(baseArgs({ purpose: "open-terminal" }));
  assert.equal(new URL(url).searchParams.get("purpose"), "open-terminal");
});

test("omits codexInstalled/claudeInstalled when availability is null (unknown — graceful degrade)", () => {
  const url = buildControlConnectUrl(baseArgs({ availability: null }));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.has("codexInstalled"), false);
  assert.equal(parsed.searchParams.has("claudeInstalled"), false);
});

test("reports availability booleans as \"1\"/\"0\" when present", () => {
  const url = buildControlConnectUrl(baseArgs({ availability: { codex: true, claude: false } }));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("codexInstalled"), "1");
  assert.equal(parsed.searchParams.get("claudeInstalled"), "0");
});

test("strips a trailing slash from relayBase before appending the query", () => {
  const url = buildControlConnectUrl(baseArgs({ relayBase: "wss://relay.example.com/" }));
  assert.ok(url.startsWith("wss://relay.example.com/?"), url);
  assert.ok(!url.startsWith("wss://relay.example.com//"), url);
});

test("a primary-shaped call and a handshake-shaped call differ ONLY in the purpose param", () => {
  const primary = new URL(buildControlConnectUrl(baseArgs()));
  const handshake = new URL(buildControlConnectUrl(baseArgs({ purpose: "open-terminal" })));
  primary.searchParams.delete("purpose");
  handshake.searchParams.delete("purpose");
  assert.equal(primary.toString(), handshake.toString());
  assert.equal(new URL(buildControlConnectUrl(baseArgs({ purpose: "open-terminal" }))).searchParams.get("purpose"), "open-terminal");
});
