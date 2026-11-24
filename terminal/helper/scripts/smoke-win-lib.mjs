// Pure pieces of the Windows installer smoke test (smoke-win.mjs), kept apart
// so they can be tested on any machine (terminal/test/smoke-win-lib.test.mjs).

/**
 * Reads the text `reg query <key>` prints into its values.
 * Each value line is 4 spaces, the name, 4 spaces, the type, 4 spaces, the data.
 * @param {string} out
 * @returns {{ name: string, type: string, data: string }[]}
 */
export function parseRegQuery(out) {
  const values = [];
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (m) values.push({ name: m[1], type: m[2], data: m[3] ?? "" });
  }
  return values;
}

/** True when a registry command line runs `exe` (ignoring case and quotes). */
export function pointsAt(data, exe) {
  if (!data || !exe) return false;
  const cmd = String(data).trim().toLowerCase();
  const target = exe.toLowerCase();
  return cmd.startsWith(`"${target}"`) || cmd === target || cmd.startsWith(`${target} `);
}

/**
 * Run by the installed VibeCodes.exe with ELECTRON_RUN_AS_NODE=1, given the
 * app's resources folder: loads the bridge's own ws and node-pty from there and
 * runs a real console command through node-pty. Prints one JSON line.
 */
export const PTY_OK_SCRIPT = `
const path = require("path");
const res = process.argv[process.argv.length - 1];
const done = (r) => { console.log(JSON.stringify(r)); process.exit(0); };
try {
  const ws = require(path.join(res, "bridge", "node_modules", "ws"));
  if (typeof (ws.WebSocket || ws) !== "function") done({ error: "ws did not load a WebSocket" });
  const pty = require(path.join(res, "bridge", "node_modules", "node-pty"));
  const p = pty.spawn("cmd.exe", ["/d", "/c", "echo ok"], {
    name: "xterm-256color", cols: 80, rows: 24, cwd: process.env.USERPROFILE || process.cwd(), env: process.env,
  });
  let out = "";
  p.onData((d) => { out += d; });
  p.onExit(({ exitCode }) => setTimeout(() => done({ exitCode, out }), 500));
  setTimeout(() => done({ error: "node-pty command did not finish in 30 seconds", out }), 30000);
} catch (e) {
  done({ error: String((e && e.stack) || e) });
}
`;
