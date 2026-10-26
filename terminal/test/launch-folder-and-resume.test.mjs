// Stage 15 of the token review (card 5e654dd1), real-process proof:
//
//   A — after the helper saved the folder itself, the start-up message has no
//       "record_project_path" step (and the numbering has no gap). When the
//       save fails, the message is unchanged (the agent's own step is the backup).
//   B — Resume by conversation id with NO recorded folder: the helper finds the
//       conversation in Claude's transcript store and runs `claude --resume <id>`
//       in the folder it actually ran in; a worktree conversation resumes in the
//       worktree but the page is told the MAIN checkout.
//   C — no transcript on this Mac: a fresh session starts and the terminal says
//       so (never silent).
//
// A temp HOME stands in for the Mac; a fake `claude` prints its argv and folder.
// Run: cd terminal/test && VIBECODES_PACKAGED= node --test launch-folder-and-resume.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { buildLaunchDeepLink } from "../shared/deep-link.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SECRET = "launch-folder-resume-test-secret";
const CONV = "0b1bc584-1111-4222-8333-444444444444";
const RECORD_LINE =
  "2. Re-confirm the folder (never `/` or home — cd in first): call record_project_path (idea_id X, machine `hostname`, `pwd`) so future launches reopen here.";
const PROMPT = ["Set up VibeCodes and pick up board work.", "", "1. Connect the board tools.", RECORD_LINE, "3. Find work, but ASK first."].join("\n");

function tmpDir(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Stand-in app: workspace route (a repo-less board with one saved folder) + a folder route that answers as told. */
async function startFakeApp({ folder, folderReply }) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ url: req.url, body: JSON.parse(body || "{}") });
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/terminal/session/workspace") {
        res.end(JSON.stringify({ workspace: { repo: null, repoFolderName: null, newFolderName: "board", savedFolders: [folder], otherLiveSessionsOnThisMac: 0 } }));
      } else if (req.url === "/api/terminal/session/folder") {
        res.statusCode = folderReply.status;
        res.end(JSON.stringify(folderReply.body));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ delivered: false }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

function waitForText(getBuf, text, ms) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (getBuf().includes(text)) { clearInterval(iv); resolve(); }
      else if (Date.now() - started > ms) { clearInterval(iv); reject(new Error(`timed out waiting for ${text}`)); }
    }, 25);
  });
}

async function launch(t, { home, appUrl, link }) {
  const fakeBin = tmpDir(t, "vc-lfr-bin-");
  const shim = path.join(fakeBin, "shim.mjs");
  fs.writeFileSync(shim, `process.stdout.write("RUN_BEGIN"+JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd()})+"RUN_END\\n");process.stdin.resume();\n`);
  for (const name of ["claude", "codex"]) {
    fs.writeFileSync(path.join(fakeBin, name), `#!/bin/sh\nexec "${process.execPath}" "${shim}" "$@"\n`, { mode: 0o755 });
  }
  const session = `lfr-${Math.random().toString(36).slice(2, 8)}`;
  const tokens = await mintSessionTokens({ sub: "user-LFR", idea: "idea-LFR", sid: session, secret: SECRET });
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  let buf = "";
  const textFrames = [];
  const browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(tokens.browser)}`);
  browser.on("message", (d, isBinary) => {
    const s = Buffer.isBuffer(d) ? d.toString("utf8") : String(d);
    if (!isBinary) textFrames.push(s);
    buf += s;
  });
  await once(browser, "open");
  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, ...link });
  let stderr = "";
  const bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--launch-url", launchUrl], {
    cwd: home,
    env: { PATH: `${fakeBin}:${process.env.PATH}`, HOME: home, SHELL: "/usr/bin/false", BRIDGE_MAX_SECONDS: "60", TERMINAL_APP_URL: appUrl },
    stdio: ["ignore", "ignore", "pipe"],
  });
  bridge.stderr.setEncoding("utf8");
  bridge.stderr.on("data", (d) => (stderr += d));
  t.after(async () => {
    try { browser.terminate(); } catch { /* ignore */ }
    if (bridge.exitCode === null) bridge.kill("SIGKILL");
    await relay.close();
  });
  await waitForText(() => buf, "RUN_END", 30000).catch((e) => { throw new Error(`${e.message}\nbridge log:\n${stderr}\nbuf:\n${buf}`); });
  const run = JSON.parse(buf.match(/RUN_BEGIN(.*?)RUN_END/s)[1]);
  return { ...run, buf, textFrames, stderr };
}

const promptOf = (argv) => argv.find((a) => a.includes("Find work")) ?? "";

test("A1: the helper saved the folder → no record_project_path step, numbering has no gap", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const folder = path.join(home, "projects", "board");
  fs.mkdirSync(folder, { recursive: true });
  const app = await startFakeApp({ folder, folderReply: { status: 200, body: { ok: true, path: folder } } });
  t.after(app.close);
  const r = await launch(t, { home, appUrl: app.url, link: { cwd: folder, prompt: PROMPT } });
  const p = promptOf(r.argv);
  assert.ok(p.includes("Find work"), JSON.stringify(r.argv));
  assert.ok(!p.includes("record_project_path"), p);
  assert.ok(p.includes("2. Find work, but ASK first."), p);
  assert.ok(p.includes("1. Connect the board tools."), p);
});

test("A2: the save fails (500) → the start-up message is unchanged", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const folder = path.join(home, "projects", "board");
  fs.mkdirSync(folder, { recursive: true });
  const app = await startFakeApp({ folder, folderReply: { status: 500, body: { ok: false } } });
  t.after(app.close);
  const r = await launch(t, { home, appUrl: app.url, link: { cwd: folder, prompt: PROMPT } });
  assert.ok(promptOf(r.argv).includes(RECORD_LINE), promptOf(r.argv));
});

test("A3: a 200 reply without ok:true does not count as saved", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const folder = path.join(home, "projects", "board");
  fs.mkdirSync(folder, { recursive: true });
  const app = await startFakeApp({ folder, folderReply: { status: 200, body: { ok: false } } });
  t.after(app.close);
  const r = await launch(t, { home, appUrl: app.url, link: { cwd: folder, prompt: PROMPT } });
  assert.ok(promptOf(r.argv).includes(RECORD_LINE), promptOf(r.argv));
});

function writeTranscript(home, key, id, cwd) {
  const dir = path.join(home, ".claude", "projects", key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${JSON.stringify({ type: "summary" })}\n${JSON.stringify({ type: "user", cwd })}\n`);
}

test("B1: resume by id, no recorded folder → found in Claude's transcript store, resumed in that folder", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const folder = path.join(home, "projects", "board");
  fs.mkdirSync(folder, { recursive: true });
  writeTranscript(home, "-k", CONV, folder);
  const app = await startFakeApp({ folder, folderReply: { status: 200, body: { ok: true } } });
  t.after(app.close);
  const r = await launch(t, { home, appUrl: app.url, link: { resumeId: CONV } });
  assert.deepEqual(r.argv.slice(0, 2), ["--resume", CONV], JSON.stringify(r.argv));
  assert.equal(r.cwd, folder);
  assert.ok(!r.buf.includes("fresh"), "no 'fresh session' line when the conversation is found");
});

test("B2: the conversation ran in a worktree → resumed there, and nothing is recorded as the project folder", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const main = path.join(home, "projects", "board");
  const wt = path.join(main, ".claude", "worktrees", "abc123");
  fs.mkdirSync(wt, { recursive: true });
  writeTranscript(home, "-wt", CONV, wt);
  const app = await startFakeApp({ folder: main, folderReply: { status: 200, body: { ok: true } } });
  t.after(app.close);
  const r = await launch(t, { home, appUrl: app.url, link: { resumeId: CONV } });
  assert.deepEqual(r.argv.slice(0, 2), ["--resume", CONV]);
  assert.equal(r.cwd, wt);
  assert.ok(!app.calls.some((c) => c.url === "/api/terminal/session/folder"), "a resume never records a project folder");
});

test("B3: the page is told the main checkout of a worktree conversation", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const main = path.join(home, "projects", "board");
  const wt = path.join(main, ".claude", "worktrees", "abc123");
  fs.mkdirSync(wt, { recursive: true });
  writeTranscript(home, "-wt", CONV, wt);
  const app = await startFakeApp({ folder: main, folderReply: { status: 200, body: { ok: true } } });
  t.after(app.close);
  const frames = [];
  const r = await launch(t, { home, appUrl: app.url, link: { resumeId: CONV } });
  frames.push(...r.textFrames);
  // the frame is sent on the relay's attach confirmation; give it a moment
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !frames.some((f) => f.includes("bridge-cwd"))) {
    await new Promise((res) => setTimeout(res, 50));
    frames.length = 0;
    frames.push(...r.textFrames);
  }
  assert.ok(frames.some((f) => f === JSON.stringify({ t: "bridge-cwd", cwd: main })), JSON.stringify(frames));
});

test("C: resume by id but no transcript on this Mac → a fresh session starts AND the terminal says so", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const folder = path.join(home, "projects", "board");
  fs.mkdirSync(folder, { recursive: true });
  const app = await startFakeApp({ folder, folderReply: { status: 200, body: { ok: true } } });
  t.after(app.close);
  const r = await launch(t, { home, appUrl: app.url, link: { resumeId: CONV } });
  assert.ok(!r.argv.includes("--resume"), JSON.stringify(r.argv));
  assert.equal(r.cwd, folder);
  assert.match(r.buf, /Couldn't find your earlier conversation on this Mac, so this is a fresh Claude Code session\./);
});

// AC3.5 — a resume never carries a start-up prompt, even when the link has one.
const SECRET_PROMPT = "NEVER-TYPE-THIS-PROMPT-ON-A-RESUME";
const anyArgvHasPrompt = (argv) => argv.some((a) => a.includes(SECRET_PROMPT));

async function resumeSetup(t) {
  const home = tmpDir(t, "vc-lfr-home-");
  const folder = path.join(home, "projects", "board");
  fs.mkdirSync(folder, { recursive: true });
  writeTranscript(home, "-k", CONV, folder);
  const app = await startFakeApp({ folder, folderReply: { status: 200, body: { ok: true } } });
  t.after(app.close);
  return { home, folder, app };
}

test("AC3.5a: Claude resume_id plus prompt= -> exactly the resume arguments, no prompt", { timeout: 60000 }, async (t) => {
  const { home, folder, app } = await resumeSetup(t);
  const r = await launch(t, { home, appUrl: app.url, link: { cwd: folder, resumeId: CONV, prompt: SECRET_PROMPT } });
  assert.deepEqual(r.argv.slice(0, 2), ["--resume", CONV], JSON.stringify(r.argv));
  assert.ok(!anyArgvHasPrompt(r.argv), JSON.stringify(r.argv));
});

test("AC3.5b: Claude resume=1 plus prompt= -> --continue, no prompt", { timeout: 60000 }, async (t) => {
  const { home, folder, app } = await resumeSetup(t);
  const r = await launch(t, { home, appUrl: app.url, link: { cwd: folder, resume: true, prompt: SECRET_PROMPT } });
  assert.equal(r.argv[0], "--continue", JSON.stringify(r.argv));
  assert.ok(!anyArgvHasPrompt(r.argv), JSON.stringify(r.argv));
});

test("AC3.5c: Codex resume plus prompt= -> resume arguments, no prompt", { timeout: 60000 }, async (t) => {
  const { home, folder, app } = await resumeSetup(t);
  const r = await launch(t, { home, appUrl: app.url, link: { cwd: folder, agent: "codex", resume: true, prompt: SECRET_PROMPT } });
  assert.equal(r.argv[0], "resume", JSON.stringify(r.argv));
  assert.ok(!anyArgvHasPrompt(r.argv), JSON.stringify(r.argv));
});

test("AC3.5d: no transcript found, start fresh instead -> no start-up prompt either", { timeout: 60000 }, async (t) => {
  const home = tmpDir(t, "vc-lfr-home-");
  const folder = path.join(home, "projects", "board");
  fs.mkdirSync(folder, { recursive: true });
  const app = await startFakeApp({ folder, folderReply: { status: 200, body: { ok: true } } });
  t.after(app.close);
  const r = await launch(t, { home, appUrl: app.url, link: { resumeId: CONV, prompt: SECRET_PROMPT } });
  assert.ok(!r.argv.includes("--resume"), JSON.stringify(r.argv));
  assert.ok(!anyArgvHasPrompt(r.argv), JSON.stringify(r.argv));
  assert.match(r.buf, /fresh Claude Code session/);
});
