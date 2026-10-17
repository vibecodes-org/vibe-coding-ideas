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
  resolveResumeFolder,
  sanitizeWorkspace,
  repoNameFromRemote,
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

// ── code review rework: moved projects, SSH host aliases, partial folders ───

test("repoNameFromRemote reads the project name from any remote shape", () => {
  for (const [url, name] of [
    ["https://github.com/NewOrg/Widget.git", "widget"],
    ["git@github-work:acme/widget.git", "widget"],
    ["ssh://git@github-work/acme/widget", "widget"],
    ["https://gitlab.example.com/group/sub/widget/", "widget"],
    ["/Users/me/bare/widget.git", "widget"],
  ]) {
    assert.equal(repoNameFromRemote(url), name, url);
  }
  for (const url of ["", null, "   "]) assert.equal(repoNameFromRemote(url), null, String(url));
});

test("moved project: the page's folder whose remote names the new owner is trusted, never re-downloaded", async (t) => {
  const home = tmpHome(t);
  const checkout = makeCheckout(path.join(home, "projects", "widget"), { origin: "https://github.com/NewOrg/widget.git" });
  const { deps: d } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: checkout, workspace: workspace({ savedFolders: [checkout] }), isResume: false, deps: d });
  assert.deepEqual(r, { ok: true, path: checkout, how: "saved", alsoFound: [] });
});

test("SSH host alias: this Mac's saved folder with git@github-work:… is trusted", async (t) => {
  const home = tmpHome(t);
  const checkout = makeCheckout(path.join(home, "code", "widget"), { origin: "git@github-work:acme/widget.git" });
  const { deps: d } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: null, workspace: workspace({ savedFolders: [checkout] }), isResume: false, deps: d });
  assert.deepEqual(r, { ok: true, path: checkout, how: "saved", alsoFound: [] });
});

test("a saved checkout with no remotes is trusted; one whose remotes all name another project is not", async (t) => {
  const home = tmpHome(t);
  const local = makeCheckout(path.join(home, "projects", "local-only"), {});
  const other = makeCheckout(path.join(home, "projects", "gadget"), { origin: "https://github.com/acme/gadget.git" });
  const notGit = path.join(home, "projects", "plain");
  fs.mkdirSync(notGit, { recursive: true });
  const { deps: d } = deps(home, { clone: async () => ({ ok: false, reason: "stub" }) });
  assert.equal((await resolveWorkspaceFolder({ hint: local, workspace: workspace(), isResume: false, deps: d })).path, local);
  const r = await resolveWorkspaceFolder({ hint: other, workspace: workspace({ savedFolders: [notGit] }), isResume: false, deps: d });
  assert.deepEqual(r, { ok: false, reason: "stub", detail: null });
});

test("search: a project-name-only match (moved owner or SSH alias) is found, ranked after exact owner matches", async (t) => {
  const home = tmpHome(t);
  const moved = makeCheckout(path.join(home, "projects", "widget"), { origin: "https://github.com/NewOrg/widget.git" }, { indexMtime: new Date("2026-10-15") });
  const alias = makeCheckout(path.join(home, "widget-alias"), { origin: "git@github-work:acme/widget.git" }, { indexMtime: new Date("2026-10-10") });
  const { deps: d } = deps(home);
  const r = await resolveWorkspaceFolder({ hint: null, workspace: workspace(), isResume: false, deps: d });
  assert.deepEqual(r, { ok: true, path: moved, how: "found", alsoFound: [alias] });
  // An exact owner match wins even when it is older.
  const exact = makeCheckout(path.join(home, "code", "widget"), { origin: REPO.cloneUrl }, { indexMtime: new Date("2026-01-01") });
  const again = await resolveWorkspaceFolder({ hint: null, workspace: workspace(), isResume: false, deps: d });
  assert.equal(again.path, exact);
  assert.deepEqual(again.alsoFound, [moved, alias]);
});

test("search: a different project with another name is never a match", async (t) => {
  const home = tmpHome(t);
  makeCheckout(path.join(home, "projects", "widget"), { origin: "https://github.com/acme/widget-docs.git" });
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs, now: () => 0 });
  assert.deepEqual(r.matches, []);
});

test("search: a half-downloaded *.vibecodes-partial-* folder is never picked", async (t) => {
  const home = tmpHome(t);
  makeCheckout(path.join(home, "projects", "widget.vibecodes-partial-123"), { origin: REPO.cloneUrl });
  const r = searchForCheckout({ home, repoKey: "acme/widget", fs, now: () => 0 });
  assert.deepEqual(r.matches, []);
});

test("before downloading: ~/projects/<repo> already a checkout of the same project is reused, not -2", async (t) => {
  const home = tmpHome(t);
  const existing = makeCheckout(path.join(home, "projects", "widget"), { origin: "git@github-work:neworg/widget.git" });
  // A clock that jumps past the search budget at once, so only the pre-clone check can find it.
  let clock = 0;
  const { deps: d } = deps(home, { now: () => (clock += 10_000) });
  const r = await resolveWorkspaceFolder({ hint: null, workspace: workspace(), isResume: false, deps: d });
  assert.deepEqual(r, { ok: true, path: existing, how: "found", alsoFound: [] });
});

test("resolveResumeFolder: the same guard as a fresh launch, synchronously", (t) => {
  const home = tmpHome(t);
  const dir = path.join(home, "projects", "widget");
  fs.mkdirSync(dir, { recursive: true });
  assert.deepEqual(resolveResumeFolder({ hint: dir, fs, homedir: home }), { ok: true, path: dir, how: "saved", alsoFound: [] });
  assert.deepEqual(resolveResumeFolder({ hint: path.join(dir, ".claude", "worktrees", "x"), fs, homedir: home }).path, dir);
  for (const hint of ["/", home, "/tmp", "/Users"]) {
    assert.equal(resolveResumeFolder({ hint, fs, homedir: home }).reason, "folder-not-allowed", hint);
  }
  assert.equal(resolveResumeFolder({ hint: path.join(home, "gone"), fs, homedir: home }).reason, "folder-missing");
  assert.equal(resolveResumeFolder({ hint: null, fs, homedir: home }).reason, "folder-missing");
});

test("sanitizeWorkspace drops a repo whose owner or name starts with '-' (it could read as a command option)", () => {
  const base = { newFolderName: "x", repoFolderName: "widget", savedFolders: [], otherLiveSessionsOnThisMac: 0 };
  assert.deepEqual(sanitizeWorkspace({ ...base, repo: { owner: "acme", name: "widget", cloneUrl: "https://github.com/acme/widget.git" } }).repo, {
    owner: "acme",
    name: "widget",
    cloneUrl: "https://github.com/acme/widget.git",
  });
  assert.equal(sanitizeWorkspace({ ...base, repo: { owner: "-acme", name: "widget", cloneUrl: "u" } }).repo, null);
  assert.equal(sanitizeWorkspace({ ...base, repo: { owner: "acme", name: "--upload-pack=x", cloneUrl: "u" } }).repo, null);
  assert.equal(sanitizeWorkspace({ ...base, repoFolderName: "-x", repo: null }).repoFolderName, null);
});
