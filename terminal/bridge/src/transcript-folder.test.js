// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findConversationFolder, firstCwdInTranscript, claudeConfigDir } from "./transcript-folder.js";

const ID = "11111111-2222-4333-8444-555555555555";

function home(t) {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-tf-")));
  t.after(() => fs.rmSync(h, { recursive: true, force: true }));
  return h;
}
function writeTranscript(configDir, key, id, lines) {
  const dir = path.join(configDir, "projects", key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

test("config dir: CLAUDE_CONFIG_DIR wins, blank falls back to ~/.claude", () => {
  assert.equal(claudeConfigDir({ env: { CLAUDE_CONFIG_DIR: "/x/y" }, homedir: "/h" }), "/x/y");
  assert.equal(claudeConfigDir({ env: { CLAUDE_CONFIG_DIR: "  " }, homedir: "/h" }), path.join("/h", ".claude"));
  assert.equal(claudeConfigDir({ env: {}, homedir: "/h" }), path.join("/h", ".claude"));
});

test("first cwd skips lines without one and lines that are cut off", () => {
  const text = '{"type":"summary"}\n{"cwd":"/a/b","x":1}\n{"cwd":"/c"}\n';
  assert.equal(firstCwdInTranscript(text), "/a/b");
  assert.equal(firstCwdInTranscript('{"cwd":"/a/b'), null);
  assert.equal(firstCwdInTranscript('{"cwd":""}\n{"cwd":"/ok"}'), "/ok");
});

test("finds the folder from the transcript under ~/.claude", (t) => {
  const h = home(t);
  writeTranscript(path.join(h, ".claude"), "-Users-n-projects-x", ID, [{ type: "summary" }, { cwd: "/Users/n/projects/x", type: "user" }]);
  writeTranscript(path.join(h, ".claude"), "-Users-n-projects-y", "99999999-2222-4333-8444-555555555555", [{ cwd: "/other" }]);
  assert.equal(findConversationFolder({ id: ID, fs, env: {}, homedir: h }), "/Users/n/projects/x");
});

test("honours CLAUDE_CONFIG_DIR", (t) => {
  const h = home(t);
  const cfg = path.join(h, "custom");
  writeTranscript(cfg, "k", ID, [{ cwd: "/Users/n/projects/z" }]);
  assert.equal(findConversationFolder({ id: ID, fs, env: { CLAUDE_CONFIG_DIR: cfg }, homedir: h }), "/Users/n/projects/z");
  assert.equal(findConversationFolder({ id: ID, fs, env: {}, homedir: h }), null);
});

test("no transcript, no store, or an unsafe id gives null", (t) => {
  const h = home(t);
  assert.equal(findConversationFolder({ id: ID, fs, env: {}, homedir: h }), null);
  writeTranscript(path.join(h, ".claude"), "k", "99999999-2222-4333-8444-555555555555", [{ cwd: "/o" }]);
  assert.equal(findConversationFolder({ id: ID, fs, env: {}, homedir: h }), null);
  assert.equal(findConversationFolder({ id: "../../etc/passwd", fs, env: {}, homedir: h }), null);
  assert.equal(findConversationFolder({ id: "", fs, env: {}, homedir: h }), null);
});

test("a transcript with no cwd at all gives null", (t) => {
  const h = home(t);
  writeTranscript(path.join(h, ".claude"), "k", ID, [{ type: "summary" }]);
  assert.equal(findConversationFolder({ id: ID, fs, env: {}, homedir: h }), null);
});
