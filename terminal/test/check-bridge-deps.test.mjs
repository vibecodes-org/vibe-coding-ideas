// The helper's pre-build check names the build's own system (card 51d424f7,
// release 1b): a Windows build needs the Windows node-pty builds, a Mac build
// the Mac ones. Before 1b it only ever checked the Apple-chip Mac build.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { buildPlatform, requiredBridgeModules } from "../helper/scripts/check-bridge-deps.mjs";

test("a Mac build checks both Mac node-pty builds", () => {
  assert.equal(buildPlatform([]), "darwin");
  assert.deepEqual(requiredBridgeModules("darwin"), [
    "ws",
    "node-pty",
    join("node-pty", "prebuilds", "darwin-arm64"),
    join("node-pty", "prebuilds", "darwin-x64"),
  ]);
});

test("a Windows build checks both Windows node-pty builds", () => {
  assert.equal(buildPlatform(["--win"]), "win32");
  assert.deepEqual(requiredBridgeModules("win32").slice(2), [
    join("node-pty", "prebuilds", "win32-arm64"),
    join("node-pty", "prebuilds", "win32-x64"),
  ]);
});

test("the Windows build script runs the check with --win", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../helper/package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["predist:win"], /check-bridge-deps\.mjs --win/);
  assert.match(pkg.scripts.predist, /check-bridge-deps\.mjs$/);
});

test("the packed app keeps each system's node-pty builds and drops the other's", () => {
  const yml = fs.readFileSync(new URL("../helper/electron-builder.yml", import.meta.url), "utf8");
  const section = (name) => {
    const start = yml.search(new RegExp(`^${name}:`, "m"));
    assert.ok(start >= 0, name);
    const rest = yml.slice(yml.indexOf("\n", start) + 1);
    const end = rest.search(/^\S/m);
    return end < 0 ? rest : rest.slice(0, end);
  };
  assert.match(section("mac"), /!\*\*\/node-pty\/prebuilds\/win32-\*\/\*\*/);
  assert.doesNotMatch(section("mac"), /darwin-\*/);
  assert.match(section("win"), /!\*\*\/node-pty\/prebuilds\/darwin-\*\/\*\*/);
  assert.doesNotMatch(section("win"), /win32-\*/);
  assert.match(yml, /^\s*- helper-copy\.js\s*$/m);
});
