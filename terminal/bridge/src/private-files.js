// Launch files kept off the command line (card 9b5336c1, stage 2).
//
// `ps` shows every account the full command line of every process, and
// `pkill -f` matches against it. So anything readable or secret (the peer
// hook's secret URL, the same-Mac messaging note, a big board's agent prompts)
// travels as a file instead: owner-only (0600) inside an owner-only (0700)
// folder made fresh for this session, removed when the session ends. Contents
// are never logged.
//
// The folder is outside the project and ~/.codex / ~/.claude. A SIGKILLed
// bridge leaves it to the OS temp cleaner.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @param {{ fs?: typeof fs, os?: typeof os, path?: typeof path }} [deps]
 */
export function createPrivateFiles(deps = {}) {
  const { fs: f = fs, os: o = os, path: p = path } = deps;
  /** @type {string | null} */
  let dir = null;

  /** The session's private folder, made on first use (mkdtemp is mode 0700). */
  function ensureDir() {
    if (!dir) {
      dir = f.mkdtempSync(p.join(o.tmpdir(), "vibecodes-agents-"));
      try { f.chmodSync(dir, 0o700); } catch { /* not supported on Windows */ }
    }
    return dir;
  }

  return {
    /**
     * Write one file (mode 0600) and return its absolute path.
     * @param {string} fileName a plain file name, no folders
     * @param {string} text
     */
    write(fileName, text) {
      if (fileName !== p.basename(fileName) || fileName === "" || fileName === "..") {
        throw new Error("private file name must be a plain file name");
      }
      const filePath = p.join(ensureDir(), fileName);
      f.writeFileSync(filePath, text, { mode: 0o600 });
      try { f.chmodSync(filePath, 0o600); } catch { /* not supported on Windows */ }
      return filePath;
    },
    /** Where a file of this name would live (makes the folder). */
    pathFor(/** @type {string} */ fileName) {
      return p.join(ensureDir(), fileName);
    },
    /** Delete the folder and everything in it. Safe to call twice. */
    remove() {
      if (!dir) return;
      try { f.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      dir = null;
    },
    /** For tests. */
    get dir() {
      return dir;
    },
  };
}
