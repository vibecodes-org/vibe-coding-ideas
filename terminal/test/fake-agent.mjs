// Writes a fake `claude`/`codex` into a PATH directory.
//
// POSIX: a `#!/bin/sh` script that runs the stand-in script with node.
// Windows: the same shape npm gives a real install: `<name>.cmd` whose last line
// launches `<name>.mjs` with node. That makes the bridge take its real
// "npm shim -> node script" route, so the tests exercise the shipped code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { killTree } from "../shared/reap-win.mjs";

export const IS_WIN = process.platform === "win32";

/**
 * @param {string} dir PATH directory
 * @param {string} name "claude" or "codex"
 * @param {string} script absolute path of the node script the agent should run
 * @param {{ version?: string }} [opts] answer `--version` with this text (like the bridge's probe expects)
 */
export function writeFakeAgent(dir, name, script, opts = {}) {
  if (!IS_WIN) {
    const version = opts.version ? `if [ "$1" = "--version" ]; then echo "${opts.version}"; exit 0; fi\n` : "";
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${version}exec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
    return;
  }
  const body =
    (opts.version ? `if (process.argv[2] === "--version") { console.log(${JSON.stringify(opts.version)}); process.exit(0); }\n` : "") +
    `await import(${JSON.stringify(pathToFileURL(script).href)});\n`;
  fs.writeFileSync(path.join(dir, `${name}.mjs`), body);
  fs.writeFileSync(
    path.join(dir, `${name}.cmd`),
    `@ECHO off\r\nSETLOCAL\r\nSET "_prog=node"\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${name}.mjs" %*\r\n`,
  );
}

/**
 * The few system variables a Windows child needs when a test hands it a
 * deliberately small environment (node, cmd.exe and sockets all want them).
 * Empty off Windows, so Mac/Linux runs are unchanged.
 */
export function winEnv(home) {
  if (!IS_WIN) return {};
  const out = {};
  for (const k of ["SystemRoot", "SYSTEMDRIVE", "ComSpec", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "windir"]) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  if (home) out.USERPROFILE = home; // Windows finds the home folder through USERPROFILE, not HOME
  return out;
}

/**
 * End a bridge a test started, plus the agent it launched. On Windows a plain
 * kill ends only the bridge and leaves the agent running in the test folder,
 * which then cannot be deleted; taskkill /T ends the whole tree.
 */
export function killBridge(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN && child.pid) killTree(child.pid);
  else child.kill("SIGKILL");
}

/** Delete a test folder; on Windows a just-ended process can hold it for a moment, so retry. */
export function rmDir(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

const EXIT_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./exit-code.mjs");

/** A `--cmd` that exits with `code`: a shell one-liner on POSIX, a node script on Windows (no sh there). */
export function exitCmd(code) {
  return IS_WIN ? `${process.execPath} ${EXIT_SCRIPT} ${code}` : `sh -c 'exit ${code}'`;
}
