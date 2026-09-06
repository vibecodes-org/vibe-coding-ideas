// Unit tests for the desktop-Codex launch-script builder (terminal/helper/
// open-terminal.mjs) — Codex support, docs/codex-terminal-requirements.md
// FR-11/FR-13, AC-14/15/17/19.
//
// buildOpenTerminalScript() is a pure string builder (no fs/child_process),
// so most of this file asserts on the STRING it returns. A handful of tests
// additionally run the generated script through a REAL `bash` (this sandbox
// has one; no `codex` binary is ever needed — see the note below) to prove
// the quoting survives an actual shell parse, not just a regex match.
//
// NOTE ON THE FAKE "codex" STAND-IN: the generated script always execs the
// literal binary name `codex` (that fixed-name guarantee is exactly what the
// static assertions below check). The dynamic execution tests substitute a
// differently-named stand-in binary INTO A COPY of the generated text purely
// so this test can run without a real `codex` on PATH — `execedTextFor()`
// does that substitution and simultaneously proves the unmodified script
// really did contain the exact `exec codex …` line being replaced. Production
// code (terminal/helper/main.js) never does this substitution — it always
// runs the script exactly as buildOpenTerminalScript produced it.
//
// Run: cd terminal/test && node open-terminal.test.mjs   (or via `npm test`)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildOpenTerminalScript,
  shellSingleQuote,
  randomHeredocDelimiter,
  randomScriptFilename,
  sanitizePromptForDisplay,
  WINDOW_TITLE,
} from "../helper/open-terminal.mjs";

const PATH_SNIPPET = 'export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"';

// ── shellSingleQuote ─────────────────────────────────────────────────────────

test("shellSingleQuote wraps plain text in single quotes", () => {
  assert.equal(shellSingleQuote("hello"), "'hello'");
});

test("shellSingleQuote escapes an embedded single quote correctly", () => {
  assert.equal(shellSingleQuote("it's"), `'it'\\''s'`);
});

test("shellSingleQuote is idempotent-safe for repeated quotes", () => {
  assert.equal(shellSingleQuote("''"), `''\\'''\\'''`);
});

// ── randomHeredocDelimiter / randomScriptFilename ───────────────────────────

test("randomHeredocDelimiter is unique per call and carries a fixed prefix", () => {
  const a = randomHeredocDelimiter();
  const b = randomHeredocDelimiter();
  assert.notEqual(a, b);
  assert.ok(a.startsWith("VIBECODES_PROMPT_"));
});

test("randomScriptFilename is unique per call, has the .command extension, no path separators", () => {
  const a = randomScriptFilename();
  const b = randomScriptFilename();
  assert.notEqual(a, b);
  assert.ok(a.endsWith(".command"));
  assert.ok(!a.includes("/"));
  assert.ok(a.startsWith("vibecodes-codex-"));
});

// ── buildOpenTerminalScript: static text properties ─────────────────────────

test("requires a non-empty cwd", () => {
  assert.throws(() => buildOpenTerminalScript({ cwd: "", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET }));
  assert.throws(() => buildOpenTerminalScript({ prompt: "hi", pathFallbackSnippet: PATH_SNIPPET }));
});

test("self-deletes as the very first executable line (FR-11 temp-file hygiene)", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET });
  const lines = script.split("\n");
  assert.equal(lines[0], "#!/bin/bash");
  const firstExecutable = lines.slice(1).find((l) => l.trim() && !l.trim().startsWith("#"));
  assert.equal(firstExecutable, 'rm -f -- "$0"');
});

test("only the FIXED binary `codex` is ever named in the exec lines — never a variable or the prompt", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET });
  assert.ok(script.includes('exec codex "$PROMPT"'));
  assert.ok(script.includes("exec codex\n"));
  assert.ok(!/exec \$/.test(script), "must never exec a variable");
});

test("the S-5 safeguard: a real `read` blocks before either exec line", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET });
  const readIdx = script.indexOf("read -r _start");
  const execIdx = script.indexOf('exec codex "$PROMPT"');
  assert.ok(readIdx > -1 && execIdx > -1 && readIdx < execIdx);
});

test("Ctrl+C (SIGINT) before Enter is trapped with the 'nothing was started' line (AC-17)", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET });
  assert.match(script, /trap 'echo; echo "Nothing was started\. You can close this window\."; exit 130' INT/);
});

test("the folder line comes from the shell's own $FOLDER (post-cd pwd), never the raw cwd string", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET });
  assert.ok(script.includes('FOLDER="$(pwd)"'));
  assert.ok(script.includes("Folder   $FOLDER"));
});

test("embeds the path-fallback snippet verbatim (reused from terminal/shared/spawn-path.mjs, not duplicated)", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET });
  assert.ok(script.includes(PATH_SNIPPET));
});

test("an empty prompt guards the 'will start with' echo out at runtime (line count 0)", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "", pathFallbackSnippet: PATH_SNIPPET });
  // The echo text is always present in the SOURCE (inside the `if` block);
  // what matters is the guard condition evaluates false for an empty prompt.
  assert.ok(script.includes("if [ 0 -gt 0 ]"));
});

test("a non-empty prompt's line count feeds the SAME runtime guard as a positive number", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "one\ntwo\nthree", pathFallbackSnippet: PATH_SNIPPET });
  assert.ok(script.includes("if [ 3 -gt 0 ]"));
});

test("window title is set via an OSC-0 escape sequence, single-quoted", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi", pathFallbackSnippet: PATH_SNIPPET });
  assert.ok(script.includes(shellSingleQuote(WINDOW_TITLE)));
  assert.ok(script.includes("\\033]0;"));
});

// ── sanitizePromptForDisplay / PROMPT_DISPLAY (Finding 2 fix — terminal-escape
// injection via the displayed prompt) ────────────────────────────────────────

test("sanitizePromptForDisplay strips ESC (0x1b)", () => {
  assert.equal(sanitizePromptForDisplay("hi\x1b[2Jthere"), "hi?[2Jthere");
});

test("sanitizePromptForDisplay strips CR (0x0d) but keeps LF (0x0a) literal", () => {
  assert.equal(sanitizePromptForDisplay("line1\r\nline2"), "line1?\nline2");
});

test("sanitizePromptForDisplay strips DEL (0x7f)", () => {
  assert.equal(sanitizePromptForDisplay("a\x7fb"), "a?b");
});

test("sanitizePromptForDisplay strips the full C0 range (except \\n) and C1 range", () => {
  const c0 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join("");
  const c1 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(0x80 + i)).join("");
  const out = sanitizePromptForDisplay(c0 + c1);
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f\x80-\x9f]/.test(out), "no raw control bytes survive");
  // Every C0/C1 byte becomes "?" except the single \n (0x0A), which stays
  // literal and keeps its original position.
  const expected = c0
    .split("")
    .map((ch) => (ch === "\n" ? "\n" : "?"))
    .join("") + "?".repeat(32);
  assert.equal(out, expected);
  assert.equal(out.indexOf("\n"), 0x0a, "the surviving newline keeps its original position");
});

test("sanitizePromptForDisplay leaves ordinary text, unicode, and newlines untouched", () => {
  const text = "Set up the thing\nsecond line — em dash, emoji 🎉";
  assert.equal(sanitizePromptForDisplay(text), text);
});

test("sanitizePromptForDisplay treats non-string input as empty", () => {
  assert.equal(sanitizePromptForDisplay(undefined), "");
  assert.equal(sanitizePromptForDisplay(null), "");
});

test("buildOpenTerminalScript echoes a SEPARATE sanitized PROMPT_DISPLAY, never the raw PROMPT, for the review screen", () => {
  const hostileEsc = "Set up $(rm -rf ~)\x1b]0;pwned\x07 and \rALSO OVERWRITE THIS LINE";
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: hostileEsc, pathFallbackSnippet: PATH_SNIPPET });

  // The raw prompt is still delivered byte-for-byte to codex via $PROMPT.
  assert.ok(script.includes(hostileEsc), "the raw prompt text still appears verbatim (for $PROMPT / codex)");
  assert.ok(script.includes('exec codex "$PROMPT"'), "codex is still invoked with the RAW $PROMPT variable");

  // The review screen echoes $PROMPT_DISPLAY, not $PROMPT.
  assert.ok(script.includes('echo "$PROMPT_DISPLAY" | sed'), "the display echo uses $PROMPT_DISPLAY");
  assert.ok(!script.includes('echo "$PROMPT" | sed'), "the display echo must NOT use the raw $PROMPT");

  // No raw ESC or CR byte reaches the PROMPT_DISPLAY heredoc body.
  const displayHeredocMatch = script.match(/PROMPT_DISPLAY=\$\(cat <<'([^']+)'\n([\s\S]*?)\n\1\n\)/);
  assert.ok(displayHeredocMatch, "PROMPT_DISPLAY heredoc found");
  const displayBody = displayHeredocMatch[2];
  assert.ok(!displayBody.includes("\x1b"), "no raw ESC in the display heredoc body");
  assert.ok(!displayBody.includes("\r"), "no raw CR in the display heredoc body");
  assert.equal(displayBody, sanitizePromptForDisplay(hostileEsc));

  // The RAW heredoc body (fed to codex) is completely untouched.
  const rawHeredocMatch = script.match(/^PROMPT=\$\(cat <<'([^']+)'\n([\s\S]*?)\n\1\n\)/m);
  assert.ok(rawHeredocMatch, "raw PROMPT heredoc found");
  assert.equal(rawHeredocMatch[2], hostileEsc, "the raw heredoc body is byte-for-byte the hostile prompt, unsanitized");
});

test("the two heredoc delimiters (raw vs display) are always distinct, even without an explicit override", () => {
  const script = buildOpenTerminalScript({ cwd: "/tmp/x", prompt: "hi\x1b[2J", pathFallbackSnippet: PATH_SNIPPET });
  const delims = [...script.matchAll(/<<'([^']+)'/g)].map((m) => m[1]);
  assert.equal(delims.length, 2, "exactly two heredocs (raw PROMPT + PROMPT_DISPLAY)");
  assert.notEqual(delims[0], delims[1]);
});

test("a real bash actually runs codex with the RAW (unsanitized) prompt while the review screen shows the sanitized one", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-esc-bin-"));
  const fakeName = "vc-fake-agent-esc";
  makeFakeCodexStandin(binDir, fakeName);
  const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-esc-cwd-"));
  const hostileEsc = "line one\x1b[2Jline two\rOVERWRITTEN?";

  const script = buildOpenTerminalScript({
    cwd: cwdDir,
    prompt: hostileEsc,
    pathFallbackSnippet: `export PATH="$PATH:${binDir}"`,
  });
  const runnable = execedTextFor(script, fakeName);
  const { stdout } = runScript(runnable);

  // codex (the stand-in) still receives the RAW, byte-for-byte prompt.
  const argMatch = stdout.match(/ARG1_START\n([\s\S]*)\nARG1_END/);
  assert.ok(argMatch, "argument marker found");
  assert.equal(argMatch[1], hostileEsc, "codex receives the raw prompt unchanged");

  // Isolate just the ECHOED PROMPT lines (prefixed "  | " by the script's own
  // `sed`) — this is exactly what safety property 4's review screen shows the
  // user, as distinct from the script's OWN legitimate window-title escape
  // sequence printed earlier (that one is not attacker-influenced). None of
  // the hostile prompt's raw ESC/CR bytes may survive into these lines.
  const echoedPromptLines = stdout
    .split("\n")
    .filter((line) => line.startsWith("  | "))
    .join("\n");
  assert.ok(echoedPromptLines.length > 0, "found the sed-prefixed echoed prompt lines");
  assert.ok(!echoedPromptLines.includes("\x1b"), "no raw ESC in the echoed prompt lines");
  assert.ok(!echoedPromptLines.includes("\r"), "no raw CR in the echoed prompt lines");
});

// ── dynamic quoting fidelity (a real bash actually parses the script) ───────

const HOSTILE_PROMPT =
  'Set up $(rm -rf ~) `hostname` "double" \'single\' ; & | > < \\ # comment\nsecond line $HOME\nthird — em dash, emoji 🎉';

/**
 * Return a COPY of `script` with its two fixed `exec codex …` lines rewritten
 * to run `fakeBin` instead — see the file header for why. Throws if the
 * expected exact lines aren't found, so a future change to the generator
 * can't silently make this test exercise something else.
 */
function execedTextFor(script, fakeBin) {
  const withArg = script.replace('exec codex "$PROMPT"', `exec ${fakeBin} "$PROMPT"`);
  assert.notEqual(withArg, script, "expected exact `exec codex \"$PROMPT\"` line not found");
  const bare = withArg.replace("exec codex\n", `exec ${fakeBin}\n`);
  assert.notEqual(bare, withArg, "expected exact `exec codex` (no-arg) line not found");
  return bare;
}

function makeFakeCodexStandin(dir, name) {
  const p = path.join(dir, name);
  fs.writeFileSync(
    p,
    "#!/bin/sh\n" +
      "echo PWD_MARKER_START\n" +
      "pwd\n" +
      "echo PWD_MARKER_END\n" +
      "echo ARGC:$#\n" +
      "if [ $# -gt 0 ]; then\n" +
      "  printf 'ARG1_START\\n%s\\nARG1_END\\n' \"$1\"\n" +
      "fi\n",
    { mode: 0o755 },
  );
  return p;
}

function runScript(script, { input = "\n" } = {}) {
  const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-script-")), "launch.command");
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });
  try {
    const stdout = execFileSync("bash", [scriptPath], { input, encoding: "utf8" });
    return { stdout, scriptPath, existedAfter: fs.existsSync(scriptPath) };
  } catch (e) {
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      status: e.status,
      scriptPath,
      existedAfter: fs.existsSync(scriptPath),
    };
  }
}

test("a hostile prompt reaches the stand-in as EXACTLY ONE argv element, byte-for-byte", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-bin-"));
  const fakeName = "vc-fake-agent";
  makeFakeCodexStandin(binDir, fakeName);
  const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-cwd-"));

  const script = buildOpenTerminalScript({
    cwd: cwdDir,
    prompt: HOSTILE_PROMPT,
    pathFallbackSnippet: `export PATH="$PATH:${binDir}"`,
  });
  const runnable = execedTextFor(script, fakeName);
  const { stdout, existedAfter } = runScript(runnable);

  assert.ok(!existedAfter, "the temp launch script self-deletes");
  assert.ok(stdout.includes(`PWD_MARKER_START\n${cwdDir}\nPWD_MARKER_END`), "cwd matches exactly");
  assert.ok(stdout.includes("ARGC:1"), "exactly one argv element reached the agent — never shell-split");
  const argMatch = stdout.match(/ARG1_START\n([\s\S]*)\nARG1_END/);
  assert.ok(argMatch, "argument marker found");
  assert.equal(argMatch[1], HOSTILE_PROMPT, "the argument is byte-for-byte the hostile prompt");
});

test("a cwd containing a single quote and spaces round-trips correctly", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-bin2-"));
  const fakeName = "vc-fake-agent-2";
  makeFakeCodexStandin(binDir, fakeName);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-cwd2-"));
  const quirky = path.join(parent, "it's a folder with spaces");
  fs.mkdirSync(quirky);

  const script = buildOpenTerminalScript({
    cwd: quirky,
    prompt: "hello",
    pathFallbackSnippet: `export PATH="$PATH:${binDir}"`,
  });
  const runnable = execedTextFor(script, fakeName);
  const { stdout } = runScript(runnable);
  assert.ok(stdout.includes(`PWD_MARKER_START\n${quirky}\nPWD_MARKER_END`));
});

test("Ctrl+C (SIGINT) before Enter is trapped and never runs the agent (AC-17, S-5)", async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-bin3-"));
  const fakeName = "vc-fake-agent-3";
  makeFakeCodexStandin(binDir, fakeName);
  const cwdDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-cwd3-"));

  const script = buildOpenTerminalScript({
    cwd: cwdDir,
    prompt: "hello",
    pathFallbackSnippet: `export PATH="$PATH:${binDir}"`,
  });
  const runnable = execedTextFor(script, fakeName);
  const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-sigint-")), "launch.command");
  fs.writeFileSync(scriptPath, runnable, { mode: 0o700 });

  const { spawn } = await import("node:child_process");
  const child = spawn("bash", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

  // Wait until the script has reached the blocking `read` (its last printed
  // line before that point) before sending SIGINT — sending it too early
  // would just interrupt bash before the trap is even registered.
  const deadline = Date.now() + 5000;
  while (!stdout.includes("close this window.") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.ok(stdout.includes("close this window."), "script reached the review screen before the timeout");
  child.kill("SIGINT");
  const { code } = await exited;

  assert.ok(!fs.existsSync(scriptPath), "self-deletes even when interrupted");
  assert.ok(stdout.includes("Nothing was started. You can close this window."), "the trap's message was printed");
  assert.ok(!stdout.includes("ARGC:"), "the agent stand-in was never invoked");
  assert.equal(code, 130, "exits with the trap's own code (128 + SIGINT)");
});

test("a cwd that doesn't exist fails loudly, runs nothing, still self-deletes", () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-open-terminal-bin4-"));
  const fakeName = "vc-fake-agent-4";
  makeFakeCodexStandin(binDir, fakeName);
  const missing = path.join(os.tmpdir(), "vc-open-terminal-does-not-exist-" + Date.now());

  const script = buildOpenTerminalScript({
    cwd: missing,
    prompt: "hello",
    pathFallbackSnippet: `export PATH="$PATH:${binDir}"`,
  });
  const runnable = execedTextFor(script, fakeName);
  const { stdout, existedAfter, status } = runScript(runnable);
  assert.notEqual(status, 0);
  assert.ok(!existedAfter);
  assert.ok(stdout.toLowerCase().includes("couldn't open the project folder"));
  assert.ok(!stdout.includes("ARGC:"), "the agent stand-in was never invoked");
});
