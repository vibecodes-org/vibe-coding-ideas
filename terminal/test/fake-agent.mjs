// Writes a fake `claude`/`codex` into a PATH directory.
//
// POSIX: a `#!/bin/sh` script that runs the stand-in script with node.
// Windows: the same shape npm gives a real install: `<name>.cmd` whose last line
// launches `<name>.mjs` with node. That makes the bridge take its real
// "npm shim -> node script" route, so the tests exercise the shipped code.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
