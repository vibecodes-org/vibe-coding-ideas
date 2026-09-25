// Unit tests for the spawn-folder check (card 3ae71b07 — a launch link with no
// usable folder started the agent at `/`, or killed it before its first byte).
// The pure decision uses stub stat/realpath; the last block uses the real
// filesystem for the symlink cases.
// Run: cd terminal/bridge && node --test   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSpawnCwd, spawnCwdFallbackNotice } from "./spawn-cwd.js";

const HOME = "/Users/tester";

function errno(code) {
  return Object.assign(new Error(code), { code });
}

/** A fake filesystem: `dirs` are directories, `files` are regular files, anything else is ENOENT. */
function fakeStat({ dirs = [], files = [], throws } = {}) {
  return (p) => {
    if (throws) throw throws;
    if (dirs.includes(p)) return { isDirectory: () => true };
    if (files.includes(p)) return { isDirectory: () => false };
    throw errno("ENOENT");
  };
}

test("an existing folder is used as-is", () => {
  const r = resolveSpawnCwd({ requested: "/Users/tester/projects/app", home: HOME, stat: fakeStat({ dirs: ["/Users/tester/projects/app"] }) });
  assert.deepEqual(r, { cwd: "/Users/tester/projects/app", reason: "ok", requested: "/Users/tester/projects/app" });
  assert.equal(spawnCwdFallbackNotice(r), null);
});

test("no folder at all starts in home, quietly (never at the bridge's own cwd of /)", () => {
  for (const requested of [undefined, null, "", "   "]) {
    const r = resolveSpawnCwd({ requested, home: HOME, base: "/", stat: fakeStat() });
    assert.deepEqual(r, { cwd: HOME, reason: "none", requested: null }, `requested=${JSON.stringify(requested)}`);
    assert.equal(spawnCwdFallbackNotice(r), null);
  }
});

test("a folder that doesn't exist starts in home, with a note naming it", () => {
  const r = resolveSpawnCwd({ requested: "/Users/tester/gone", home: HOME, stat: fakeStat() });
  assert.deepEqual(r, { cwd: HOME, reason: "missing", requested: "/Users/tester/gone" });
  const notice = spawnCwdFallbackNotice(r);
  assert.match(notice, /couldn't find the folder \/Users\/tester\/gone, so this session started in your home folder/);
  assert.ok(notice.endsWith("\r\n\r\n"));
});

test("a path through a file (ENOTDIR) counts as missing", () => {
  const r = resolveSpawnCwd({ requested: "/Users/tester/a.txt/sub", home: HOME, stat: fakeStat({ throws: errno("ENOTDIR") }) });
  assert.equal(r.reason, "missing");
  assert.equal(r.cwd, HOME);
});

test("a regular file starts in home, with a note", () => {
  const r = resolveSpawnCwd({ requested: "/Users/tester/notes.txt", home: HOME, stat: fakeStat({ files: ["/Users/tester/notes.txt"] }) });
  assert.deepEqual(r, { cwd: HOME, reason: "not-a-dir", requested: "/Users/tester/notes.txt" });
  assert.match(spawnCwdFallbackNotice(r), /\/Users\/tester\/notes\.txt isn't a folder, so this session started in your home folder/);
});

test("a folder that can't be read (e.g. permission denied) starts in home, with a note", () => {
  const r = resolveSpawnCwd({ requested: "/private/locked", home: HOME, stat: fakeStat({ throws: errno("EACCES") }) });
  assert.deepEqual(r, { cwd: HOME, reason: "unusable", requested: "/private/locked" });
  assert.match(spawnCwdFallbackNotice(r), /couldn't open the folder \/private\/locked/);
});

test("the root of the disk is never used, in any spelling — quietly home", () => {
  const stat = fakeStat({ dirs: ["/"] });
  for (const requested of ["/", "//", "/./", "/tmp/..", "/Users/.."]) {
    const r = resolveSpawnCwd({ requested, home: HOME, stat });
    assert.equal(r.cwd, HOME, `requested=${requested}`);
    assert.equal(r.reason, "root", `requested=${requested}`);
    assert.equal(spawnCwdFallbackNotice(r), null);
  }
});

test("a trailing slash on a real folder is fine", () => {
  const r = resolveSpawnCwd({ requested: "/Users/tester/projects/app/", home: HOME, stat: fakeStat({ dirs: ["/Users/tester/projects/app"] }) });
  assert.equal(r.reason, "ok");
  assert.equal(r.cwd, "/Users/tester/projects/app");
});

test("a relative folder is resolved against the bridge's own cwd (dev --cwd convenience)", () => {
  const r = resolveSpawnCwd({ requested: "app", home: HOME, base: "/Users/tester/projects", stat: fakeStat({ dirs: ["/Users/tester/projects/app"] }) });
  assert.deepEqual(r, { cwd: "/Users/tester/projects/app", reason: "ok", requested: "/Users/tester/projects/app" });
});

test("a relative folder that climbs to / from a helper-forked bridge is refused", () => {
  const r = resolveSpawnCwd({ requested: "..", home: HOME, base: "/", stat: fakeStat({ dirs: ["/"] }) });
  assert.equal(r.reason, "root");
  assert.equal(r.cwd, HOME);
});

test("a relative folder that doesn't exist under the base is reported by its full path", () => {
  const r = resolveSpawnCwd({ requested: "nope", home: HOME, base: "/", stat: fakeStat() });
  assert.deepEqual(r, { cwd: HOME, reason: "missing", requested: "/nope" });
});

test("home itself is a valid, explicit choice", () => {
  const r = resolveSpawnCwd({ requested: HOME, home: HOME, stat: fakeStat({ dirs: [HOME] }) });
  assert.deepEqual(r, { cwd: HOME, reason: "ok", requested: HOME });
});

test("a realpath failure after a successful stat is treated as unusable, not a crash", () => {
  const r = resolveSpawnCwd({
    requested: "/Users/tester/racy",
    home: HOME,
    stat: fakeStat({ dirs: ["/Users/tester/racy"] }),
    realpath: () => { throw errno("ENOENT"); },
  });
  assert.equal(r.reason, "unusable");
  assert.equal(r.cwd, HOME);
});

// ── real filesystem: symlinks ───────────────────────────────────────────────
const realDeps = { stat: (p) => fs.statSync(p), realpath: (p) => fs.realpathSync(p) };

test("a symlink to a real folder is honoured, keeping the path the launch asked for", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-spawn-cwd-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const target = path.join(tmp, "real");
  fs.mkdirSync(target);
  const link = path.join(tmp, "link");
  fs.symlinkSync(target, link);
  const r = resolveSpawnCwd({ requested: link, home: HOME, ...realDeps });
  assert.deepEqual(r, { cwd: link, reason: "ok", requested: link });
});

test("a symlink pointing at / is refused", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-spawn-cwd-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const link = path.join(tmp, "to-root");
  fs.symlinkSync("/", link);
  const r = resolveSpawnCwd({ requested: link, home: HOME, ...realDeps });
  assert.equal(r.reason, "root");
  assert.equal(r.cwd, HOME);
});

test("a dangling symlink counts as missing", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-spawn-cwd-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const link = path.join(tmp, "dangling");
  fs.symlinkSync(path.join(tmp, "nowhere"), link);
  const r = resolveSpawnCwd({ requested: link, home: HOME, ...realDeps });
  assert.equal(r.reason, "missing");
});
