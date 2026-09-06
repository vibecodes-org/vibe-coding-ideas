// Unit tests for the helper's standing "is codex/claude installed?" signal
// (terminal/helper/agent-availability.mjs) — Codex support, docs/
// codex-terminal-requirements.md FR-3's helper-side half.
//
// Run: cd terminal/test && node agent-availability.test.mjs  (or via `npm test`)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkAgentAvailability, KNOWN_AGENT_BINARIES } from "../helper/agent-availability.mjs";

function makeFakeBin(dir, name) {
  fs.writeFileSync(path.join(dir, name), "#!/bin/sh\necho fake\n", { mode: 0o755 });
}

test("KNOWN_AGENT_BINARIES names exactly claude and codex", () => {
  assert.deepEqual(KNOWN_AGENT_BINARIES, { claude: "claude", codex: "codex" });
});

test("both installed -> both true", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-avail-both-"));
  makeFakeBin(dir, "claude");
  makeFakeBin(dir, "codex");
  const result = await checkAgentAvailability({ pathEnv: dir });
  assert.deepEqual(result, { claude: true, codex: true });
});

test("neither installed -> both false", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-avail-neither-"));
  const result = await checkAgentAvailability({ pathEnv: dir });
  assert.deepEqual(result, { claude: false, codex: false });
});

test("only codex installed -> mixed result, independent checks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-avail-mixed-"));
  makeFakeBin(dir, "codex");
  const result = await checkAgentAvailability({ pathEnv: dir });
  assert.deepEqual(result, { claude: false, codex: true });
});

test("when pathEnv is not given, it resolves the login-shell PATH via the injected resolver", async () => {
  let called = false;
  const result = await checkAgentAvailability({
    resolveLoginShellPathImpl: () => {
      called = true;
      return "/nonexistent/path";
    },
    isBinaryInstalledImpl: () => false,
  });
  assert.equal(called, true);
  assert.deepEqual(result, { claude: false, codex: false });
});

test("isBinaryInstalledImpl override lets a caller stub the underlying check entirely", async () => {
  const result = await checkAgentAvailability({
    pathEnv: "/anything",
    isBinaryInstalledImpl: (name) => name === "codex",
  });
  assert.deepEqual(result, { claude: false, codex: true });
});

test("supplying BOTH overrides never triggers the dev/test-only fallback import", async () => {
  // Regression guard for the packaging note in agent-availability.mjs's own
  // header: when a caller (main.js, always) supplies both overrides, the
  // lazy fallback import of ../shared/spawn-path.mjs / binary-check.mjs must
  // never even be attempted. Simulated by making the fallback path fail
  // loudly (pathEnv absent, both impls present, resolveLoginShellPathImpl
  // still not needed as pathEnv is given directly here) — if this test
  // passes without an unhandled rejection, the short-circuit held.
  const result = await checkAgentAvailability({
    pathEnv: "irrelevant",
    resolveLoginShellPathImpl: () => {
      throw new Error("must not be called — pathEnv was supplied");
    },
    isBinaryInstalledImpl: () => true,
  });
  assert.deepEqual(result, { claude: true, codex: true });
});
