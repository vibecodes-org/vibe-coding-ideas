// Unit tests for the bridge's project-folder resolver (card 6b2cb8ac).
// Real temp folders stand in for a Mac's home; `fs` is wrapped where a test
// needs to see which folders were read.
// Run: cd terminal/bridge && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeGithubRepo,
  parseGitRemotes,
  searchForCheckout,
  resolveWorkspaceFolder,
  SEARCH_ROOT_NAMES,
} from "./folder-resolve.js";

function tmpHome(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-fr-home-")));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

/** A fake checkout: `<dir>/.git/config` with the given remotes, plus an index file. */
function makeCheckout(dir, remotes, { indexMtime } = {}) {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  const config = Object.entries(remotes)
    .map(([name, url]) => `[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*\n`)
    .join("");
  fs.writeFileSync(path.join(dir, ".git", "config"), `[core]\n\tbare = false\n${config}`);
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  const index = path.join(dir, ".git", "index");
  fs.writeFileSync(index, "");
  if (indexMtime) fs.utimesSync(index, indexMtime, indexMtime);
  return dir;
}

const REPO = { owner: "Acme", name: "widget", cloneUrl: "https://github.com/Acme/widget.git" };

function workspace(extra = {}) {
  return { repo: REPO, repoFolderName: "widget", newFolderName: "widget-board", savedFolders: [], otherLiveSessionsOnThisMac: 0, ...extra };
}

function deps(home, extra = {}) {
  const events = [];
  return {
    events,
    deps: {
      fs,
      homedir: home,
      now: () => Date.now(),
      onProgress: (e) => events.push(e),
      clone: async () => {
        throw new Error("clone must not be called");
      },
      ...extra,
    },
  };
}

// ── remote parsing ───────────────────────────────────────────────────────────

test("normalizeGithubRepo accepts every GitHub URL shape, lower-cased", () => {
  for (const url of [
    "https://github.com/Acme/Widget",
    "https://github.com/Acme/Widget.git",
    "https://github.com/Acme/Widget/",
    "http://github.com/acme/widget.git",
    "https://user@github.com/acme/widget.git",
    "git@github.com:Acme/widget.git",
    "git@github.com:acme/widget",
    "ssh://git@github.com/acme/widget.git",
    "git://github.com/acme/widget",
  ]) {
    assert.equal(normalizeGithubRepo(url), "acme/widget", url);
  }
  for (const url of ["https://gitlab.com/acme/widget", "/local/path", "", "https://github.com/acme", null]) {
    assert.equal(normalizeGithubRepo(url), null, String(url));
  }
});

test("parseGitRemotes reads every [remote] url from .git/config text", () => {
  const text = `[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:a/b.git\n[branch "main"]\n\tremote = origin\n[remote "upstream"]\n  url=https://github.com/c/d\n`;
  assert.deepEqual(parseGitRemotes(text), [
    { name: "origin", url: "git@github.com:a/b.git" },
    { name: "upstream", url: "https://github.com/c/d" },
  ]);
});

// ── resolution order ─────────────────────────────────────────────────────────

test("resume: an existing hint is used as-is, with no search", async (t) => {
  const home = tmpHome(t);
  const dir = path.join(home, "projects", "widget");
  fs.mkdirSync(dir, { recursive: true });
  const { deps: d, events } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: dir, workspace: workspace(), isResume: true, deps: d });
  assert.deepEqual(r, { ok: true, path: dir, how: "saved", alsoFound: [] });
  assert.deepEqual(events, []);
});

test("resume: a missing hint is folder-missing, never searched for", async (t) => {
  const home = tmpHome(t);
  makeCheckout(path.join(home, "code", "widget"), { origin: REPO.cloneUrl });
  const { deps: d, events } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: path.join(home, "gone"), workspace: workspace(), isResume: true, deps: d });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "folder-missing");
  assert.deepEqual(events, []);
});

test("no workspace (older app or the lookup failed): existing hint → saved, else folder-lookup-failed", async (t) => {
  const home = tmpHome(t);
  const dir = path.join(home, "projects", "x");
  fs.mkdirSync(dir, { recursive: true });
  const { deps: d } = deps(home);
  assert.equal((await resolveWorkspaceFolder({ hint: dir, workspace: null, isResume: false, deps: d })).how, "saved");
  const miss = await resolveWorkspaceFolder({ hint: path.join(home, "nope"), workspace: null, isResume: false, deps: d });
  assert.equal(miss.reason, "folder-lookup-failed");
  const none = await resolveWorkspaceFolder({ hint: null, workspace: null, isResume: false, deps: d });
  assert.equal(none.reason, "folder-lookup-failed");
});

test("repo board: the hint wins only when it really is a checkout of the board's repo", async (t) => {
  const home = tmpHome(t);
  const right = makeCheckout(path.join(home, "projects", "widget"), { origin: "git@github.com:acme/widget.git" });
  const wrong = makeCheckout(path.join(home, "projects", "other"), { origin: "https://github.com/acme/other" });
  const { deps: d } = deps(home);
  assert.deepEqual(await resolveWorkspaceFolder({ hint: right, workspace: workspace(), isResume: false, deps: d }), {
    ok: true,
    path: right,
    how: "saved",
    alsoFound: [],
  });
  // A wrong-repo hint is skipped and the search finds the right one.
  const r = await resolveWorkspaceFolder({ hint: wrong, workspace: workspace(), isResume: false, deps: d });
  assert.equal(r.how, "found");
  assert.equal(r.path, right);
});

test("the cause-A case: a missing hint and missing saved folder fall through to the search", async (t) => {
  const home = tmpHome(t);
  const checkout = makeCheckout(path.join(home, "widget"), { origin: REPO.cloneUrl });
  const { deps: d, events } = deps(home);
  const r = await resolveWorkspaceFolder({
    hint: path.join(home, "projects", "widget"),
    workspace: workspace({ savedFolders: [path.join(home, "projects", "widget")] }),
    isResume: false,
    deps: d,
  });
  assert.deepEqual(r, { ok: true, path: checkout, how: "found", alsoFound: [] });
  assert.equal(events[0].kind, "looking");
  assert.equal(events[0].repoName, "widget");
});

test("a saved folder of this Mac is used when the hint is gone", async (t) => {
  const home = tmpHome(t);
  const saved = makeCheckout(path.join(home, "work", "widget"), { origin: REPO.cloneUrl });
  const { deps: d } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: null, workspace: workspace({ savedFolders: ["/nowhere/x", saved] }), isResume: false, deps: d });
  assert.deepEqual(r, { ok: true, path: saved, how: "saved", alsoFound: [] });
});

test("a saved worktree path collapses to the main checkout", async (t) => {
  const home = tmpHome(t);
  const main = makeCheckout(path.join(home, "projects", "widget"), { origin: REPO.cloneUrl });
  const { deps: d } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: path.join(main, ".claude", "worktrees", "abc"), workspace: workspace(), isResume: false, deps: d });
  assert.equal(r.path, main);
  assert.equal(r.how, "saved");
});

test("not found anywhere → clone", async (t) => {
  const home = tmpHome(t);
  const calls = [];
  const dest = path.join(home, "projects", "widget");
  const { deps: d } = deps(home, {
    clone: async (args) => {
      calls.push(args);
      fs.mkdirSync(dest, { recursive: true });
      return { ok: true, path: dest };
    },
  });
  const r = await resolveWorkspaceFolder({ hint: null, workspace: workspace(), isResume: false, deps: d });
  assert.deepEqual(r, { ok: true, path: dest, how: "cloned", alsoFound: [] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].repo, REPO);
  assert.equal(calls[0].repoFolderName, "widget");
});

test("a clone failure comes back with its reason", async (t) => {
  const home = tmpHome(t);
  const { deps: d } = deps(home, { clone: async () => ({ ok: false, reason: "clone-no-access", detail: "Repository not found." }) });
  const r = await resolveWorkspaceFolder({ hint: null, workspace: workspace(), isResume: false, deps: d });
  assert.deepEqual(r, { ok: false, reason: "clone-no-access", detail: "Repository not found." });
});

test("repo-less board: ~/projects/<name> is reused when it exists, else created", async (t) => {
  const home = tmpHome(t);
  const { deps: d, events } = deps(home);
  const ws = { repo: null, repoFolderName: null, newFolderName: "my-new-idea", savedFolders: [], otherLiveSessionsOnThisMac: 0 };
  const r = await resolveWorkspaceFolder({ hint: null, workspace: ws, isResume: false, deps: d });
  const dest = path.join(home, "projects", "my-new-idea");
  assert.deepEqual(r, { ok: true, path: dest, how: "created", alsoFound: [] });
  assert.ok(fs.statSync(dest).isDirectory());
  assert.deepEqual(events, [{ kind: "created", path: dest }]);
  // Again: the same folder, reused.
  fs.writeFileSync(path.join(dest, "keep.txt"), "x");
  const again = await resolveWorkspaceFolder({ hint: null, workspace: ws, isResume: false, deps: d });
  assert.equal(again.path, dest);
  assert.ok(fs.existsSync(path.join(dest, "keep.txt")));
});

test("repo-less board: an existing hint is used, and mkdir failing is folder-unavailable", async (t) => {
  const home = tmpHome(t);
  const ws = { repo: null, repoFolderName: null, newFolderName: "idea", savedFolders: [], otherLiveSessionsOnThisMac: 0 };
  const dir = path.join(home, "projects", "mine");
  fs.mkdirSync(dir, { recursive: true });
  const { deps: d } = deps(home);
  assert.equal((await resolveWorkspaceFolder({ hint: dir, workspace: ws, isResume: false, deps: d })).how, "saved");
  const failing = deps(home, {
    fs: {
      ...fs,
      mkdirSync: () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
    },
  });
  const r = await resolveWorkspaceFolder({ hint: null, workspace: ws, isResume: false, deps: failing.deps });
  assert.equal(r.reason, "folder-unavailable");
});

test("never '/', the home folder or a top-level folder", async (t) => {
  const home = tmpHome(t);
  const { deps: d } = deps(home);
  for (const hint of ["/", home, "/tmp", "/Users"]) {
    const r = await resolveWorkspaceFolder({ hint, workspace: null, isResume: false, deps: d });
    assert.equal(r.ok, false, hint);
    assert.equal(r.reason, "folder-not-allowed", hint);
    const resumed = await resolveWorkspaceFolder({ hint, workspace: null, isResume: true, deps: d });
    assert.equal(resumed.reason, "folder-not-allowed", hint);
  }
  // An unsafe new-folder name never escapes ~/projects.
  for (const bad of ["..", ".", "a/b", ""]) {
    const ws = { repo: null, repoFolderName: null, newFolderName: bad, savedFolders: [], otherLiveSessionsOnThisMac: 0 };
    const r = await resolveWorkspaceFolder({ hint: null, workspace: ws, isResume: false, deps: d });
    assert.equal(r.reason, "folder-not-allowed", bad);
  }
});

// ── the search ───────────────────────────────────────────────────────────────

test("search: two levels below the usual code folders, plus the top of home", async (t) => {
  const home = tmpHome(t);
  const a = makeCheckout(path.join(home, "Developer", "org", "widget"), { origin: REPO.cloneUrl });
  const tooDeep = makeCheckout(path.join(home, "code", "a", "b", "widget"), { origin: REPO.cloneUrl });
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs, now: () => 0 });
  assert.deepEqual(r.matches.map((m) => m.path), [a]);
  assert.ok(!r.matches.some((m) => m.path === tooDeep));
});

test("search: Documents, Desktop, Downloads, Library and hidden folders are never read", async (t) => {
  const home = tmpHome(t);
  for (const name of ["Documents", "Desktop", "Downloads", "Library", ".hidden", "node_modules", "Dropbox", "OneDrive - Work"]) {
    makeCheckout(path.join(home, name, "widget"), { origin: REPO.cloneUrl });
    makeCheckout(path.join(home, "projects", name, "widget"), { origin: REPO.cloneUrl });
  }
  const read = [];
  const spy = {
    ...fs,
    readdirSync: (p, o) => {
      read.push(String(p));
      return fs.readdirSync(p, o);
    },
  };
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs: spy, now: () => 0 });
  assert.deepEqual(r.matches, []);
  for (const p of read) {
    assert.ok(!/\/(Documents|Desktop|Downloads|Library|\.hidden|node_modules|Dropbox|OneDrive - Work)(\/|$)/.test(p), p);
  }
});

test("search: a .git FILE (a worktree or submodule) and .claude/worktrees are skipped", async (t) => {
  const home = tmpHome(t);
  const wt = path.join(home, "projects", "widget-wt");
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: /elsewhere/.git/worktrees/x\n");
  const main = makeCheckout(path.join(home, "projects", "widget"), { origin: REPO.cloneUrl });
  makeCheckout(path.join(main, ".claude", "worktrees", "abc"), { origin: REPO.cloneUrl });
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs, now: () => 0 });
  assert.deepEqual(r.matches.map((m) => m.path), [main]);
});

test("search: symlinks are never followed, so a loop terminates", async (t) => {
  const home = tmpHome(t);
  const dir = path.join(home, "projects", "loop");
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(dir, path.join(dir, "again"));
  fs.symlinkSync(path.join(home, "projects"), path.join(home, "projects", "up"));
  const target = makeCheckout(path.join(home, "elsewhere-real", "widget"), { origin: REPO.cloneUrl });
  fs.symlinkSync(target, path.join(home, "projects", "linked-widget"));
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs, now: () => 0 });
  assert.deepEqual(r.matches, []);
});

test("search: a root that is itself a symlink is followed once", async (t) => {
  const home = tmpHome(t);
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-fr-real-")));
  t.after(() => fs.rmSync(real, { recursive: true, force: true }));
  const checkout = makeCheckout(path.join(real, "widget"), { origin: REPO.cloneUrl });
  fs.symlinkSync(real, path.join(home, "code"));
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs, now: () => 0 });
  assert.deepEqual(r.matches.map((m) => m.path), [checkout]);
});

test("search: stops at the time budget", async (t) => {
  const home = tmpHome(t);
  for (let i = 0; i < 20; i++) fs.mkdirSync(path.join(home, "projects", `d${i}`, "x"), { recursive: true });
  let clock = 0;
  const r = searchForCheckout({
    home,
    repoKey: "acme/widget",
    fs,
    now: () => {
      clock += 500;
      return clock;
    },
  });
  assert.ok(r.stopped, "the search reports that it stopped early");
  assert.ok(r.scanned <= 5, `scanned ${r.scanned}`);
});

test("search: stops at the folder-read budget", async (t) => {
  const home = tmpHome(t);
  for (let i = 0; i < 30; i++) fs.mkdirSync(path.join(home, "projects", `d${i}`), { recursive: true });
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs, now: () => 0, maxReads: 10 });
  assert.equal(r.scanned, 10);
  assert.equal(r.stopped, true);
});

test("ranking: origin match first, then most recently used, and the others are reported", async (t) => {
  const home = tmpHome(t);
  const old = makeCheckout(path.join(home, "old", "widget"), { origin: REPO.cloneUrl }, { indexMtime: new Date("2026-01-01") });
  const recent = makeCheckout(path.join(home, "projects", "widget"), { origin: REPO.cloneUrl }, { indexMtime: new Date("2026-10-01") });
  const viaUpstream = makeCheckout(path.join(home, "code", "widget-fork"), { origin: "https://github.com/me/widget-fork", upstream: REPO.cloneUrl }, { indexMtime: new Date("2026-10-15") });
  // ~/old isn't a search root — make it reachable as a top-of-home checkout instead.
  fs.renameSync(path.join(home, "old", "widget"), path.join(home, "widget-old"));
  fs.rmSync(path.join(home, "old"), { recursive: true });
  const oldPath = path.join(home, "widget-old");
  void old;
  const { deps: d, events } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: null, workspace: workspace(), isResume: false, deps: d });
  assert.equal(r.how, "found");
  assert.equal(r.path, recent);
  assert.deepEqual(r.alsoFound, [oldPath, viaUpstream]);
  const found = events.find((e) => e.kind === "found");
  assert.deepEqual(found, { kind: "found", path: recent, alsoFound: [oldPath, viaUpstream] });
});

test("the search roots list is the approved one", () => {
  assert.deepEqual(SEARCH_ROOT_NAMES, ["projects", "code", "dev", "src", "Developer", "repos", "git", "GitHub", "Projects", "Code", "workspace", "work"]);
});
