// Shared "long-lived marked child" helpers for the reap/orphan tests.
//
// POSIX: the child is `bash -c "trap '' HUP; exec sleep <mark>"` (ignores
// SIGHUP, like claude) and is found with `pgrep`.
// Windows: the child is `node sentinel-sleep.mjs <mark>` (a plain node process;
// Windows has no SIGHUP) and is found by its exact command line through the
// real process table (PowerShell + CIM), so the bridge's own command line,
// which merely CONTAINS the same text, is never mistaken for it.

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { killTree } from "../shared/reap-win.mjs";

export const IS_WIN = process.platform === "win32";
const SENTINEL_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./sentinel-sleep.mjs");

/** The PTY command for a marked, long-lived child. `alsoTerm` only matters on POSIX. */
export function sentinelCmd(mark, { alsoTerm = false } = {}) {
  if (IS_WIN) return `${process.execPath} ${SENTINEL_SCRIPT} ${mark}`;
  const traps = alsoTerm ? "trap '' HUP TERM" : "trap '' HUP";
  return `bash -c "${traps}; exec sleep ${mark}"`;
}

/**
 * Pids of live sentinels. `mark` is the full mark, or with `prefix: true` the
 * leading digits shared by every mark of one test file.
 * @returns {Promise<number[]>}
 */
export function sentinelPids(mark, { prefix = false } = {}) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      execFile("pgrep", ["-f", `^sleep ${mark}${prefix ? "" : "$"}`], (_e, out) =>
        resolve(String(out || "").trim().split("\n").filter(Boolean).map(Number)),
      );
      return;
    }
    const tail = prefix ? `${mark}\\d*` : mark;
    const rx = `^\\"?[^\\"]*node\\.exe\\"?\\s+\\"?[^\\"]*sentinel-sleep\\.mjs\\"?\\s+${tail}\\s*$`;
    const ps =
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
      `Where-Object { $_.CommandLine -match '${rx.replace(/'/g, "''")}' } | ` +
      `ForEach-Object { $_.ProcessId }`;
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true }, (_e, out) =>
      resolve(String(out || "").trim().split(/\r?\n/).filter(Boolean).map(Number)),
    );
  });
}

/** End a sentinel (and anything it started) whatever the platform. */
export function killSentinel(pid) {
  if (IS_WIN) {
    killTree(pid);
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch { /* ignore */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
}
