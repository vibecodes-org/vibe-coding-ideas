// Find (or make) the board's project folder ON THIS MAC before the agent
// starts (card 6b2cb8ac).
//
// The page only knows folders that some Mac once recorded; on a Mac that has
// never run this board (or whose saved folder has gone) it used to hand the
// bridge another Mac's folder, node-pty couldn't enter it, and the agent died
// in ~20ms with a blank terminal. The bridge is the one place that knows the
// real machine and the real disk, so it decides, in this order:
//
//   0. Resume: the conversation belongs to its folder — it must exist, or the
//      session stops with `folder-missing` (no search).
//   1. No workspace info (an older app, or the lookup failed): the page's
//      folder if it exists, else `folder-lookup-failed`.
//   2. The page's folder, then this Mac's saved folders — each only if it
//      really exists and (for a repo board) is a checkout of the board's repo.
//   3. Repo board: search the usual code folders for a checkout → `found`.
//   4. Repo board: clone it into ~/projects/<repo> → `cloned`.
//   5. Repo-less board: ~/projects/<board name>, reused or created → `created`.
//   6. Final guard: never `/`, never the home folder, never a top-level folder.
//
// Pure apart from the injected `fs` (sync calls only), `homedir`, `now`,
// `onProgress` and `clone` — see folder-resolve.test.js. The search reads
// folder listings and `.git/config` text only; it never runs git per folder.

import path from "node:path";
import { isPlausibleProjectPath, stripClaudeWorktreeSuffix } from "../../shared/project-path.mjs";

/** The usual code folders under the home folder (approved decision 1). */
export const SEARCH_ROOT_NAMES = Object.freeze([
  "projects",
  "code",
  "dev",
  "src",
  "Developer",
  "repos",
  "git",
  "GitHub",
  "Projects",
  "Code",
  "workspace",
  "work",
]);

/** Folder names the search never reads (macOS privacy prompts, app data, sync clients). */
const SKIP_NAMES = new Set(
  [
    "node_modules",
    "Library",
    "Applications",
    "Documents",
    "Desktop",
    "Downloads",
    "Movies",
    "Music",
    "Pictures",
    "Public",
    "Dropbox",
    "Google Drive",
    "iCloud Drive",
  ].map((n) => n.toLowerCase()),
);

export const SEARCH_BUDGET_MS = 2000;
export const SEARCH_MAX_READS = 3000;
const SEARCH_DEPTH = 2;
const MAX_ALSO_FOUND = 3;
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;

/** @param {string} name */
function isSkippedName(name) {
  if (name.startsWith(".")) return true;
  const lower = name.toLowerCase();
  if (SKIP_NAMES.has(lower)) return true;
  if (lower.startsWith("onedrive")) return true;
  return false;
}

/** @param {string} name */
export function isSafeFolderName(name) {
  return typeof name === "string" && SAFE_NAME_RE.test(name) && name !== "." && name !== "..";
}

/**
 * A GitHub remote URL → lower-cased `owner/name`, or null for anything else.
 * Accepts https/http (with or without a user, `.git` or a trailing slash),
 * `git@github.com:o/n(.git)`, `ssh://git@github.com/o/n(.git)` and `git://github.com/o/n`.
 * @param {unknown} url
 * @returns {string | null}
 */
export function normalizeGithubRepo(url) {
  if (typeof url !== "string") return null;
  const u = url.trim();
  const m =
    /^(?:https?|git|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(u) ||
    /^(?:[^@/\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(u);
  if (!m) return null;
  return `${m[1]}/${m[2]}`.toLowerCase();
}

/**
 * Every `[remote "<name>"] url = …` in a `.git/config`.
 * @param {string} text
 * @returns {{ name: string, url: string }[]}
 */
export function parseGitRemotes(text) {
  /** @type {{ name: string, url: string }[]} */
  const out = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]$/.exec(line);
    if (section) {
      current = section[1].toLowerCase() === "remote" && section[2] != null ? section[2] : null;
      continue;
    }
    if (current == null) continue;
    const kv = /^url\s*=\s*(.+)$/i.exec(line);
    if (kv) out.push({ name: current, url: kv[1].trim() });
  }
  return out;
}

/**
 * Is `dir` a checkout (a real `.git` FOLDER — a `.git` file is a worktree or
 * submodule and is skipped) whose remotes include `repoKey`?
 * @returns {"origin" | "other" | null}
 */
function remoteMatch(dir, repoKey, fs) {
  try {
    if (!fs.lstatSync(path.join(dir, ".git")).isDirectory()) return null;
    const remotes = parseGitRemotes(fs.readFileSync(path.join(dir, ".git", "config"), "utf8"));
    let match = null;
    for (const r of remotes) {
      if (normalizeGithubRepo(r.url) !== repoKey) continue;
      if (r.name === "origin") return "origin";
      match = "other";
    }
    return match;
  } catch {
    return null;
  }
}

/** @returns {boolean} */
function hasGitFolder(dir, fs) {
  try {
    return fs.lstatSync(path.join(dir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

/** Most recent use: `.git/index` mtime, falling back to `.git/HEAD`. */
function lastUsed(dir, fs) {
  for (const f of ["index", "HEAD"]) {
    try {
      return fs.statSync(path.join(dir, ".git", f)).mtimeMs;
    } catch {
      /* try the next */
    }
  }
  return 0;
}

/** @returns {boolean} */
function isDirectory(p, fs) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Look for checkouts of `repoKey` in the usual code folders (two levels deep)
 * and at the top of the home folder (one level). Never follows a symlink
 * below a root, never reads a skipped folder, and stops at the time or
 * folder-read budget.
 * @param {{ home: string, repoKey: string, fs: any, now: () => number, budgetMs?: number, maxReads?: number }} opts
 * @returns {{ matches: { path: string, origin: boolean, mtime: number }[], scanned: number, ms: number, stopped: boolean }}
 */
export function searchForCheckout({ home, repoKey, fs, now, budgetMs = SEARCH_BUDGET_MS, maxReads = SEARCH_MAX_READS }) {
  const started = now();
  let scanned = 0;
  let stopped = false;
  /** @type {Map<string, { path: string, origin: boolean, mtime: number }>} */
  const found = new Map();

  const budgetLeft = () => {
    if (stopped) return false;
    if (scanned >= maxReads || now() - started >= budgetMs) {
      stopped = true;
      return false;
    }
    return true;
  };

  const consider = (dir) => {
    const match = remoteMatch(dir, repoKey, fs);
    if (!match) return;
    let real = dir;
    try {
      real = fs.realpathSync(dir);
    } catch {
      /* keep the path as found */
    }
    if (found.has(real)) return;
    found.set(real, { path: real, origin: match === "origin", mtime: lastUsed(dir, fs) });
  };

  /** @returns {{ name: string, dir: boolean, link: boolean }[] | null} */
  const list = (dir) => {
    if (!budgetLeft()) return null;
    scanned += 1;
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        dir: e.isDirectory(),
        link: e.isSymbolicLink(),
      }));
    } catch {
      return [];
    }
  };

  const walk = (dir, depthLeft) => {
    const entries = list(dir);
    if (!entries) return;
    for (const e of entries) {
      if (stopped) return;
      if (e.link || !e.dir || isSkippedName(e.name)) continue;
      const child = path.join(dir, e.name);
      if (child.includes(`${path.sep}.claude${path.sep}worktrees`)) continue;
      if (hasGitFolder(child, fs)) {
        consider(child);
        continue; // never descend into a checkout
      }
      if (depthLeft > 1) walk(child, depthLeft - 1);
    }
  };

  // 1) The usual code folders, case-insensitively de-duplicated (APFS is
  //    case-insensitive by default, so ~/projects and ~/Projects are one).
  const seenRoots = new Set();
  for (const name of SEARCH_ROOT_NAMES) {
    if (stopped) break;
    if (seenRoots.has(name.toLowerCase())) continue;
    seenRoots.add(name.toLowerCase());
    let root = path.join(home, name);
    try {
      const st = fs.lstatSync(root);
      if (st.isSymbolicLink()) {
        root = fs.realpathSync(root); // a root that is itself a link is followed once
        if (!fs.statSync(root).isDirectory()) continue;
      } else if (!st.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    if (hasGitFolder(root, fs)) {
      consider(root);
      continue;
    }
    walk(root, SEARCH_DEPTH);
  }

  // 2) The top of the home folder, one level (e.g. ~/<repo>).
  if (!stopped) {
    const entries = list(home);
    for (const e of entries ?? []) {
      if (stopped) break;
      if (e.link || !e.dir || isSkippedName(e.name)) continue;
      if (seenRoots.has(e.name.toLowerCase())) continue;
      const child = path.join(home, e.name);
      if (hasGitFolder(child, fs)) consider(child);
    }
  }

  const matches = [...found.values()].sort(
    (a, b) =>
      Number(b.origin) - Number(a.origin) ||
      b.mtime - a.mtime ||
      a.path.length - b.path.length ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return { matches, scanned, ms: now() - started, stopped };
}

/**
 * The final guard: never `/`, the home folder or a top-level folder.
 * @param {string} p @param {string} home
 */
function allowed(p, home) {
  if (!p || p === "/") return false;
  const trimmed = p.replace(/\/+$/, "");
  if (trimmed === home.replace(/\/+$/, "")) return false;
  return isPlausibleProjectPath(trimmed);
}

/** @param {string} p */
function real(p, fs) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * @typedef {{ repo: { owner: string, name: string, cloneUrl: string } | null, repoFolderName: string | null,
 *   newFolderName: string, savedFolders: string[], otherLiveSessionsOnThisMac: number }} Workspace
 * @typedef {{ ok: true, path: string, how: "saved"|"found"|"cloned"|"created", alsoFound: string[] }
 *   | { ok: false, reason: string, detail?: string | null }} Resolution
 */

/**
 * @param {{ hint: string | null, workspace: Workspace | null, isResume: boolean,
 *   deps: { fs: any, homedir: string, now: () => number, onProgress?: (e: object) => void,
 *     clone: (args: { repo: any, repoFolderName: string }) => Promise<any>, log?: (msg: string, extra?: object) => void } }} args
 * @returns {Promise<Resolution>}
 */
export async function resolveWorkspaceFolder({ hint, workspace, isResume, deps }) {
  const { fs, homedir: home } = deps;
  const onProgress = deps.onProgress || (() => {});
  const log = deps.log || (() => {});
  const guard = (/** @type {Resolution} */ r) => {
    if (r.ok && !allowed(r.path, home)) return { ok: false, reason: "folder-not-allowed", detail: null };
    return r;
  };
  const hintPath = hint ? stripClaudeWorktreeSuffix(hint) : null;

  // 0. Resume: its own folder or nothing.
  if (isResume) {
    if (hintPath && isDirectory(hintPath, fs)) {
      if (!allowed(hintPath, home)) return { ok: false, reason: "folder-not-allowed", detail: null };
      return guard({ ok: true, path: real(hintPath, fs), how: "saved", alsoFound: [] });
    }
    return { ok: false, reason: "folder-missing", detail: null };
  }

  // 1. No workspace info.
  if (!workspace) {
    if (hintPath && isDirectory(hintPath, fs)) {
      if (!allowed(hintPath, home)) return { ok: false, reason: "folder-not-allowed", detail: null };
      return guard({ ok: true, path: real(hintPath, fs), how: "saved", alsoFound: [] });
    }
    return { ok: false, reason: "folder-lookup-failed", detail: null };
  }

  const repo = workspace.repo ?? null;
  const repoKey = repo ? `${repo.owner}/${repo.name}`.toLowerCase() : null;

  // 2. The page's folder, then this Mac's saved folders.
  const candidates = [hintPath, ...(workspace.savedFolders ?? [])].filter(Boolean);
  for (const raw of candidates) {
    const c = stripClaudeWorktreeSuffix(/** @type {string} */ (raw));
    if (!allowed(c, home) || !isDirectory(c, fs)) continue;
    if (repoKey && !remoteMatch(c, repoKey, fs)) continue;
    if (!allowed(real(c, fs), home)) continue;
    return { ok: true, path: real(c, fs), how: "saved", alsoFound: [] };
  }

  if (repo && repoKey) {
    // 3. Search.
    onProgress({ kind: "looking", repoName: repo.name });
    const search = searchForCheckout({ home, repoKey, fs, now: deps.now });
    log("folder search finished", { scanned: search.scanned, ms: search.ms, matches: search.matches.length, stopped: search.stopped });
    const usable = search.matches.filter((m) => allowed(m.path, home));
    if (usable.length > 0) {
      const [best, ...rest] = usable;
      const alsoFound = rest.slice(0, MAX_ALSO_FOUND).map((m) => m.path);
      onProgress({ kind: "found", path: best.path, alsoFound });
      return { ok: true, path: best.path, how: "found", alsoFound };
    }

    // 4. Clone.
    if (!isSafeFolderName(workspace.repoFolderName ?? "")) return { ok: false, reason: "folder-not-allowed", detail: null };
    const cloned = await deps.clone({ repo, repoFolderName: /** @type {string} */ (workspace.repoFolderName) });
    if (!cloned?.ok) return { ok: false, reason: cloned?.reason || "clone-failed", detail: cloned?.detail ?? null };
    return guard({ ok: true, path: real(cloned.path, fs), how: "cloned", alsoFound: [] });
  }

  // 5. Repo-less board: ~/projects/<board name>.
  if (!isSafeFolderName(workspace.newFolderName)) return { ok: false, reason: "folder-not-allowed", detail: null };
  const dest = path.join(home, "projects", workspace.newFolderName);
  if (!isDirectory(dest, fs)) {
    try {
      fs.mkdirSync(dest, { recursive: true });
    } catch (e) {
      return { ok: false, reason: "folder-unavailable", detail: String(/** @type {any} */ (e)?.code || e) };
    }
  }
  const r = guard({ ok: true, path: real(dest, fs), how: "created", alsoFound: [] });
  if (r.ok) onProgress({ kind: "created", path: r.path });
  return r;
}
