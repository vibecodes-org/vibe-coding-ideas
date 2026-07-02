// Bootstrap-prompt launch — bridge-side proof of the two hard rules
// (docs/terminal-bootstrap-prompt-ux.html; Requirements R1/R2):
//
//   AC4 — NO PRE-AUTH EXECUTION: a prompt-carrying launch spawns NOTHING until
//         the relay confirms the owner-bound token with the `attached` control
//         frame. Rejected (expired / foreign-owner) tokens and an OLD relay that
//         never sends the frame ⇒ the bridge exits with ZERO child processes and
//         zero prompt bytes delivered anywhere.
//   AC5 — ARGV SAFETY: the URL-carried prompt reaches the spawned command as
//         exactly ONE argv element, verbatim — never through shellSplit or a
//         shell — proven with a hostile-characters fixture.
//   AC8 — promptless launches keep TODAY'S behaviour exactly (PTY spawns first,
//         before the relay connect).
//
// Uses the Node stand-in relay (same pairing/owner logic + the same R1 attached
// frame as the Cloudflare DO; `sendAttachedFrame:false` simulates an OLD relay).
//
// Run: cd terminal/test && node --test   (or: node prompt-launch.test.mjs)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { startStandinRelay } from "./standin-relay.mjs";
import { mintSessionTokens, signToken } from "../shared/session-token.mjs";
import { buildLaunchDeepLink } from "../shared/deep-link.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_ENTRY = path.resolve(__dirname, "../bridge/src/index.js");
const ARGV_CMD = path.resolve(__dirname, "./argv-cmd.mjs");
const SENTINEL = path.resolve(__dirname, "./sentinel-cmd.mjs");
const HARD_TIMEOUT_MS = 20000;
const SECRET = "prompt-launch-test-secret";

// Hostile prompt: command substitution, quotes, pipes, redirects, newline,
// variable expansion. If ANY of this were interpreted (shell, shellSplit, PTY
// line discipline aside) the argv round-trip below would not match verbatim.
const HOSTILE_PROMPT =
  "Set up $(rm -rf ~) `hostname` \"double\" 'single' ; & | > < \\ %20 + \n work task_id abc; echo $HOME";

/** Spawn the bridge with piped stderr; resolves helpers for logs + exit. */
function spawnBridge(argv, env = {}) {
  const child = spawn(process.execPath, [BRIDGE_ENTRY, ...argv], {
    env: { PATH: process.env.PATH, BRIDGE_MAX_SECONDS: "60", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => {
    stderr += d;
    process.stderr.write(d);
  });
  return { child, getStderr: () => stderr };
}

function waitForText(getBuf, text, ms, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      if (getBuf().includes(text)) {
        clearInterval(iv);
        resolve(Date.now() - started);
      } else if (Date.now() - started > ms) {
        clearInterval(iv);
        reject(new Error(`timed out after ${ms}ms waiting for ${label}: ${JSON.stringify(text)}`));
      }
    }, 25);
  });
}

async function waitForExit(child, ms, label) {
  const [code, signal] = await Promise.race([
    once(child, "exit"),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} exit timeout`)), ms)),
  ]);
  return { code, signal };
}

async function connectBrowserLeg(relayUrl, session, browserToken) {
  let buf = "";
  const ws = new WebSocket(
    `${relayUrl}/?session=${session}&role=browser&token=${encodeURIComponent(browserToken)}`,
  );
  ws.on("message", (data) => {
    buf += Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  });
  await Promise.race([
    once(ws, "open"),
    new Promise((_, rej) => setTimeout(() => rej(new Error("browser ws open timeout")), 5000)),
  ]);
  return { ws, getBuf: () => buf };
}

// ── AC5 + R1 happy path: verbatim single-argv prompt, spawned only post-attach ─
test("prompt launch: spawn is deferred until the relay's attach confirmation, and the prompt arrives as ONE verbatim argv element", { timeout: 60000 }, async (t) => {
  const session = `pl-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-P-" + Math.random().toString(36).slice(2, 8);
  let relay;
  let bridge;
  let browser;

  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
  });

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-P", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });

  const launchUrl = buildLaunchDeepLink({
    relay: relay.url,
    session,
    token: tokens.bridge,
    prompt: HOSTILE_PROMPT,
  });

  const leg = await connectBrowserLeg(relay.url, session, tokens.browser);
  browser = leg.ws;

  const spawned = spawnBridge([
    "--launch-url", launchUrl,
    "--cmd", `${process.execPath} ${ARGV_CMD}`,
  ]);
  bridge = spawned.child;

  // The spawned command echoes its argv between markers — extract + compare.
  await waitForText(leg.getBuf, "ARGV_END", HARD_TIMEOUT_MS, "argv marker");
  const m = leg.getBuf().match(/ARGV_BEGIN(.*?)ARGV_END/s);
  assert.ok(m, "argv markers present in the PTY stream");
  const argv = JSON.parse(m[1]);
  assert.deepEqual(argv, [HOSTILE_PROMPT], "prompt must be exactly ONE argv element, verbatim (AC5)");

  // R1 ordering: the bridge connected + received the attach confirmation BEFORE
  // it spawned the PTY (promptless launches spawn first — see the AC8 test).
  const logs = spawned.getStderr();
  const iConfirmed = logs.indexOf("relay confirmed attach");
  const iSpawn = logs.indexOf("spawning PTY");
  assert.ok(iConfirmed !== -1, "bridge logged the attach confirmation");
  assert.ok(iSpawn !== -1, "bridge spawned the PTY");
  assert.ok(iConfirmed < iSpawn, "spawn must happen strictly AFTER the attach confirmation (R1)");

  // Log hygiene: the prompt (user content) never appears in bridge logs — only
  // its length does (the launch URL is logged redacted).
  assert.ok(!logs.includes("rm -rf"), "prompt content must not leak into bridge logs");
  assert.ok(logs.includes("promptChars"), "spawn log carries only the prompt length");
  console.log("[test/pl] PASS — deferred spawn + verbatim single-argv prompt");
});

// ── AC4: rejected tokens ⇒ ZERO spawn ──────────────────────────────────────────
test("prompt launch with an expired or foreign-owner token spawns NOTHING", { timeout: 60000 }, async (t) => {
  const session = `pl4-${Math.random().toString(36).slice(2, 8)}`;
  const ownerA = "user-A-" + Math.random().toString(36).slice(2, 8);
  const ownerB = "user-B-" + Math.random().toString(36).slice(2, 8);
  let relay;
  let browser;
  const bridges = [];

  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    for (const b of bridges) if (b.exitCode === null) b.kill("SIGKILL");
    if (relay) await relay.close();
  });

  const tokensA = await mintSessionTokens({ sub: ownerA, idea: "idea-P", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });

  // Bind the session to owner A (the legitimate browser leg).
  const leg = await connectBrowserLeg(relay.url, session, tokensA.browser);
  browser = leg.ws;

  /** Fire a prompt-carrying bridge with `token` and assert zero execution. */
  async function expectNoSpawn(token, label) {
    const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token, prompt: HOSTILE_PROMPT });
    // NOTE: --cmd swallows the rest of argv, so every other flag comes first.
    const spawned = spawnBridge([
      "--launch-url", launchUrl,
      "--attach-confirm-timeout-ms", "1500",
      "--cmd", `${process.execPath} ${ARGV_CMD}`,
    ]);
    bridges.push(spawned.child);
    const { code } = await waitForExit(spawned.child, HARD_TIMEOUT_MS, label);
    const logs = spawned.getStderr();
    assert.ok(!logs.includes("spawning PTY"), `${label}: no PTY spawn may be attempted`);
    assert.ok(!leg.getBuf().includes("ARGV_BEGIN"), `${label}: no prompt bytes may reach any child`);
    assert.equal(code, 1, `${label}: a blocked prompt launch exits non-zero`);
    console.log(`[test/pl4] PASS — ${label}: zero execution`);
  }

  // (a) expired token — fails authorizeAttach (relay close 4006).
  const past = Math.floor(Date.now() / 1000) - 3600;
  const expired = await signToken(
    { sub: ownerA, sid: session, idea: "idea-P", role: "bridge", iat: past, exp: past + 60 },
    SECRET,
  );
  await expectNoSpawn(expired, "expired token");

  // (b) foreign-owner token — valid signature, wrong owner (relay close 4005).
  const tokensB = await mintSessionTokens({ sub: ownerB, idea: "idea-P", sid: session, secret: SECRET });
  await expectNoSpawn(tokensB.bridge, "foreign-owner token");
});

// ── version skew: OLD relay (no attached frame) ⇒ clean exit, zero spawn ───────
test("prompt launch against a relay that never confirms the attach exits WITHOUT spawning", { timeout: 60000 }, async (t) => {
  const session = `pls-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-S-" + Math.random().toString(36).slice(2, 8);
  let relay;
  let bridge;
  let browser;

  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
  });

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-P", sid: session, secret: SECRET });
  // sendAttachedFrame:false = an OLD relay that accepts the leg but predates R1.
  relay = await startStandinRelay({ port: 0, secret: SECRET, sendAttachedFrame: false });

  const leg = await connectBrowserLeg(relay.url, session, tokens.browser);
  browser = leg.ws;

  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge, prompt: HOSTILE_PROMPT });
  // NOTE: --cmd swallows the rest of argv, so every other flag comes first.
  const spawned = spawnBridge([
    "--launch-url", launchUrl,
    "--attach-confirm-timeout-ms", "800",
    "--cmd", `${process.execPath} ${ARGV_CMD}`,
  ]);
  bridge = spawned.child;

  const { code } = await waitForExit(spawned.child, HARD_TIMEOUT_MS, "old-relay bridge");
  const logs = spawned.getStderr();
  assert.ok(logs.includes("no attach confirmation"), "bridge explains the skew timeout");
  assert.ok(!logs.includes("spawning PTY"), "no PTY spawn on an unconfirmed attach");
  assert.ok(!leg.getBuf().includes("ARGV_BEGIN"), "no prompt bytes reached any child");
  assert.equal(code, 1, "unconfirmed prompt launch exits non-zero");
  console.log("[test/pls] PASS — old relay ⇒ graceful no-spawn exit");
});

// ── AC8: promptless launches keep TODAY'S spawn-first behaviour exactly ────────
test("promptless --launch-url spawns the PTY FIRST (before the relay connect), as today", { timeout: 60000 }, async (t) => {
  const session = `pl8-${Math.random().toString(36).slice(2, 8)}`;
  const owner = "user-8-" + Math.random().toString(36).slice(2, 8);
  let relay;
  let bridge;
  let browser;

  t.after(async () => {
    try { browser?.terminate(); } catch { /* ignore */ }
    if (bridge && bridge.exitCode === null) bridge.kill("SIGKILL");
    if (relay) await relay.close();
  });

  const tokens = await mintSessionTokens({ sub: owner, idea: "idea-P", sid: session, secret: SECRET });
  relay = await startStandinRelay({ port: 0, secret: SECRET });

  const leg = await connectBrowserLeg(relay.url, session, tokens.browser);
  browser = leg.ws;

  const launchUrl = buildLaunchDeepLink({ relay: relay.url, session, token: tokens.bridge });
  const spawned = spawnBridge([
    "--launch-url", launchUrl,
    "--cmd", `${process.execPath} ${SENTINEL}`,
  ]);
  bridge = spawned.child;

  await waitForText(leg.getBuf, "READY", HARD_TIMEOUT_MS, "sentinel via relay");
  const logs = spawned.getStderr();
  const iSpawn = logs.indexOf("spawning PTY");
  const iConnect = logs.indexOf("connecting to relay");
  assert.ok(iSpawn !== -1 && iConnect !== -1, "both lifecycle logs present");
  assert.ok(iSpawn < iConnect, "promptless spawn happens BEFORE the relay connect — unchanged (AC8)");
  console.log("[test/pl8] PASS — promptless behaviour byte-for-byte as before");
});
