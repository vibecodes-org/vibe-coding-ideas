// Download the board's GitHub project onto this Mac when no checkout exists
// (card 6b2cb8ac, approved decisions 4 and 5).
//
//   - Git must be there: `xcode-select -p` AND `git --version` (macOS). On a
//     brand-new Mac without Apple's developer tools, open Apple's own installer
//     (`xcode-select --install`, fire-and-forget) and stop with `git-missing`.
//   - Destination ~/projects/<repo>; an empty folder of that name is fine, one
//     taken by something else gets -2 … -9. The clone goes into a temporary
//     sibling folder and is renamed into place only on success, so a failed or
//     stopped download never leaves a half-made project behind. A temporary
//     folder of THIS project left by a process that is no longer running (a
//     helper quit mid-download) is cleared before a new download; one whose
//     process is still running is left alone.
//   - Never a password prompt: GIT_TERMINAL_PROMPT=0 and no askpass helpers, so
//     a hidden process can't sit waiting on input. The Mac's own credential
//     helpers still apply (Apple's git uses the keychain).
//   - Access failure only: try GitHub's `gh` (when signed in), then SSH (only
//     when ~/.ssh/known_hosts already knows github.com, so nothing ever asks
//     to trust a host key).
//   - Progress from git's "Receiving objects: NN%" (at most every 500ms, only
//     on change); a download with no output for 60s is stopped; 20 min cap.
//
// Every process is spawned with an argv array, never through a shell. `run`
// (sync probes), `spawn`, `fs`, `now` and `onProgress` are injected — see
// git-clone.test.js.

import path from "node:path";
import { isSafeFolderName, PARTIAL_MARKER } from "./folder-resolve.js";

export const STALL_MS = 60_000;
export const CAP_MS = 20 * 60_000;
const PROGRESS_EVERY_MS = 500;
const MAX_SUFFIX = 9;

/**
 * The last "Receiving objects: NN%" in a chunk of git's stderr, or null.
 * @param {string} text
 * @returns {number | null}
 */
export function parseCloneProgress(text) {
  let pct = null;
  for (const m of String(text).matchAll(/Receiving objects:\s+(\d+)%/g)) pct = Number(m[1]);
  return pct;
}

/**
 * @param {string} stderr
 * @returns {"clone-no-access" | "folder-unavailable" | "clone-failed"}
 */
export function classifyCloneError(stderr) {
  const s = String(stderr);
  if (/Repository not found|Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|returned error: 403/i.test(s)) {
    return "clone-no-access";
  }
  if (/No space left|Read-only file system/i.test(s)) return "folder-unavailable";
  return "clone-failed";
}

/** The last non-empty stderr line, bounded — shown in the terminal only. */
function lastLine(stderr) {
  const lines = String(stderr)
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const line = lines[lines.length - 1] ?? "";
  return line ? line.slice(0, 200) : null;
}

/** @returns {boolean} */
function isEmptyDir(p, fs) {
  try {
    return fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
function exists(p, fs) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * ~/projects/<name>, or an empty folder of that name, else <name>-2 … -9.
 * @param {{ home: string, repoFolderName: string, fs: any }} opts
 * @returns {string | null}
 */
export function pickCloneDestination({ home, repoFolderName, fs }) {
  if (!isSafeFolderName(repoFolderName)) return null;
  const parent = path.join(home, "projects");
  for (let i = 1; i <= MAX_SUFFIX; i++) {
    const candidate = path.join(parent, i === 1 ? repoFolderName : `${repoFolderName}-${i}`);
    if (!exists(candidate, fs) || isEmptyDir(candidate, fs)) return candidate;
  }
  return null;
}

/** @param {number} pid @returns {boolean} */
function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {any} */ (e)?.code === "EPERM"; // alive, someone else's
  }
}

/**
 * Remove ~/projects/<name>[-N].vibecodes-partial-<pid> folders whose process
 * has gone. Never touches another project's, or a live process's.
 * @param {{ home: string, repoFolderName: string, fs: any, pid: number, isPidAlive: (pid: number) => boolean, log: Function }} opts
 */
export function clearStalePartials({ home, repoFolderName, fs, pid, isPidAlive, log }) {
  const parent = path.join(home, "projects");
  const escaped = repoFolderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}(?:-[2-9])?${PARTIAL_MARKER.replace(/[.]/g, "\\.")}(\\d+)$`);
  let entries = [];
  try {
    entries = fs.readdirSync(parent);
  } catch {
    return;
  }
  for (const name of entries) {
    const m = re.exec(name);
    if (!m) continue;
    const owner = Number(m[1]);
    if (owner === pid || isPidAlive(owner)) continue;
    try {
      fs.rmSync(path.join(parent, name), { recursive: true, force: true });
      log("cleared a stale partial download", { pid: owner });
    } catch {
      /* best effort */
    }
  }
}

/** @returns {boolean} the probe ran and exited 0 */
function probeOk(run, file, args, opts) {
  try {
    const r = run(file, args, opts);
    return !!r && r.status === 0 && !r.error;
  } catch {
    return false;
  }
}

/**
 * @param {{ repo: { owner: string, name: string, cloneUrl: string }, home: string, repoFolderName: string,
 *   env: Record<string, string | undefined>, platform?: string, run: Function, spawn: Function, fs: any,
 *   now?: () => number, onProgress?: (e: object) => void, pid?: number, isPidAlive?: (pid: number) => boolean, stallMs?: number, capMs?: number,
 *   log?: (msg: string, extra?: object) => void }} opts
 * @returns {Promise<{ ok: true, path: string } | { ok: false, reason: string, detail: string | null }>}
 */
export async function cloneRepo(opts) {
  const { repo, home, repoFolderName, run, spawn, fs } = opts;
  const platform = opts.platform ?? process.platform;
  const now = opts.now ?? (() => Date.now());
  const onProgress = opts.onProgress ?? (() => {});
  const log = opts.log ?? (() => {});
  const pid = opts.pid ?? process.pid;
  const stallMs = opts.stallMs ?? STALL_MS;
  const capMs = opts.capMs ?? CAP_MS;
  const env = {
    ...opts.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
  };

  // Git present? On macOS /usr/bin/git is a shim that pops Apple's installer
  // dialog on its own when the tools are missing — check xcode-select first.
  const gitOk =
    (platform !== "darwin" || probeOk(run, "xcode-select", ["-p"], { env })) && probeOk(run, "git", ["--version"], { env });
  if (!gitOk) {
    try {
      const child = spawn("xcode-select", ["--install"], { detached: true, stdio: "ignore", env });
      child.on?.("error", () => {});
      child.unref?.();
    } catch {
      /* best effort — the message still explains what to do */
    }
    log("git missing — opened Apple's installer");
    return { ok: false, reason: "git-missing", detail: null };
  }

  if (isSafeFolderName(repoFolderName)) {
    clearStalePartials({ home, repoFolderName, fs, pid, isPidAlive: opts.isPidAlive ?? defaultIsPidAlive, log });
  }
  const dest = pickCloneDestination({ home, repoFolderName, fs });
  if (!dest) return { ok: false, reason: "folder-unavailable", detail: null };
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch (e) {
    return { ok: false, reason: "folder-unavailable", detail: String(/** @type {any} */ (e)?.code || e) };
  }
  const tmp = `${dest}${PARTIAL_MARKER}${pid}`;
  const cleanup = () => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  onProgress({ kind: "clone-start", repo, dest });

  let lastPct = null;
  let lastEmit = -Infinity;
  const attempt = (file, args, extraEnv = {}) =>
    new Promise((resolve) => {
      cleanup();
      let stderr = "";
      let settled = false;
      let child;
      const finish = (/** @type {{ code: number | null, stalled?: boolean, error?: string }} */ r) => {
        if (settled) return;
        settled = true;
        clearTimeout(stallTimer);
        clearTimeout(capTimer);
        resolve({ ...r, stderr });
      };
      try {
        child = spawn(file, args, { env: { ...env, ...extraEnv }, stdio: ["ignore", "ignore", "pipe"] });
      } catch (e) {
        resolve({ code: null, stderr: "", error: String(/** @type {any} */ (e)?.message || e) });
        return;
      }
      let stallTimer = setTimeout(() => stop(true), stallMs);
      const capTimer = setTimeout(() => stop(true), capMs);
      const stop = (stalled) => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        finish({ code: null, stalled });
      };
      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr = (stderr + text).slice(-8192);
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => stop(true), stallMs);
        const pct = parseCloneProgress(text);
        const t = now();
        if (pct !== null && pct !== lastPct && t - lastEmit >= PROGRESS_EVERY_MS) {
          lastPct = pct;
          lastEmit = t;
          onProgress({ kind: "clone-progress", pct });
        }
      });
      child.on("error", (e) => finish({ code: null, error: String(e?.message || e) }));
      child.on("close", (code) => finish({ code }));
    });

  const tries = [() => attempt("git", ["clone", "--progress", repo.cloneUrl, tmp])];
  /** @type {any} */
  let result = await tries[0]();
  let reason = result.code === 0 ? null : result.stalled ? "clone-failed" : classifyCloneError(result.stderr);

  if (reason === "clone-no-access" && probeOk(run, "gh", ["auth", "status"], { env })) {
    log("clone: access failed — trying gh");
    result = await attempt("gh", ["repo", "clone", `${repo.owner}/${repo.name}`, tmp, "--", "--progress"]);
    reason = result.code === 0 ? null : result.stalled ? "clone-failed" : classifyCloneError(result.stderr);
  }
  if (reason === "clone-no-access" && knowsGithubHostKey(home, fs)) {
    log("clone: access failed — trying ssh");
    result = await attempt("git", ["clone", "--progress", `git@github.com:${repo.owner}/${repo.name}.git`, tmp], {
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
    });
    reason = result.code === 0 ? null : result.stalled ? "clone-failed" : classifyCloneError(result.stderr);
  }

  if (reason) {
    cleanup();
    const detail = result.stalled ? "stalled" : lastLine(result.stderr) ?? result.error ?? null;
    log("clone failed", { reason });
    return { ok: false, reason, detail };
  }
  try {
    fs.renameSync(tmp, dest);
  } catch (e) {
    cleanup();
    return { ok: false, reason: "folder-unavailable", detail: String(/** @type {any} */ (e)?.code || e) };
  }
  return { ok: true, path: dest };
}

/** Does ~/.ssh/known_hosts already mention github.com? */
function knowsGithubHostKey(home, fs) {
  try {
    return /github\.com/.test(fs.readFileSync(path.join(home, ".ssh", "known_hosts"), "utf8"));
  } catch {
    return false;
  }
}
