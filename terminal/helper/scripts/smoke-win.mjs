// Windows installer smoke test (card 51d424f7, release 1b). Run by
// .github/workflows/helper-windows.yml on a Windows runner of the same chip as
// the installer:
//
//   node scripts/smoke-win.mjs <path to VibeCodes-Setup-<v>-<arch>.exe> <arch>
//
// It installs silently for this user only (no administrator), checks the app
// and its bridge are where the packed app looks for them (with this chip's
// node-pty build and no Mac ones), starts the app and checks it is still
// running after a few seconds (a missing module crashes it at once: helper
// 0.2.0 and 0.3.13), then uninstalls silently and checks it is gone.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [installer, arch] = process.argv.slice(2);
if (!installer || !arch) {
  console.error("usage: node scripts/smoke-win.mjs <installer.exe> <x64|arm64>");
  process.exit(2);
}
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Silent per-user install. The one-click installer starts the app when it
//    finishes only when run by a person, not with /S.
execFileSync(installer, ["/S"], { stdio: "inherit" });
const programs = join(process.env.LOCALAPPDATA ?? "", "Programs");
const appDir = existsSync(programs)
  ? readdirSync(programs)
      .map((d) => join(programs, d))
      .find((d) => existsSync(join(d, "VibeCodes.exe")))
  : undefined;
if (!appDir) fail(`VibeCodes.exe not found under ${programs}`);
ok(`installed for this user in ${appDir}`);

// 2. What the packed app needs at startup.
const res = join(appDir, "resources");
for (const p of [
  "app.asar",
  join("bridge", "src", "index.js"),
  join("bridge", "node_modules", "ws"),
  join("bridge", "node_modules", "node-pty", "prebuilds", `win32-${arch}`),
  "shared",
]) {
  if (!existsSync(join(res, p))) fail(`missing ${p} in the installed app`);
}
const prebuilds = readdirSync(join(res, "bridge", "node_modules", "node-pty", "prebuilds"));
const macBuilds = prebuilds.filter((d) => d.startsWith("darwin-"));
if (macBuilds.length) fail(`the Windows app carries Mac node-pty builds: ${macBuilds.join(", ")}`);
ok(`bridge, node-pty (win32-${arch}) and shared modules are in place; no Mac builds`);

// 3. Start it and check it keeps running.
const exe = join(appDir, "VibeCodes.exe");
const child = spawn(exe, ["--hidden"], { stdio: "ignore", detached: false });
let exitedWith = null;
child.on("exit", (code) => {
  exitedWith = code ?? -1;
});
await sleep(10_000);
if (exitedWith !== null) fail(`the app quit within 10 seconds of starting (exit code ${exitedWith})`);
ok("the app started and is still running after 10 seconds");
try {
  execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
} catch {
  /* already gone */
}
await sleep(2_000);

// 4. Silent uninstall.
const uninstaller = readdirSync(appDir).find((f) => /^Uninstall .*\.exe$/i.test(f));
if (!uninstaller) fail("no uninstaller next to the app");
execFileSync(join(appDir, uninstaller), ["/S"], { stdio: "inherit" });
for (let i = 0; i < 30 && existsSync(exe); i++) await sleep(1_000);
if (existsSync(exe)) fail("the app is still installed after uninstalling");
ok("uninstalled");
