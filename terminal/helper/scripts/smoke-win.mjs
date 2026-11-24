// Windows installer smoke test (card 51d424f7, release 1b). Run by
// .github/workflows/helper-windows.yml on a Windows runner of the same chip as
// the installer:
//
//   node scripts/smoke-win.mjs <path to VibeCodes-Setup-<v>-<arch>.exe> <arch>
//
// It installs silently for this user only (no administrator) and checks:
//   - the app and its bridge are where the packed app looks for them, with this
//     chip's node-pty build and no Mac ones;
//   - the installed app's own runtime (ELECTRON_RUN_AS_NODE=1) loads the
//     bridge's ws and node-pty and runs `cmd.exe /d /c echo ok` through
//     node-pty, printing ok. The bridge only starts when a launch link arrives,
//     so this is what proves the terminal itself can run (the Windows version
//     of the helper 0.3.15 "Cannot find module" guard);
//   - the app starts and is still running after 10 seconds (a missing module
//     crashes it at once: helper 0.2.0 and 0.3.13), with "Keep helper ready"
//     switched on so it writes its start-at-login entry;
//   - the installer itself registers vibecodes:// links: straight after the
//     silent install, before the app has ever started,
//     HKCU\Software\Classes\vibecodes is a URL handler whose
//     shell\open\command runs the installed exe;
//   - the same handler still runs the installed exe after the app's own start
//     (the app rewrites it at every start);
//   - a silent uninstall removes the exe, the vibecodes key and the
//     start-at-login entry.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRegQuery, pointsAt, PTY_OK_SCRIPT } from "./smoke-win-lib.mjs";

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

const LINK_KEY = "HKCU\\Software\\Classes\\vibecodes";
const LINK_COMMAND_KEY = `${LINK_KEY}\\shell\\open\\command`;
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/** The key's values, or null when the key does not exist. */
function regValues(key) {
  const r = spawnSync("reg", ["query", key], { encoding: "utf8" });
  return r.status === 0 ? parseRegQuery(r.stdout) : null;
}
const linkCommand = () => (regValues(LINK_COMMAND_KEY) ?? []).find((v) => v.name === "(Default)")?.data ?? "";
const runEntriesFor = (exe) => (regValues(RUN_KEY) ?? []).filter((v) => pointsAt(v.data, exe));

// 1. Silent per-user install. The one-click installer starts the app when it
//    finishes only when run by a person, not with /S. Any handler left from
//    an earlier run is removed first, so only this installer can pass step 2.
spawnSync("reg", ["delete", LINK_KEY, "/f"], { stdio: "ignore" });
execFileSync(installer, ["/S"], { stdio: "inherit" });
const programs = join(process.env.LOCALAPPDATA ?? "", "Programs");
const appDir = existsSync(programs)
  ? readdirSync(programs)
      .map((d) => join(programs, d))
      .find((d) => existsSync(join(d, "VibeCodes.exe")))
  : undefined;
if (!appDir) fail(`VibeCodes.exe not found under ${programs}`);
ok(`installed for this user in ${appDir}`);
const exe = join(appDir, "VibeCodes.exe");

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

// The installer, not the app, registered vibecodes:// links: nothing has
// started the app yet.
const linkValues = regValues(LINK_KEY);
if (linkValues === null) fail(`the installer did not register vibecodes:// links: ${LINK_KEY} is missing`);
if (!linkValues.some((v) => v.name === "URL Protocol")) fail(`${LINK_KEY} has no "URL Protocol" value`);
const installedCommand = linkCommand();
if (!pointsAt(installedCommand, exe)) {
  fail(`straight after install, ${LINK_COMMAND_KEY} does not run ${exe}: ${JSON.stringify(installedCommand)}`);
}
ok(`the installer registered vibecodes:// links before the app started (${installedCommand})`);

// 3. The installed app's own runtime runs a real console command through the
//    bridge's node-pty.
const scriptDir = mkdtempSync(join(tmpdir(), "vibecodes-smoke-"));
const ptyScript = join(scriptDir, "pty-ok.cjs");
writeFileSync(ptyScript, PTY_OK_SCRIPT);
const run = spawnSync(exe, [ptyScript, res], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  encoding: "utf8",
  timeout: 60_000,
});
const lastLine = (run.stdout ?? "").trim().split(/\r?\n/).pop() ?? "";
let result;
try {
  result = JSON.parse(lastLine);
} catch {
  fail(
    `the installed app could not run the node-pty check (exit ${run.status}, ${run.error ?? "no error"})\n` +
      `stdout: ${run.stdout}\nstderr: ${run.stderr}`,
  );
}
if (result.error) fail(`node-pty check: ${result.error}${result.out ? `\noutput: ${JSON.stringify(result.out)}` : ""}`);
// Strip the console's colour, cursor and title codes before looking for the word.
const text = String(result.out).replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "");
if (result.exitCode !== 0 || !/\bok\b/.test(text)) {
  fail(`node-pty ran cmd.exe but did not print ok (exit ${result.exitCode}): ${JSON.stringify(result.out)}`);
}
ok("the installed app loads the bridge's ws and node-pty and runs cmd.exe through node-pty (printed ok)");

// 4. Start it with "Keep helper ready" on, so it writes its start-at-login
//    entry, and check it keeps running. The settings folder is named after the
//    app; write both names Electron might use.
for (const name of ["VibeCodes", "vibecodes-terminal-helper"]) {
  const dir = join(process.env.APPDATA ?? "", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "helper-settings.json"), JSON.stringify({ alwaysOn: true }));
}
const child = spawn(exe, ["--hidden"], { stdio: "ignore", detached: false });
let exitedWith = null;
child.on("exit", (code) => {
  exitedWith = code ?? -1;
});
await sleep(10_000);
if (exitedWith !== null) fail(`the app quit within 10 seconds of starting (exit code ${exitedWith})`);
ok("the app started and is still running after 10 seconds");

// 5. After the app's own start, the vibecodes:// link handler (which the app
//    rewrites at every start) and the start-at-login entry run the installed
//    app.
const command = linkCommand();
if (!pointsAt(command, exe)) fail(`${LINK_COMMAND_KEY} does not run ${exe}: ${JSON.stringify(command)}`);
ok(`vibecodes:// links open the installed app (${command})`);
const runEntries = runEntriesFor(exe);
if (!runEntries.length) fail(`no start-at-login entry under ${RUN_KEY} runs ${exe}`);
ok(`start-at-login entry written: ${runEntries.map((v) => v.name).join(", ")}`);

try {
  execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
} catch {
  /* already gone */
}
await sleep(2_000);

// 6. Silent uninstall.
const uninstaller = readdirSync(appDir).find((f) => /^Uninstall .*\.exe$/i.test(f));
if (!uninstaller) fail("no uninstaller next to the app");
execFileSync(join(appDir, uninstaller), ["/S"], { stdio: "inherit" });
for (let i = 0; i < 30 && existsSync(exe); i++) await sleep(1_000);
if (existsSync(exe)) fail("the app is still installed after uninstalling");
for (let i = 0; i < 10 && regValues(LINK_KEY) !== null; i++) await sleep(1_000);
if (regValues(LINK_KEY) !== null) fail(`${LINK_KEY} is still there after uninstalling`);
const leftOver = runEntriesFor(exe);
if (leftOver.length) fail(`start-at-login entry still there after uninstalling: ${leftOver.map((v) => v.name).join(", ")}`);
ok("uninstalled: the app, the vibecodes:// link handler and the start-at-login entry are gone");
