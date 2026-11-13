import { test } from "node:test";
import assert from "node:assert/strict";
import { toSpawnable, escapeCmdArg, shimScriptTarget, isBatchShim } from "./spawnable.mjs";

const WIN = { platform: "win32" };
const NPM_SHIM = [
  "@ECHO off",
  "SETLOCAL",
  'SET "_prog=node"',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join("\r\n");

test("non-Windows: nothing changes, prompt stays one argv element", () => {
  const args = ["--model", "x", "line one\nline two & more"];
  const r = toSpawnable("/usr/local/bin/claude", args, { platform: "darwin" });
  assert.deepEqual(r, { file: "/usr/local/bin/claude", args, via: "direct" });
});

test("Windows: a native .exe is spawned directly", () => {
  const args = ["hello world"];
  assert.deepEqual(toSpawnable("C:\\Users\\a\\.local\\bin\\claude.exe", args, WIN), {
    file: "C:\\Users\\a\\.local\\bin\\claude.exe",
    args,
    via: "direct",
  });
});

test("isBatchShim", () => {
  assert.ok(isBatchShim("C:\\x\\claude.cmd"));
  assert.ok(isBatchShim("C:\\x\\CLAUDE.BAT"));
  assert.ok(!isBatchShim("C:\\x\\claude.exe"));
});

test("shimScriptTarget reads the npm shim's real script", () => {
  assert.equal(
    shimScriptTarget("C:\\npm\\claude.cmd", () => NPM_SHIM),
    "C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
  );
  assert.equal(shimScriptTarget("C:\\npm\\x.cmd", () => "@echo off\r\nfoo"), null);
  assert.equal(shimScriptTarget("C:\\npm\\x.cmd", () => { throw new Error("nope"); }), null);
});

test("Windows npm shim runs node on the script directly, keeping newlines intact", () => {
  const prompt = "line one\nline two \"quoted\" & | ^ %PATH%";
  const r = toSpawnable("C:\\npm\\claude.cmd", ["--x", prompt], {
    ...WIN,
    readFile: () => NPM_SHIM,
    exists: (p) => p === "C:\\npm\\node.exe",
  });
  assert.equal(r.via, "node-shim");
  assert.equal(r.file, "C:\\npm\\node.exe");
  assert.deepEqual(r.args, ["C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js", "--x", prompt]);
});

test("Windows npm shim with node elsewhere on PATH uses findNode", () => {
  const r = toSpawnable("C:\\npm\\claude.cmd", ["a"], {
    ...WIN,
    readFile: () => NPM_SHIM,
    exists: () => false,
    findNode: () => "C:\\Program Files\\nodejs\\node.exe",
  });
  assert.equal(r.via, "node-shim");
  assert.equal(r.file, "C:\\Program Files\\nodejs\\node.exe");
});

test("Windows unknown .cmd falls back to cmd.exe with every argument escaped", () => {
  const r = toSpawnable("C:\\Program Files\\t\\tool.cmd", ["a b", 'say "hi" & del *'], {
    ...WIN,
    readFile: () => "@echo off\r\nfoo",
    comspec: "C:\\Windows\\System32\\cmd.exe",
  });
  assert.equal(r.via, "cmd");
  assert.equal(r.file, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(typeof r.args, "string");
  assert.ok(r.args.startsWith('/d /s /c "'));
  assert.ok(r.args.endsWith('"'));
  // The program path's space is caret-escaped, not left bare.
  assert.ok(r.args.includes("C:\\Program^ Files\\t\\tool.cmd"));
});

test("cmd escaping: no metacharacter is ever left bare (no breakout)", () => {
  const nasty = 'x" & calc | echo ^ %USERNAME% > out < in ( ) ! ;, \\';
  const esc = escapeCmdArg(nasty);
  // Strip every caret-escaped char; what remains must contain none of the metas.
  const bare = esc.replace(/\^./g, "");
  assert.ok(!/[()%!^"<>&|;, ]/.test(bare), `bare metacharacter left in: ${esc}`);
});

test("cmd fallback flattens newlines (cmd cannot carry them) and says so", () => {
  const r = toSpawnable("C:\\t\\tool.bat", ["one\ntwo"], { ...WIN, readFile: () => "x" });
  assert.equal(r.collapsedNewlines, true);
  assert.ok(!/[\r\n]/.test(r.args));
  const none = toSpawnable("C:\\t\\tool.bat", ["one two"], { ...WIN, readFile: () => "x" });
  assert.equal(none.collapsedNewlines, false);
});

test("cmd fallback refuses any % (cmd expands %VAR%, %VAR:~0%, %VAR:a=b%)", () => {
  for (const bad of ["%PATH%", "%PATH:~0%", "%PATH:a=b%", "100%"]) {
    assert.throws(
      () => toSpawnable("C:\\t\\tool.cmd", ["x", bad], { ...WIN, readFile: () => "x" }),
      (e) => e.code === "CMD_PERCENT_REFUSED",
      bad,
    );
  }
  assert.throws(() => toSpawnable("C:\\t%x%\\tool.cmd", ["a"], { ...WIN, readFile: () => "x" }));
});

test("a % in the prompt is fine on the node-shim route (no shell involved)", () => {
  const r = toSpawnable("C:\\npm\\claude.cmd", ["100%", "%PATH:~0%"], {
    ...WIN,
    readFile: () => NPM_SHIM,
    exists: () => true,
  });
  assert.equal(r.via, "node-shim");
  assert.deepEqual(r.args.slice(1), ["100%", "%PATH:~0%"]);
});
