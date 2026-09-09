// Unit tests for the shared login-shell PATH resolver.
// Run: cd terminal/shared && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fallbackBinDirs, resolveLoginShellPath, pathFallbackShellSnippet } from "./spawn-path.mjs";

test("fallbackBinDirs includes the three well-known dirs", () => {
  const dirs = fallbackBinDirs();
  assert.equal(dirs.length, 3);
  assert.ok(dirs.some((d) => d.endsWith("/.local/bin")));
  assert.ok(dirs.includes("/opt/homebrew/bin"));
  assert.ok(dirs.includes("/usr/local/bin"));
});

test("win32 is a passthrough of env.PATH (no shell probe)", () => {
  const path = resolveLoginShellPath({ platform: "win32", env: { PATH: "C:\\Windows" } });
  assert.equal(path, "C:\\Windows");
});

test("a successful shell probe wins and gets the fallbacks appended", () => {
  const run = () => '__PATH__/usr/bin:/custom/bin__END__';
  const path = resolveLoginShellPath({ platform: "darwin", run, env: {} });
  assert.ok(path.startsWith("/usr/bin:/custom/bin:"));
  for (const dir of fallbackBinDirs()) assert.ok(path.includes(dir));
});

test("a failing shell probe falls back to env.PATH + fallbacks, never throws", () => {
  const run = () => { throw new Error("boom"); };
  const path = resolveLoginShellPath({ platform: "darwin", run, env: { PATH: "/usr/bin" } });
  assert.ok(path.startsWith("/usr/bin:"));
  for (const dir of fallbackBinDirs()) assert.ok(path.includes(dir));
});

test("a fallback dir already present in PATH is not duplicated", () => {
  const run = () => `__PATH__/usr/bin:/opt/homebrew/bin__END__`;
  const path = resolveLoginShellPath({ platform: "darwin", run, env: {} });
  const occurrences = path.split(":").filter((p) => p === "/opt/homebrew/bin").length;
  assert.equal(occurrences, 1);
});

test("pathFallbackShellSnippet is a well-formed export line naming all three dirs", () => {
  const snippet = pathFallbackShellSnippet();
  assert.ok(snippet.startsWith('export PATH="$PATH:'));
  for (const dir of fallbackBinDirs()) assert.ok(snippet.includes(dir));
});
