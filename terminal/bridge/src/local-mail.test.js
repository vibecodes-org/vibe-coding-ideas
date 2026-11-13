import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { agentInstructions, createMailbox, parseOutgoing, shellPath } from "./local-mail.js";

test("parseOutgoing reads list and send requests", () => {
  assert.deepEqual(parseOutgoing("list\n\n"), { ok: true, cmd: "list" });
  assert.deepEqual(parseOutgoing("send\nc1aude22\nhello\nthere"), { ok: true, cmd: "send", to: "c1aude22", text: "hello\nthere" });
  assert.equal(parseOutgoing("rm\n").ok, false);
  assert.match(parseOutgoing("send\n\nhi").error, /session id/);
  assert.match(parseOutgoing("send\nbad id!\nhi").error, /session id/);
  assert.match(parseOutgoing("send\nabcd\n   ").error, /empty/);
  assert.match(parseOutgoing(`send\nabcd\n${"x".repeat(5000)}`).error, /too long/);
});

test("shellPath quotes only when it has to", () => {
  assert.equal(shellPath("/tmp/a/vibecodes-msg"), "/tmp/a/vibecodes-msg");
  assert.equal(shellPath("/Users/a b/it's"), `'/Users/a b/it'\\''s'`);
});

test("the launch note says messages are not from the person, and points Claude at SendMessage", () => {
  const codex = agentInstructions("/x/vibecodes-msg", "codex");
  assert.match(codex, /\/x\/vibecodes-msg list/);
  assert.match(codex, /not from the person you work for/);
  assert.doesNotMatch(codex, /SendMessage/);
  assert.match(agentInstructions("/x/vibecodes-msg", "claude"), /SendMessage/);
});

function run(script, args, input) {
  return new Promise((resolve) => {
    const child = execFile("/bin/sh", [script, ...args], (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vc-mail-test-"));
}

test("end to end: the command drops a request, the app answers, the command prints it", async () => {
  const sent = [];
  let box;
  box = createMailbox({
    tmpRoot: tmpRoot(),
    pollMs: 20,
    send: (m) => {
      sent.push(m);
      setTimeout(() => box.handleResult({ reqId: m.reqId, status: "ok", body: "Delivered: it was typed in." }), 10);
      return true;
    },
  });
  try {
    assert.equal(fs.statSync(box.dir).mode & 0o777, 0o700);
    const r = await run(box.scriptPath, ["send", "c1aude22", "hello", "there"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "Delivered: it was typed in.\n");
    assert.equal(sent[0].type, "peer-request");
    assert.equal(sent[0].cmd, "send");
    assert.equal(sent[0].to, "c1aude22");
    assert.equal(sent[0].text, "hello there");
    assert.match(sent[0].reqId, /^[0-9]+-[0-9]+-[0-9a-f]+$/);
    assert.deepEqual(fs.readdirSync(path.join(box.dir, "in")), []);

    const piped = await run(box.scriptPath, ["send", "c1aude22"], "from stdin");
    assert.equal(piped.code, 0);
    assert.equal(sent[1].text, "from stdin");
  } finally {
    box.close();
  }
  assert.equal(fs.existsSync(box.dir), false);
});

test("an error answer makes the command fail", async () => {
  let box;
  box = createMailbox({
    tmpRoot: tmpRoot(),
    pollMs: 20,
    send: (m) => {
      setTimeout(() => box.handleResult({ reqId: m.reqId, status: "error", body: "Not sent: nope." }), 5);
      return true;
    },
  });
  try {
    const r = await run(box.scriptPath, ["list"]);
    assert.equal(r.code, 1);
    assert.equal(r.stdout, "Not sent: nope.\n");
  } finally {
    box.close();
  }
});

test("bad requests and an unavailable app are answered without reaching the app", async () => {
  const sent = [];
  const box = createMailbox({ tmpRoot: tmpRoot(), pollMs: 20, send: (m) => (sent.push(m), false) });
  try {
    const empty = await run(box.scriptPath, ["send", "c1aude22", "   "]);
    assert.equal(empty.code, 1);
    assert.match(empty.stdout, /empty/);
    assert.equal(sent.length, 0);
    const down = await run(box.scriptPath, ["list"]);
    assert.equal(down.code, 1);
    assert.match(down.stdout, /isn't available/);
    const usage = await run(box.scriptPath, ["wat"]);
    assert.equal(usage.code, 2);
  } finally {
    box.close();
  }
});

test("no answer from the app: the request times out with an error", async () => {
  const box = createMailbox({ tmpRoot: tmpRoot(), pollMs: 20, answerTimeoutMs: 50, send: () => true });
  try {
    const r = await run(box.scriptPath, ["list"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /didn't answer/);
  } finally {
    box.close();
  }
});

test("stray files and answers to unknown requests are ignored", () => {
  const sent = [];
  const box = createMailbox({ tmpRoot: tmpRoot(), pollMs: 10_000, send: (m) => (sent.push(m), true) });
  try {
    fs.writeFileSync(path.join(box.dir, "out", "not-a-request"), "list\n\n");
    fs.writeFileSync(path.join(box.dir, "out", ".1-2-ab"), "list\n\n");
    box.poll();
    assert.equal(sent.length, 0);
    box.handleResult({ reqId: "1-2-ab", status: "ok", body: "x" });
    assert.deepEqual(fs.readdirSync(path.join(box.dir, "in")), []);
  } finally {
    box.close();
  }
});
