// A resume launch starts nothing until the relay accepts its token
// (card 9efc01c3, stage 2 point B).
//
//   A fresh launch already waits for the relay's `attached` frame before it
//   starts the agent. A resume (`--continue` / `--resume <id>`) used to start
//   it as soon as the agents fetch finished, before the relay had checked the
//   token, so a link with a bad token still ran `claude --continue` on the Mac
//   for a moment. Now a resume waits for the same `attached` frame.
//
// The REAL bridge against the Node stand-in relay, with a fake `claude` on
// PATH that only writes a marker file when it is started.
//
// Run: cd terminal/test && node --test resume-auth-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens } from "../shared/session-token.mjs";
import { buildLaunchDeepLink } from "../shared/deep-link.mjs";

import { writeFakeAgent } from "./fake-agent.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const SECRET = "resume-auth-gate-test-secret";
const RESUME_ID = "11111111-2222-3333-4444-555555555555";

/** A fake `claude`/`codex` that records that it was started, then idles. */
function makeMarkerBin(marker) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-rag-bin-"));
  for (const name of ["claude", "codex"]) {
    // `--version` is the bridge's own install/version probe, not a start.
    const script = path.join(dir, `${name}-started.mjs`);
    fs.writeFileSync(
      script,
      `import fs from "node:fs";\nfs.appendFileSync(${JSON.stringify(marker)}, "started\\n");\nsetTimeout(() => {}, 30000);\n`,
    );
    writeFakeAgent(dir, name, script, { version: "2.1.300 (Claude Code)" });
  }
  return dir;
}

async function runResume(t, { tokenSecret, linkParams }) {
  const session = `rag-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-RAG";
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vc-rag-")));
  const marker = path.join(work, "started.txt");
  const cwd = path.join(work, "project");
  fs.mkdirSync(cwd);
  const bin = makeMarkerBin(marker);
  const relay = await startStandinRelay({ port: 0, secret: SECRET });
  let bridge, browser;
  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    await relay.close();
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  // The browser leg uses a genuine token, so a genuine bridge has a peer.
  const good = await mintSessionTokens({ sub: owner, idea: "idea-RAG", sid: session, secret: SECRET });
  const bridgeToken = tokenSecret === SECRET
    ? good.bridge
    : (await mintSessionTokens({ sub: owner, idea: "idea-RAG", sid: session, secret: tokenSecret })).bridge;
  browser = new WebSocket(`${relay.url}/?session=${session}&role=browser&token=${encodeURIComponent(good.browser)}`);
  await once(browser, "open");

  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: bridgeToken, cwd, ...linkParams });
  bridge = spawn(process.execPath, [BRIDGE_ENTRY, "--launch-url", launchUrl], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      SHELL: "/usr/bin/false",
      TMPDIR: work,
      BRIDGE_MAX_SECONDS: "60",
      TERMINAL_APP_URL: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  // The bridge's own log (stderr, token-redacted). A killed-at-once child may
  // never get to write its marker, so "spawning PTY" is the reliable witness.
  let log = "";
  bridge.stderr.setEncoding("utf8");
  bridge.stderr.on("data", (d) => (log += d));
  return { bridge, marker, getLog: () => log };
}

const started = (marker) => fs.existsSync(marker);
async function waitFor(pred, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return pred();
}

for (const [label, linkParams] of [
  ["--continue", { resume: true }],
  ["--resume <id>", { resumeId: RESUME_ID }],
]) {
  test(`a ${label} resume with a token the relay rejects starts nothing`, { timeout: 30000 }, async (t) => {
    const { bridge, marker, getLog } = await runResume(t, { tokenSecret: "not-the-relay-secret", linkParams });
    const [code] = await once(bridge, "exit");
    assert.notEqual(code, null);
    assert.match(getLog(), /"code":4006/, "the relay rejected the token");
    assert.doesNotMatch(getLog(), /spawning PTY/, "no agent process may be spawned for a rejected token");
    // Give a stray child a moment to write its marker, if one was started.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(started(marker), false, "the agent must not start before the relay accepts the token");
  });

  test(`a ${label} resume with a genuine token still starts the agent`, { timeout: 30000 }, async (t) => {
    const { marker } = await runResume(t, { tokenSecret: SECRET, linkParams });
    assert.ok(await waitFor(() => started(marker), 15000), "the resumed agent started");
  });
}
