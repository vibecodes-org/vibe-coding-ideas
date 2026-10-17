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
//      really exists and (for a repo board) is a git checkout none of whose
//      remotes names a DIFFERENT project (a moved project's new owner, or an
//      SSH host alias like `git@github-work:o/n.git`, is still this project).
//   3. Repo board: search the usual code folders for a checkout → `found`.
//      Exact owner/name matches first; a same-project-name match (owner
//      changed, or an SSH host alias) is a lower-ranked fallback.
//   4. Repo board: ~/projects/<repo> if it is already a checkout of the same
//      project (`found`), else clone it there → `cloned`.
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

/** A clone still downloading (or one left behind by a stopped helper): never a checkout. */
export const PARTIAL_MARKER = ".vibecodes-partial-";

/** @param {string} name */
function isSkippedName(name) {
  if (name.startsWith(".")) return true;
  if (name.includes(PARTIAL_MARKER)) return true;
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
 * The project name (last path segment, `.git` dropped, lower-cased) of any
 * remote — any host, SSH host aliases (`git@github-work:o/n.git`), or a local
 * path. Null when there is none.
 * @param {unknown} url
 * @returns {string | null}
 */
export function repoNameFromRemote(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!trimmed) return null;
  const last = trimmed.split(/[/:]/).pop() ?? "";
  return last ? last.toLowerCase() : null;
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

/** `owner/name` → `name`. @param {string} repoKey */
function nameOfKey(repoKey) {
  return repoKey.split("/").pop() ?? repoKey;
}

/**
 * How `dir` relates to the board's repo. Null when it isn't a checkout (a
 * real `.git` FOLDER — a `.git` file is a worktree or submodule and is
 * skipped). Otherwise the best remote: `exact` (same GitHub owner/name) over
 * `name` (same project name: a moved project or an SSH host alias), origin
 * over another remote; `remotes` says whether any remote named a project.
 * @returns {{ exact: boolean, name: boolean, origin: boolean, remotes: boolean } | null}
 */
function checkoutMatch(dir, repoKey, fs) {
  try {
    if (!fs.lstatSync(path.join(dir, ".git")).isDirectory()) return null;
    const remotes = parseGitRemotes(fs.readFileSync(path.join(dir, ".git", "config"), "utf8"));
    const wantName = nameOfKey(repoKey);
    let best = { exact: false, name: false, origin: false, remotes: false };
    const score = (m) => (m.exact ? 4 : m.name ? 2 : 0) + (m.origin ? 1 : 0);
    for (const r of remotes) {
      const remoteName = repoNameFromRemote(r.url);
      if (!remoteName) continue;
      best.remotes = true;
      const exact = normalizeGithubRepo(r.url) === repoKey;
      const name = exact || remoteName === wantName;
      if (!name) continue;
      const m = { exact, name, origin: r.name === "origin", remotes: true };
      if (score(m) > score(best)) best = m;
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Search/clone matching: a checkout with a remote of the same project.
 * @returns {{ exact: boolean, origin: boolean } | null}
 */
function remoteMatch(dir, repoKey, fs) {
  const m = checkoutMatch(dir, repoKey, fs);
  return m && m.name ? { exact: m.exact, origin: m.origin } : null;
}

/**
 * The page's folder / this Mac's saved folders: trusted when it is a checkout
 * and no remote says it is a DIFFERENT project (a checkout with no remotes is
 * trusted too — the Mac saved it for this board).
 * @returns {boolean}
 */
function trustedSavedCheckout(dir, repoKey, fs) {
  const m = checkoutMatch(dir, repoKey, fs);
  return !!m && (m.name || !m.remotes);
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
 * @returns {{ matches: { path: string, exact: boolean, origin: boolean, mtime: number }[], scanned: number, ms: number, stopped: boolean }}
 */
export function searchForCheckout({ home, repoKey, fs, now, budgetMs = SEARCH_BUDGET_MS, maxReads = SEARCH_MAX_READS }) {
  const started = now();
  let scanned = 0;
  let stopped = false;
  /** @type {Map<string, { path: string, exact: boolean, origin: boolean, mtime: number }>} */
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
    found.set(real, { path: real, exact: match.exact, origin: match.origin, mtime: lastUsed(dir, fs) });
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
      Number(b.exact) - Number(a.exact) ||
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
 * The resume rule, synchronous (the bridge decides before the relay link
 * opens): the conversation belongs to its folder, so it must exist here, and
 * passes the same final guard as any launch.
 * @param {{ hint: string | null, fs: any, homedir: string }} args
 * @returns {Resolution}
 */
export function resolveResumeFolder({ hint, fs, homedir: home }) {
  const hintPath = hint ? stripClaudeWorktreeSuffix(hint) : null;
  if (!hintPath || !isDirectory(hintPath, fs)) return { ok: false, reason: "folder-missing", detail: null };
  if (!allowed(hintPath, home) || !allowed(real(hintPath, fs), home)) return { ok: false, reason: "folder-not-allowed", detail: null };
  return { ok: true, path: hintPath, how: "saved", alsoFound: [] };
}

/** GitHub owner/name part: GitHub's own characters, never a leading "-" (it would read as a command option). */
const REPO_PART_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

/**
 * The app's workspace answer, checked before the bridge trusts any of it.
 * @param {unknown} raw @returns {Workspace | null}
 */
export function sanitizeWorkspace(raw) {
  if (!raw || typeof raw !== "object") return null;
  const w = /** @type {any} */ (raw);
  let repo = null;
  if (w.repo && typeof w.repo === "object") {
    const { owner, name, cloneUrl } = w.repo;
    if (typeof owner === "string" && REPO_PART_RE.test(owner) && typeof name === "string" && REPO_PART_RE.test(name) && typeof cloneUrl === "string") {
      repo = { owner, name, cloneUrl };
    }
  }
  if (typeof w.newFolderName !== "string") return null;
  const folderName = typeof w.repoFolderName === "string" ? w.repoFolderName : repo ? repo.name : null;
  return {
    repo,
    repoFolderName: folderName && REPO_PART_RE.test(folderName) ? folderName : null,
    newFolderName: w.newFolderName,
    savedFolders: Array.isArray(w.savedFolders) ? w.savedFolders.filter((p) => typeof p === "string").slice(0, 10) : [],
    otherLiveSessionsOnThisMac: Number.isFinite(w.otherLiveSessionsOnThisMac) ? Number(w.otherLiveSessionsOnThisMac) : 0,
  };
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
  if (isResume) return resolveResumeFolder({ hint, fs, homedir: home });

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
    if (repoKey && !trustedSavedCheckout(c, repoKey, fs)) continue;
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

    // 4. ~/projects/<repo> already a checkout of this project (the search can
    //    stop on its budget before reaching it) → reuse it, never a -2 copy.
    if (!isSafeFolderName(workspace.repoFolderName ?? "")) return { ok: false, reason: "folder-not-allowed", detail: null };
    const usual = path.join(home, "projects", /** @type {string} */ (workspace.repoFolderName));
    if (isDirectory(usual, fs) && remoteMatch(usual, repoKey, fs) && allowed(real(usual, fs), home)) {
      const p = real(usual, fs);
      onProgress({ kind: "found", path: p, alsoFound: [] });
      return { ok: true, path: p, how: "found", alsoFound: [] };
    }

    // 5. Clone.
    const cloned = await deps.clone({ repo, repoFolderName: /** @type {string} */ (workspace.repoFolderName) });
    if (!cloned?.ok) return { ok: false, reason: cloned?.reason || "clone-failed", detail: cloned?.detail ?? null };
    return guard({ ok: true, path: real(cloned.path, fs), how: "cloned", alsoFound: [] });
  }

  // 6. Repo-less board: ~/projects/<board name>.
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
