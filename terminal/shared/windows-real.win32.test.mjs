// Windows-only tests that use NO fakes: the real taskkill, the real cmd.exe and
// the real registry. They are skipped (with the reason shown) anywhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { killTree } from "./reap-win.mjs";
import { reapProcessEscalated } from "./reap.mjs";
import { toSpawnable } from "./spawnable.mjs";
import { resolveWindowsPath } from "./spawn-path.mjs";

const skip = process.platform === "win32" ? false : "Windows-only: needs the real taskkill, cmd.exe and registry";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

/** Start a real parent node process that starts a real child; resolve both pids. */
async function startTree() {
  const parent = spawn(
    process.execPath,
    [
      "-e",
      `const { spawn } = require("node:child_process");
       const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
       console.log("CHILD " + c.pid);
       setInterval(()=>{},1000);`,
    ],
    { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
  );
  const childPid = await new Promise((resolve, reject) => {
    let buf = "";
    parent.stdout.on("data", (d) => {
      buf += d;
      const m = buf.match(/CHILD (\d+)/);
      if (m) resolve(Number(m[1]));
    });
    parent.on("error", reject);
    setTimeout(() => reject(new Error("child pid never reported")), 10000);
  });
  return { parent, parentPid: parent.pid, childPid };
}

test("real taskkill ends a parent AND its child", { skip }, async () => {
  const { parentPid, childPid } = await startTree();
  assert.ok(alive(parentPid) && alive(childPid));
  assert.equal(killTree(parentPid), true);
  assert.ok(await waitFor(() => !alive(parentPid) && !alive(childPid)), "parent and child both dead");
});

test("real reapProcessEscalated ends the whole tree and confirms death", { skip }, async () => {
  const { parentPid, childPid } = await startTree();
  const res = await reapProcessEscalated(parentPid, { pollMs: 50 });
  assert.ok(res, "reap reported a result");
  assert.ok(await waitFor(() => !alive(parentPid) && !alive(childPid)), "parent and child both dead");
});

// A launcher that is NOT the standard npm shape, so the cmd.exe route is used.
function makeCmdTool(dir) {
  fs.writeFileSync(path.join(dir, "dump.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
  const tool = path.join(dir, "my tool.cmd");
  fs.writeFileSync(tool, `@echo off\r\n"${process.execPath}" "%~dp0dump.js" %*\r\n`);
  return tool;
}
function runTarget(t) {
  assert.equal(t.via, "cmd");
  // args is one ready-made command line: hand it to cmd untouched.
  return spawnSync(t.file, [t.args], { windowsVerbatimArguments: true, encoding: "utf8", windowsHide: true });
}

test("real .cmd launcher through the cmd.exe route: exact arguments arrive", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc cmd "));
  try {
    const tool = makeCmdTool(dir);
    const args = [
      "plain",
      "two words",
      'say "hi" there',
      "a & b | c",
      "caret ^ bang ! (paren) <in >out",
      "semi;comma,eq=x",
      "trailing backslash\\",
      "multi\nline",
    ];
    const r = runTarget(toSpawnable(tool, args));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      JSON.parse(r.stdout),
      args.map((a) => a.replace(/\r?\n|\r/g, " ")),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real cmd.exe really does expand the % edit forms (why they are refused)", { skip }, () => {
  const env = { ...process.env, VC_EVIL: "x & echo INJECTED" };
  const r = spawnSync(process.env.ComSpec || "cmd.exe", ['/d /s /c "echo [%VC_EVIL:~0%]"'], {
    windowsVerbatimArguments: true,
    encoding: "utf8",
    env,
    windowsHide: true,
  });
  assert.match(r.stdout, /INJECTED/, "premise: cmd expands %VAR:~0% and the value runs as a command");
});

test("real cmd route refuses every % form, and a % is safe on the node route", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc cmd "));
  try {
    const tool = makeCmdTool(dir);
    for (const bad of ["%VC_EVIL%", "%VC_EVIL:~0%", "%VC_EVIL:a=b%", "100%"]) {
      assert.throws(() => toSpawnable(tool, ["ok", bad]), (e) => e.code === "CMD_PERCENT_REFUSED", bad);
    }
    // A standard npm shim is run by node directly, so the same text arrives untouched.
    const shim = path.join(dir, "std.cmd");
    fs.writeFileSync(shim, `@ECHO off\r\n"%_prog%"  "%dp0%\\dump.js" %*\r\n`);
    const t = toSpawnable(shim, ["%VC_EVIL:~0%"], { exists: () => false, findNode: () => process.execPath });
    assert.equal(t.via, "node-shim");
    const r = spawnSync(t.file, t.args, { encoding: "utf8", env: { ...process.env, VC_EVIL: "x & echo INJECTED" } });
    assert.deepEqual(JSON.parse(r.stdout), ["%VC_EVIL:~0%"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real registry: a folder added to the user PATH is found, then removed", { skip }, () => {
  const key = "HKCU\\Environment";
  const marker = path.join(os.tmpdir(), `vc-registry-path-${process.pid}`);
  const read = () => {
    try {
      const out = execFileSync("reg", ["query", key, "/v", "Path"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const m = out.match(/^\s*Path\s+(REG_\w+)\s+(.*?)\s*$/im);
      return m ? { type: m[1], value: m[2] } : null;
    } catch {
      return null;
    }
  };
  const original = read();
  try {
    const next = `${original ? original.value + ";" : ""}${marker}`;
    execFileSync("reg", ["add", key, "/v", "Path", "/t", "REG_SZ", "/d", next, "/f"], { stdio: "ignore" });
    // The live environment does not have it; only a fresh registry read can.
    const env = { ...process.env, PATH: "C:\\Windows\\System32" };
    const merged = resolveWindowsPath({ env, run: execFileSync }).split(";");
    assert.ok(merged.includes(marker), "registry-only folder appears");
    assert.equal(merged[0], "C:\\Windows\\System32", "live PATH keeps first place");
    assert.ok(
      merged.some((d) => d.toLowerCase().endsWith(path.join(".local", "bin").toLowerCase())),
      "~/.local/bin added",
    );
  } finally {
    if (original) {
      execFileSync("reg", ["add", key, "/v", "Path", "/t", original.type, "/d", original.value, "/f"], { stdio: "ignore" });
    } else {
      spawnSync("reg", ["delete", key, "/v", "Path", "/f"], { stdio: "ignore" });
    }
  }
});

test("real registry: machine PATH read returns real System32", { skip }, () => {
  const merged = resolveWindowsPath({ env: { PATH: "" }, run: execFileSync }).toLowerCase();
  assert.ok(merged.includes("system32"), "machine PATH from the registry includes System32");
});
