// Unit tests for the shared login-shell PATH resolver.
// Run: cd terminal/shared && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { sep as pathSep } from "node:path";
import { fallbackBinDirs, resolveLoginShellPath, pathFallbackShellSnippet } from "./spawn-path.mjs";

test("fallbackBinDirs includes the three well-known dirs", () => {
  const dirs = fallbackBinDirs();
  assert.equal(dirs.length, 3);
  assert.ok(dirs.some((d) => d.endsWith(`${pathSep}.local${pathSep}bin`)));
  assert.ok(dirs.includes("/opt/homebrew/bin"));
  assert.ok(dirs.includes("/usr/local/bin"));
});

test("win32 never runs a login shell: it merges env PATH with the registry PATHs", () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[1].startsWith("HKCU")) {
      return "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Roaming\\npm;C:\\Windows\r\n\r\n";
    }
    return "\r\nHKEY_LOCAL_MACHINE\\...\r\n    Path    REG_EXPAND_SZ    C:\\Program Files\\Git\\cmd\r\n";
  };
  const out = resolveLoginShellPath({
    platform: "win32",
    run,
    env: { PATH: "C:\\Windows;C:\\Tools", USERPROFILE: "C:\\Users\\sam" },
  });
  const parts = out.split(";");
  assert.deepEqual(parts.slice(0, 2), ["C:\\Windows", "C:\\Tools"]);
  assert.ok(parts.includes("C:\\Users\\sam\\AppData\\Roaming\\npm"), "registry %VAR% expanded");
  assert.ok(parts.includes("C:\\Program Files\\Git\\cmd"), "machine PATH merged");
  assert.equal(parts.filter((p) => p.toLowerCase() === "c:\\windows").length, 1, "no duplicates");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c[0] === "reg"));
});

test("win32: a failing registry read keeps the current PATH, never throws", () => {
  const run = () => { throw new Error("no reg"); };
  const out = resolveLoginShellPath({ platform: "win32", run, env: { PATH: "C:\\Windows", USERPROFILE: "C:\\Users\\sam" } });
  assert.ok(out.startsWith("C:\\Windows;"));
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
