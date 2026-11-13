// Turn "the agent binary we resolved" into the exact (file, args) to hand to
// node-pty, per platform.
//
// macOS/Linux: unchanged — the resolved name and args go straight through, the
// prompt stays ONE argv element and never touches a shell.
//
// Windows: a native `claude.exe` is spawned directly too. An npm install gives
// `claude.cmd`/`codex.cmd`, which CreateProcess cannot run on its own:
//   1. we first look inside the shim for the real `node` script it forwards to
//      and run `node <script> args...` directly (no shell, so the prompt keeps
//      its newlines and quoting exactly, same as on a Mac);
//   2. only if the shim is not the standard npm shape do we fall back to
//      `cmd.exe /d /s /c "<shim> <args>"` with every argument escaped for cmd.
//      cmd cannot carry a newline in a command line, so newlines become spaces
//      there (reported via `collapsedNewlines`). cmd also expands `%...%`
//      forms and nothing can escape them, so a `%` anywhere in that fallback
//      makes toSpawnable throw (code CMD_PERCENT_REFUSED) instead of launching.

import fs from "node:fs";
import path from "node:path";

const CMD_META = /[()%!^"<>&|;, ]/g;

/** True for a Windows batch shim. */
export function isBatchShim(file) {
  return /\.(cmd|bat)$/i.test(String(file));
}

/**
 * Escape one argument for a `cmd.exe /s /c "..."` command line that runs a
 * `.cmd` shim (which re-parses the line, so metacharacters are escaped twice).
 * Same algorithm the well-known cross-spawn package uses.
 * @param {string} arg
 * @returns {string}
 */
export function escapeCmdArg(arg) {
  let a = String(arg);
  a = a.replace(/(\\*)"/g, '$1$1\\"'); // quotes: double the backslashes before one
  a = a.replace(/(\\*)$/, "$1$1"); // trailing backslashes would eat the closing quote
  a = `"${a}"`;
  a = a.replace(CMD_META, "^$&"); // for the outer cmd
  a = a.replace(CMD_META, "^$&"); // and for the shim's own re-parse
  return a;
}

/** Escape the program path itself (no wrapping quotes: cmd /s strips the outer pair). */
export function escapeCmdCommand(file) {
  return String(file).replace(CMD_META, "^$&");
}

/**
 * Read an npm `.cmd` shim and return the JS file it launches, or null.
 * npm writes: `... "%_prog%"  "%dp0%\node_modules\<pkg>\<file>.js" %*`.
 * @param {string} shimPath
 * @param {(p: string) => string} readFile
 */
export function shimScriptTarget(shimPath, readFile = (p) => fs.readFileSync(p, "utf8")) {
  let text;
  try {
    text = readFile(shimPath);
  } catch {
    return null;
  }
  const m = text.match(/"%dp0%\\([^"\r\n]+?\.m?js)"/i);
  if (!m) return null;
  const rel = m[1].replace(/^\\+/, "");
  if (rel.includes("..\\..") || rel.includes("%")) return null; // not the plain npm shape
  return path.win32.join(path.win32.dirname(shimPath), rel);
}

/**
 * @param {string} resolvedPath the file the agent resolved to (full path on Windows)
 * @param {string[]} args
 * @param {{ platform?: string, readFile?: (p: string) => string,
 *           findNode?: (shimDir: string) => string | null,
 *           comspec?: string, exists?: (p: string) => boolean }} [opts]
 * @returns {{ file: string, args: string[] | string, via: "direct" | "node-shim" | "cmd",
 *             collapsedNewlines?: boolean }}
 */
export function toSpawnable(resolvedPath, args, opts = {}) {
  const platform = opts.platform || process.platform;
  if (platform !== "win32" || !isBatchShim(resolvedPath)) {
    return { file: resolvedPath, args, via: "direct" };
  }
  const exists = opts.exists || ((p) => fs.existsSync(p));
  const script = shimScriptTarget(resolvedPath, opts.readFile);
  if (script) {
    const shimDir = path.win32.dirname(resolvedPath);
    const sibling = path.win32.join(shimDir, "node.exe");
    const node = exists(sibling) ? sibling : opts.findNode?.(shimDir) || null;
    if (node) return { file: node, args: [script, ...args], via: "node-shim" };
  }
  // cmd expands %VAR%, %VAR:~0% and %VAR:a=b% inside a command line even when
  // the text is quoted, and the expanded value lands unescaped (a value holding
  // & or | would then run as a command). No escape works for % on a command
  // line, so the fallback refuses any % (in the path or an argument).
  if ([resolvedPath, ...args].some((a) => String(a).includes("%"))) {
    const err = new Error(
      "Refusing to start this program through cmd.exe: its launcher is not the standard npm shape and a '%' in the command line would be expanded by cmd.",
    );
    err.code = "CMD_PERCENT_REFUSED";
    throw err;
  }
  const collapsedNewlines = args.some((a) => /[\r\n]/.test(a));
  const line = [escapeCmdCommand(resolvedPath), ...args.map((a) => escapeCmdArg(String(a).replace(/\r?\n|\r/g, " ")))].join(" ");
  return {
    file: opts.comspec || process.env.ComSpec || "cmd.exe",
    args: `/d /s /c "${line}"`,
    via: "cmd",
    collapsedNewlines,
  };
}
