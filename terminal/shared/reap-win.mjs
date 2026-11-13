// Windows process-tree kill. Windows has no process groups or POSIX signals:
// `process.kill(pid)` ends only that one process and leaves its children (the
// agent's shells, MCP servers, helpers) running. `taskkill /T /F` ends the
// whole tree. Used by reap.mjs's reapProcessEscalated on win32.

import { spawnSync } from "node:child_process";

/**
 * Kill `pid` and everything it started. Best effort, bounded, never throws.
 * @param {number} pid
 * @param {{ run?: typeof spawnSync }} [opts]
 * @returns {boolean} true when taskkill reported success
 */
export function killTree(pid, opts = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const run = opts.run || spawnSync;
  try {
    const r = run("taskkill", ["/PID", String(pid), "/T", "/F"], {
      timeout: 5000,
      stdio: "ignore",
      windowsHide: true,
    });
    return r?.status === 0;
  } catch {
    return false;
  }
}
