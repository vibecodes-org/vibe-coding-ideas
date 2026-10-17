// Unit tests for the Mac's machine names (card 6b2cb8ac).
// Run: cd terminal/test && npm test (listed there), or cd terminal/shared && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMachineNames } from "./machine-name.mjs";

test("darwin: the fixed LocalHostName comes first, a drifted hostname is kept as an alias", () => {
  const calls = [];
  const run = (file, args) => {
    calls.push([file, args]);
    return "Nicks-MacBook-Pro\n";
  };
  const out = resolveMachineNames({ hostname: "Nicks-MBP.home.local", platform: "darwin", run });
  assert.deepEqual(out, { canonical: "Nicks-MacBook-Pro.local", names: ["Nicks-MacBook-Pro.local", "Nicks-MBP.home.local"] });
  assert.deepEqual(calls, [["/usr/sbin/scutil", ["--get", "LocalHostName"]]]);
});

test("darwin: equal names (case-insensitive) collapse to one", () => {
  const out = resolveMachineNames({ hostname: "nicks-mac-mini.local", platform: "darwin", run: () => "Nicks-Mac-mini" });
  assert.deepEqual(out, { canonical: "Nicks-Mac-mini.local", names: ["Nicks-Mac-mini.local"] });
});

test("darwin: scutil failing falls back to the hostname only, never throws", () => {
  const out = resolveMachineNames({
    hostname: "Nicks-MacBook-Pro.local",
    platform: "darwin",
    run: () => {
      throw new Error("not set");
    },
  });
  assert.deepEqual(out, { canonical: "Nicks-MacBook-Pro.local", names: ["Nicks-MacBook-Pro.local"] });
});

test("darwin: empty scutil output falls back to the hostname", () => {
  const out = resolveMachineNames({ hostname: "box.local", platform: "darwin", run: () => "  \n" });
  assert.deepEqual(out.names, ["box.local"]);
});

test("non-darwin: hostname only, scutil never called", () => {
  let called = false;
  const out = resolveMachineNames({
    hostname: "devbox",
    platform: "linux",
    run: () => {
      called = true;
      return "x";
    },
  });
  assert.equal(called, false);
  assert.deepEqual(out, { canonical: "devbox", names: ["devbox"] });
});

test("names are bounded like a machine label", () => {
  const long = "a".repeat(200);
  const out = resolveMachineNames({ hostname: long, platform: "linux", run: () => "" });
  assert.equal(out.canonical.length, 80);
});

test("no usable name at all → empty list", () => {
  const out = resolveMachineNames({ hostname: "", platform: "linux", run: () => "" });
  assert.deepEqual(out, { canonical: null, names: [] });
});
