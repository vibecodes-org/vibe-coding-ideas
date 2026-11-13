import { test } from "node:test";
import assert from "node:assert/strict";
import { killTree } from "./reap-win.mjs";
import { reapProcessEscalated } from "./reap.mjs";

test("killTree runs taskkill /T /F on the pid", () => {
  let seen;
  const ok = killTree(1234, { run: (cmd, args) => { seen = [cmd, ...args]; return { status: 0 }; } });
  assert.equal(ok, true);
  assert.deepEqual(seen, ["taskkill", "/PID", "1234", "/T", "/F"]);
});

test("killTree reports failure and never throws", () => {
  assert.equal(killTree(1234, { run: () => ({ status: 128 }) }), false);
  assert.equal(killTree(1234, { run: () => { throw new Error("x"); } }), false);
  assert.equal(killTree(-1), false);
  assert.equal(killTree(NaN), false);
});

test("win32 reap: kills the tree, then confirms death", async () => {
  let alive = true;
  const killed = [];
  const stages = [];
  const res = await reapProcessEscalated(process.pid, {
    platform: "win32",
    isDead: () => !alive,
    killTreeImpl: (pid) => { killed.push(pid); alive = false; return true; },
    onStage: (s) => stages.push(s),
    pollMs: 5,
  });
  assert.deepEqual(killed, [process.pid]);
  assert.deepEqual(stages, ["taskkill"]);
  assert.deepEqual(res, { stage: "taskkill", confirmedDead: true });
});

test("win32 reap: already dead means no kill at all", async () => {
  let called = false;
  const res = await reapProcessEscalated(process.pid, {
    platform: "win32",
    isDead: () => true,
    killTreeImpl: () => { called = true; return true; },
  });
  assert.equal(called, false);
  assert.equal(res.stage, "already-dead");
});

test("win32 reap: a process that survives taskkill is reported unconfirmed", async () => {
  const res = await reapProcessEscalated(process.pid, {
    platform: "win32",
    isDead: () => false,
    killTreeImpl: () => false,
    pollMs: 20,
  });
  assert.equal(res.confirmedDead, false);
});
