// Unit tests for the saved step-usage script (card 5e654dd1, stage 2b).
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_STEP_USAGE_SCRIPT_BYTES,
  parseStepUsageScript,
  saveStepUsageScript,
  stepUsageScriptDir,
} from "./step-usage-script.js";

const BODY = "#!/bin/sh\n# totals a step\necho hi\n";
const sha8 = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 8);
const answer = (body = BODY, file = `step-usage-${sha8(body)}.sh`) => ({ agents: null, stepUsageScript: { file, body } });

test("a script whose name matches its text is accepted", () => {
  assert.deepEqual(parseStepUsageScript(answer()), { file: `step-usage-${sha8(BODY)}.sh`, body: BODY });
});

test("anything missing or malformed is refused", () => {
  for (const bad of [null, undefined, {}, { stepUsageScript: null }, { stepUsageScript: "x" }, { stepUsageScript: { file: 1, body: BODY } }]) {
    assert.equal(parseStepUsageScript(bad), null);
  }
});

test("a file name that is not exactly step-usage-<8 hex>.sh is refused (no path tricks)", () => {
  for (const file of ["../step-usage-12345678.sh", "step-usage-12345678", "step-usage-1234567.sh", "step-usage-ABCDEF12.sh", "/etc/passwd", "step-usage-12345678.sh/../x", "step-usage-12345678.sh\n"]) {
    assert.equal(parseStepUsageScript(answer(BODY, file)), null, file);
  }
});

test("a name that does not belong to the text is refused", () => {
  assert.equal(parseStepUsageScript(answer(BODY, "step-usage-00000000.sh")), null);
});

test("the text must be a short sh script without NUL bytes", () => {
  assert.equal(parseStepUsageScript(answer("echo hi\n")), null);
  assert.equal(parseStepUsageScript(answer("#!/bin/sh\0\n")), null);
  assert.equal(parseStepUsageScript(answer("#!/bin/sh\n" + "x".repeat(MAX_STEP_USAGE_SCRIPT_BYTES))), null);
  assert.equal(parseStepUsageScript(answer("")), null);
});

test("the folder follows CLAUDE_CONFIG_DIR, else ~/.claude, and a relative folder is refused", () => {
  assert.equal(stepUsageScriptDir({}, "/Users/x"), "/Users/x/.claude/vibecodes");
  assert.equal(stepUsageScriptDir({ CLAUDE_CONFIG_DIR: "/opt/cc" }, "/Users/x"), "/opt/cc/vibecodes");
  assert.equal(stepUsageScriptDir({ CLAUDE_CONFIG_DIR: "relative/dir" }, "/Users/x"), null);
});

function tmpDir() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vc-usage-")), "vibecodes");
}

test("it writes the file once, not executable, and leaves an identical file alone", () => {
  const dir = tmpDir();
  const script = parseStepUsageScript(answer());
  assert.equal(saveStepUsageScript(script, dir), "written");
  const target = path.join(dir, script.file);
  assert.equal(fs.readFileSync(target, "utf8"), BODY);
  assert.equal(fs.statSync(target).mode & 0o111, 0);
  const before = fs.statSync(target).mtimeMs;
  assert.equal(saveStepUsageScript(script, dir), "present");
  assert.equal(fs.statSync(target).mtimeMs, before);
  assert.deepEqual(fs.readdirSync(dir), [script.file]); // no temp files left
});

test("it replaces a damaged file with the right text", () => {
  const dir = tmpDir();
  const script = parseStepUsageScript(answer());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, script.file), "tampered");
  assert.equal(saveStepUsageScript(script, dir), "written");
  assert.equal(fs.readFileSync(path.join(dir, script.file), "utf8"), BODY);
});

test("it never writes through a symlink", () => {
  const dir = tmpDir();
  const script = parseStepUsageScript(answer());
  fs.mkdirSync(dir, { recursive: true });
  const victim = path.join(path.dirname(dir), "victim.txt");
  fs.writeFileSync(victim, "keep");
  fs.symlinkSync(victim, path.join(dir, script.file));
  assert.equal(saveStepUsageScript(script, dir), "failed");
  assert.equal(fs.readFileSync(victim, "utf8"), "keep");
});

test("no folder, or a failure, never throws", () => {
  const script = parseStepUsageScript(answer());
  assert.equal(saveStepUsageScript(script, null), "skipped");
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vc-usage-")), "file");
  fs.writeFileSync(blocker, "x");
  assert.equal(saveStepUsageScript(script, path.join(blocker, "vibecodes")), "failed");
});
