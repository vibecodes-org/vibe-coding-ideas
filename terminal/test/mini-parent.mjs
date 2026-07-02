// Mini-parent fixture — a stand-in for the HELPER's supervision of the bridge,
// used by orphan-cleanup.test.mjs. It forks the bridge exactly the way
// terminal/helper/main.js does (node `fork` ⇒ an IPC channel on fd 3) and
// relays the bridge's IPC messages ({type:"pty-pid",…}) to stdout as JSON
// lines, so the test can observe the helper protocol without Electron.
//
// The bridge's stdout/stderr are INHERITED — they stay bound to the pipes the
// test gave THIS process, so bridge logs keep flowing to the test even after
// this parent is SIGKILL'd (that is precisely the parent-death scenario).
//
// Usage: node mini-parent.mjs <bridge-entry.js> [bridge args...]

import { fork } from "node:child_process";

const [entry, ...rest] = process.argv.slice(2);
if (!entry) {
  process.stderr.write("mini-parent: missing bridge entry path\n");
  process.exit(2);
}

const child = fork(entry, rest, {
  env: process.env,
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});

process.stdout.write(JSON.stringify({ type: "bridge-pid", pid: child.pid }) + "\n");

child.on("message", (m) => {
  process.stdout.write(JSON.stringify({ relayed: true, ...m }) + "\n");
});

child.on("exit", (code, signal) => {
  process.stdout.write(JSON.stringify({ type: "bridge-exit", code, signal }) + "\n");
});

// Stay alive until killed — the test SIGKILLs us to simulate a dead helper.
setInterval(() => {}, 60_000);
