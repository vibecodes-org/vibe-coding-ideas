#!/usr/bin/env node
// VibeCodes Terminal Bridge — SLICE 1
//
// Runs a command in a node-pty pseudo-terminal on the local machine and pipes it,
// opaquely, over an OUTBOUND WebSocket to the relay. The relay pairs this
// `bridge` leg with a `browser` leg and forwards bytes both ways.
//
//   PTY stdout  --(binary frame)-->  ws  -->  relay  -->  browser
//   browser     --(binary frame)-->  relay  -->  ws  -->  PTY stdin
//   browser     --(text/JSON resize)->  relay -->  ws  -->  pty.resize()
//
// SLICE-1 SCOPE: prove the byte round-trip. Auth/ownership, the signed
// vibecodes:// deep link, the in-app panel, lifecycle limits and signing are
// later slices (see RUN.md / design doc).
//
// Usage:
//   node src/index.js --relay ws://localhost:8787 --session abc123 --cmd "bash"
//
// Flags (env fallback in brackets):
//   --relay   <ws-url>   relay base URL                 [RELAY_URL]   default ws://localhost:8787
//   --session <id>       session id to pair on          [SESSION_ID]  default random
//   --token   <jwt>      app-minted bridge-role token    [BRIDGE_TOKEN] (required by the relay)
//   --cmd     <command>  command to run in the PTY       [BRIDGE_CMD]  default "claude"
//                        (everything after --cmd, or the env string, is shell-split)
//   --cwd     <dir>      working directory               [BRIDGE_CWD]  default process.cwd()
//   --launch-url <url>   a `vibecodes://launch?…` deep link [BRIDGE_LAUNCH_URL]
//                        Parsed for relay/session/token/cwd — exactly what a packaged
//                        helper's URL-scheme handler hands us (slice 7). It takes
//                        precedence over the individual --relay/--session/--token/--cwd
//                        flags. `--launch-url` MUST come before `--cmd` (which swallows
//                        the rest of argv). Default spawned command stays "claude".
//   --max-seconds <n>    hard self-kill safety cap       [BRIDGE_MAX_SECONDS] default 90000 (25h —
//                        the relay's 24h backstop plus a 1h margin so the bridge never self-kills
//                        before the relay ends the session first)
//   --connect-timeout-ms <n>  fail if relay not open in time  [default 30000]

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import WebSocket from "ws";
import { parseControlMessage } from "./framing.js";
import { createOutputBatcher } from "./output-batcher.js";
import { resolveClaudeLaunch } from "./resume-cmd.js";
import { resolveSpawnDims } from "./spawn-dims.js";
import {
  sanitizeHelperVersion,
  sanitizeMachineLabel,
  sanitizeConversationId,
} from "../../shared/control-frames.mjs";
import { parseLaunchDeepLink, redactDeepLinkToken } from "../../shared/deep-link.mjs";
import { isRelayHostAllowed } from "../../shared/relay-allowlist.mjs";
import {
  isAttachedFrame,
  isPeerDegradedFrame,
  isPeerReattachedFrame,
} from "../../shared/control-frames.mjs";
import { reapPidGroupEscalated } from "../../shared/reap.mjs";
import { FrameEncryptor, FrameDecryptor, PtyCryptoError } from "../../shared/pty-crypto.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── logging (metadata only — NEVER log stream content) ────────────────────────
const t0 = Date.now();
function log(level, msg, extra) {
  const rec = { t: ((Date.now() - t0) / 1000).toFixed(2) + "s", level, comp: "bridge", msg, ...extra };
  process.stderr.write(JSON.stringify(rec) + "\n");
}

// ── arg parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cmd") {
      // everything after --cmd is the command + its args
      out.cmd = argv.slice(i + 1).join(" ");
      break;
    } else if (a.startsWith("--")) {
      out[a.slice(2)] = argv[++i];
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Minimal, dependency-free shell-ish splitter (handles "double" and 'single' quotes).
function shellSplit(s) {
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const parts = [];
  let m;
  while ((m = re.exec(s)) !== null) parts.push(m[1] ?? m[2] ?? m[3]);
  return parts;
}

const args = parseArgs(process.argv.slice(2));

// A `vibecodes://launch?…` deep link, when present, is the highest-precedence source
// of relay/session/token/cwd — this is the same string a packaged helper's URL-scheme
// handler will pass us (slice 7). Parse it ONCE; bail clearly if it's malformed.
const LAUNCH_URL = args["launch-url"] || process.env.BRIDGE_LAUNCH_URL || "";
let launched = null;
if (LAUNCH_URL) {
  launched = parseLaunchDeepLink(LAUNCH_URL);
  if (!launched) {
    log("error", "invalid --launch-url (not a vibecodes://launch link)", {
      url: redactDeepLinkToken(LAUNCH_URL),
    });
    process.exit(1);
  }
  // Log the parsed link WITHOUT the token (never log secrets).
  log("info", "using launch deep link", { url: redactDeepLinkToken(LAUNCH_URL) });
}

const RELAY = launched?.relay || args.relay || process.env.RELAY_URL || "ws://localhost:8787";

// ── relay-host ALLOWLIST (load-bearing security gate) ─────────────────────────
// `vibecodes://launch?relay=<HOST>` is fired by ANY web page, and `relay=` is the
// highest-precedence source of RELAY above. Before this gate the bridge dialled
// whatever host it named — an attacker relay then verifies its OWN token, passes
// the R1 `{"t":"attached"}` gate, and streams keystrokes into the spawned `claude`
// PTY (see the Reproduce & Investigate step). Pin the dial target HERE, before
// `new WebSocket()` and before ANY pty.spawn on every path (promptless spawn-first
// AND prompt-deferred). Loopback is allowed only when NOT packaged (dev/tests dial
// the Node stand-in on ws://127.0.0.1:<port>); the packaged helper sets
// VIBECODES_PACKAGED=1, so loopback + any non-prod host are rejected in production.
// On reject: log the HOST ONLY (never the token) and exit cleanly, zero spawn.
const ALLOW_LOOPBACK_RELAY = process.env.VIBECODES_PACKAGED !== "1";
if (!isRelayHostAllowed(RELAY, { allowLoopback: ALLOW_LOOPBACK_RELAY })) {
  let host = "unparseable";
  try { host = new URL(RELAY).host; } catch { /* never echo the raw url — may carry a token */ }
  log("error", "relay host not allowed", { host });
  process.exit(1);
}
const SESSION = launched?.session || args.session || process.env.SESSION_ID || `dev-${Math.random().toString(36).slice(2, 10)}`;
const TOKEN = launched?.token || args.token || process.env.BRIDGE_TOKEN || "";
// Session entry chooser — Resume (card cbe60db5, design item 7/F4), LEGACY
// path: a `resume=1` launch (no tracked conversation id) runs
// `claude --continue`, continuing whatever's most recent ON DISK in CWD —
// not necessarily the row the user clicked. See RESUME_ID below for the
// EXACT-CONVERSATION path (rework 5) every row minted after this feature
// carries instead.
const RESUME = !!launched?.resume;
// Exact-conversation Resume (rework 5, card cbe60db5 — Nick's field test: a
// Resume click landed on the wrong conversation because `--continue` doesn't
// know which row was clicked). A validated UUID from a `resume_id=` deep
// link (already UUID-checked by parseLaunchDeepLink; re-checked here as
// defense in depth — same posture as HOST/sanitizeMachineLabel above) names
// the SPECIFIC claude conversation to resume.
const RESUME_ID = sanitizeConversationId(launched?.resumeId);
// An explicit `--cmd`/`BRIDGE_CMD` override always wins (dev/test
// convenience) — see resolveClaudeLaunch's doc for the full launch-shape
// priority order and the empirical finding behind CONV.
const explicitCmd = args.cmd || process.env.BRIDGE_CMD || null;
// Task c4ca2d95 ("Terminal starting model"): the deep link's `model` param,
// already parse-time validated by the shared module's isSafeModelValue
// (whitespace/shell-metacharacter rejection — see deep-link.mjs). Only ever
// applied by resolveClaudeLaunch on a genuinely fresh session (branch 4) —
// resume/resumeId/explicitCmd never read it. `--model` on the bare CLI
// (BRIDGE_MODEL env, dev/test convenience) mirrors --cmd's own env fallback.
const MODEL = launched?.model || process.env.BRIDGE_MODEL || null;
// Task d3de150c ("Terminal mode" auto-accept toggle): the deep link's
// `permissionMode` param, already parse-time whitelisted by the shared
// module's isPermissionModeSafe (only the literal "auto" ever
// survives parsing — see deep-link.mjs). Only ever applied by
// resolveClaudeLaunch on a genuinely fresh session (branch 4) — resume/
// resumeId/explicitCmd never read it, same as MODEL above.
// `BRIDGE_PERMISSION_MODE` env mirrors BRIDGE_MODEL's own dev/test
// convenience fallback.
const PERMISSION_MODE = launched?.permissionMode || process.env.BRIDGE_PERMISSION_MODE || null;
// Concurrent-terminal isolation (QA-flagged fix): the deep link's `worktree`
// boolean (see shared/deep-link.mjs), set by the app whenever this launch
// needs isolation (existing-mode with a known/possibly-shared folder — see
// src/lib/launch-claude-code.ts's CompactPromptEssentials.isolate). Only ever
// applied by resolveClaudeLaunch on a genuinely fresh session (branch 4) —
// resume/resumeId/explicitCmd never read it, same as MODEL/PERMISSION_MODE
// above. `BRIDGE_WORKTREE` env mirrors their own dev/test convenience
// fallback.
const WORKTREE = !!(launched?.worktree ?? (process.env.BRIDGE_WORKTREE === "1"));
const { cmd: CMD, conv: CONV } = resolveClaudeLaunch({
  explicitCmd,
  resumeId: RESUME_ID,
  resume: RESUME,
  model: MODEL,
  permissionMode: PERMISSION_MODE,
  worktree: WORKTREE,
  mintId: () => crypto.randomUUID(),
});
const CWD = launched?.cwd || args.cwd || process.env.BRIDGE_CWD || process.cwd();
// The URL-carried bootstrap prompt (deep-link launches only). INERT DATA with two
// hard rules (see docs/terminal-bootstrap-prompt-ux.html + the shared deep-link
// module):
//   1. ARGV SAFETY — it becomes exactly ONE argv element appended after the
//      shell-split CMD (`claude "<prompt>"`), NEVER concatenated into CMD or
//      passed through shellSplit, so hostile characters arrive verbatim as data.
//   2. NO PRE-AUTH EXECUTION (R1) — a prompt-carrying launch defers pty.spawn
//      until the relay confirms the owner-bound token with the `attached`
//      control frame (accept-then-close rejections make ws.onopen meaningless
//      as an auth signal). No frame in time → exit WITHOUT spawning anything.
// A resume launch (legacy `--continue` OR exact-conversation `--resume`)
// never carries a prompt (nothing to bootstrap) — forced empty even if a
// caller somehow sent both, so the resumed command is never followed by a
// stray argv element.
const PROMPT = RESUME || RESUME_ID ? "" : launched?.prompt || "";
// Real PTY spawn size (Bug B, card cbe60db5) — see spawn-dims.js's header
// comment for why this can't just be a post-spawn resize for a promptless
// launch. Falls back to the historical 80x24 default when the link didn't
// carry a validated pair (an old app build, a bare CLI run, or a launch that
// raced the browser's own xterm mount).
const { cols: SPAWN_COLS, rows: SPAWN_ROWS } = resolveSpawnDims(launched);
// ── helper-version announcement (release-gate rework 2a) ─────────────────────
// Read the RUNNING helper's own version so the relay/dock can nudge stale
// installs to update. Priority: BRIDGE_HELPER_VERSION (set by the packaged
// Electron helper — terminal/helper/main.js — reading ITS OWN package.json,
// forked through as an env var; single source of truth per 2b) falling back to
// this bridge package's own package.json version for a standalone/dev CLI run
// (no helper wrapper in that path, so there's nothing else to report). Either
// way it's re-validated with the SAME strict x.y.z shape guard the relay/dock
// use, so a malformed value here never reaches the wire as `null` becomes "omit
// the param entirely" (an old-relay-safe no-op) rather than a garbage frame.
function resolveHelperVersion() {
  const fromEnv = sanitizeHelperVersion(process.env.BRIDGE_HELPER_VERSION);
  if (fromEnv) return fromEnv;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    return sanitizeHelperVersion(pkg.version);
  } catch {
    return null;
  }
}
const HELPER_VERSION = resolveHelperVersion();

// ── machine identity announcement (Nick's sign-off change 2) ─────────────────
// This machine's hostname, sanitized with the SAME rules the relay applies to
// `helperVersion` (bounded, defensive re-validation on every hop — see
// terminal/shared/control-frames.mjs's `sanitizeMachineLabel`). Sent alongside
// `helperVersion` on the SAME relay connect URL so the browser dock can learn
// (and remember) which physical machine a session ran on, and later hide
// Recent rows recorded on a DIFFERENT machine (chooser-data.ts). `null` for an
// unreadable/absurd hostname is an honest omission, never a crash — the relay
// simply has nothing to forward, identical to an old bridge that never sends
// this param at all.
const HOST = sanitizeMachineLabel(os.hostname());

// ── E2EE key delivery (Terminal P2, FR-1) ─────────────────────────────────────
// The bridge has no room in the launch deep link for a 256-bit key — that
// link's params are already within ~5 chars of their length cap for a
// realistic repo-backed launch (see CLAUDE.md's In-App Terminal section and
// deep-link.test.ts), and growing them is an explicit do-not-regress. So the
// bridge instead makes a DIRECT HTTPS call to the VibeCodes app itself (never
// through the relay) using the SAME bridge token it already holds — see
// src/app/api/terminal/session/key/route.ts. `TERMINAL_APP_URL` overrides
// the default for local/dev runs; production has exactly one app origin.
const APP_URL = (process.env.TERMINAL_APP_URL || "").trim() || "https://vibecodes.co.uk";
const E2EE_KEY_FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch this session's E2EE key from the app. Never throws — any failure
 * (network error, timeout, non-200, `delivered:false`) is treated exactly
 * like "this app/session doesn't support E2EE yet": the caller falls back to
 * a plaintext session (Phase A negotiation, FR-5), the same graceful-degrade
 * shape as a missing helperVersion/host/conv.
 * @returns {Promise<Buffer|null>}
 */
async function fetchE2eeSessionKey() {
  if (!TOKEN || !SESSION) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), E2EE_KEY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/terminal/session/key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sid: SESSION, token: TOKEN }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.delivered || typeof body.sessionKey !== "string") return null;
    const key = Buffer.from(body.sessionKey, "base64");
    return key.length === 32 ? key : null;
  } catch (e) {
    log("warn", "e2ee key fetch failed — running this session unencrypted", { err: String(e?.message || e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const MAX_SECONDS = Number(args["max-seconds"] || process.env.BRIDGE_MAX_SECONDS || 90000);
const CONNECT_TIMEOUT_MS = Number(args["connect-timeout-ms"] || 30000);
// How long after the socket opens we wait for the relay's `attached` frame before
// giving up (prompt launches only). An OLD relay never sends it → clean exit, no
// spawn — the dock's existing ~8s fallback covers the UX.
const ATTACH_CONFIRM_TIMEOUT_MS = Number(args["attach-confirm-timeout-ms"] || 10000);

// ── verified-kill escalation bounds (the orphaned-`claude` fix) ────────────────
// node-pty's kill() is ONE unverified SIGHUP that `claude` can outlive — and the
// PTY child is its own session/group leader (spawn-helper setsid), so nothing
// implicit ever reaps it. Shutdown now VERIFIES death: SIGHUP → (2s) → SIGTERM →
// (1s) → SIGKILL(+process group), and never exits with the child unconfirmed
// unless the overall hard cap trips. See ../../shared/reap.mjs.
const KILL_HUP_WAIT_MS = 2000;
const KILL_TERM_WAIT_MS = 1000;
const SHUTDOWN_CAP_MS = 5000;

// ws keepalive: a dead relay link (sleep/network drop, no FIN) must not hold a
// session — and its PTY child — alive for hours. Client-side ping only; the ws
// server (and Cloudflare's edge) answers protocol pings automatically.
const PING_INTERVAL_MS = Number(process.env.BRIDGE_PING_INTERVAL_MS || 30000);
const PING_MAX_MISSED = 2;

// ── reconnect budget (fix/terminal-reconnect-reattach) ────────────────────────
// A TRANSIENT relay-link drop (sleep, Wi-Fi blip, missed pongs, a 1006 with no
// FIN) must NOT reap a live `claude`. While the PTY child is alive AND within this
// budget the bridge RECONNECTS to the SAME session (same relay URL + sid + the
// still-valid bridge token) with jittered backoff (1s→2s→4s→8s cap), keeping claude
// running across the gap and resuming the byte pipe on re-attach. THE ONE SHARED
// NUMBER — equal to the relay grace window + the client budget, and < the 300s token
// TTL so the ORIGINAL bridge token is still valid the whole window (no re-mint).
// Reaping still happens on: budget exhausted, claude exits, a real shutdown (parent
// disconnect / SIGTERM / before-quit), or a TERMINAL relay close code (below).
const BRIDGE_RECONNECT_MS = Number(process.env.BRIDGE_RECONNECT_MS || 90000);
// Per-attempt open timeout while reconnecting: a hung connect cycles to the next
// attempt instead of stalling the whole budget.
const RECONNECT_ATTEMPT_TIMEOUT_MS = Number(process.env.BRIDGE_RECONNECT_ATTEMPT_TIMEOUT_MS || 10000);
// Relay close codes that are TERMINAL for the bridge — never reconnect on these
// (auth / duplicate failures cannot succeed on retry). Mirrors pairing.js → CLOSE.
// 4001 (PREEMPTED) is terminal too (fix/terminal-bridge-zombie-preemption): a
// newer same-owner bridge attach replaced this leg — reconnecting would only
// steal the session back and flap, so the losing helper shuts down cleanly.
const TERMINAL_CLOSE_CODES = new Set([
  4001 /* PREEMPTED */,
  4002 /* DUP_BRIDGE */,
  4005 /* OWNER_MISMATCH */,
  4006 /* BAD_TOKEN */,
]);
const NORMAL_CLOSURE = 1000;

const [file, ...cmdArgs] = shellSplit(CMD);
const spawnArgs = PROMPT ? [...cmdArgs, PROMPT] : cmdArgs;

// ── the known macOS spawn-helper fix ──────────────────────────────────────────
// node-pty ships a `spawn-helper` binary under prebuilds/<platform>-<arch>/.
// On macOS it can land without the executable bit (npm/tar quirks), which makes
// pty.spawn throw EACCES. Re-assert +x before spawning. No-op elsewhere.
function ensureSpawnHelperExecutable() {
  if (process.platform !== "darwin") return;
  try {
    const ptyDir = path.dirname(require.resolve("node-pty"));
    const pkgRoot = path.resolve(ptyDir, "..");
    const plat = `${process.platform}-${process.arch}`;
    const candidates = [
      path.join(pkgRoot, "prebuilds", plat, "spawn-helper"),
      path.join(pkgRoot, "build", "Release", "spawn-helper"),
      path.join(pkgRoot, "build", "Debug", "spawn-helper"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        fs.chmodSync(c, 0o755);
        log("debug", "ensured spawn-helper executable", { path: c });
      }
    }
  } catch (e) {
    log("warn", "could not chmod spawn-helper (continuing)", { err: String(e?.message || e) });
  }
}

// ── PATH resolution for GUI-launched bridges ─────────────────────────────────
// When the helper app is launched by the browser (LaunchServices), it inherits
// macOS's MINIMAL system PATH (/usr/bin:/bin:…) — NOT the user's shell PATH. The
// default command `claude` typically lives in ~/.local/bin or /opt/homebrew/bin,
// so the PTY died instantly with "command not found" (exitCode 1 in ~0.1s) and
// the whole session tore down. Fix: capture the user's LOGIN-shell PATH once
// (like Terminal.app effectively does) and fall back to appending the well-known
// bin dirs. Never fails — worst case we keep the inherited PATH + fallbacks.
function resolveSpawnEnv() {
  const env = { ...process.env, TERM: "xterm-color" };
  if (process.platform === "win32") return env; // PATH semantics differ; not needed
  let shellPath = "";
  let pathSource = "inherited+fallbacks";
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    // -ilc = interactive login shell → sources .zprofile AND .zshrc, wherever the
    // user set PATH. Markers isolate $PATH from any rc-file banner noise.
    const out = require("node:child_process").execFileSync(
      shell,
      ["-ilc", 'printf "__PATH__%s__END__" "$PATH"'],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const m = out.match(/__PATH__([\s\S]*)__END__/);
    if (m && m[1].trim()) {
      shellPath = m[1].trim();
      pathSource = "login-shell";
    }
  } catch {
    /* fall through to fallbacks */
  }
  const parts = (shellPath || env.PATH || "").split(":").filter(Boolean);
  for (const extra of [
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    if (!parts.includes(extra)) parts.push(extra);
  }
  env.PATH = parts.join(":");
  log("debug", "resolved spawn PATH", { source: pathSource, dirs: parts.length });
  return env;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  ensureSpawnHelperExecutable();

  const pty = require("node-pty");

  // Expose shutdown so the top-level catch can tear down (kill the PTY child)
  // instead of process.exit()ing over a live grandchild. Assigned FIRST (the
  // function declaration below is hoisted) so any throw in this body after the
  // PTY spawn still reaps.
  shutdownRef = shutdown;

  let term = null; // spawned lazily for prompt-carrying launches (R1 gate below)
  let ptyExited = false; // set by term.onExit — authoritative "child is dead"
  let pendingResize = null; // a resize that arrived while the spawn was deferred
  let ws = null;
  // Terminal P2 (E2EE): re-created fresh on EVERY attach/reconnect in
  // openRelay() below — FR-4's rekey-per-attach requirement. `null` for both
  // for the life of the process whenever E2EE_KEY (outer scope) was never
  // collected, i.e. this session runs in plaintext exactly as before.
  let e2eeEnc = null; // FrameEncryptor — bridge output (b2w)
  let e2eeDec = null; // FrameDecryptor — bridge input (w2b)
  let bytesOut = 0; // PTY -> ws
  let bytesIn = 0; // ws -> PTY
  let open = false;
  let shuttingDown = false;
  let connectTimer = null;
  let maxTimer = null;
  let attachTimer = null;
  let pingTimer = null;
  let missedPongs = 0;
  // Reconnect bookkeeping. `reconnectDeadline === 0` means "link healthy, not
  // reconnecting"; it's set on the first transient drop and cleared once the link
  // is proven healthy again (relay `attached` frame or the first byte).
  let reconnectDeadline = 0;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  // Whether the relay socket has opened at least once — distinguishes a first-connect
  // failure (exit 1) from a post-connection drop (exit 0) at teardown.
  let openedAtLeastOnce = false;

  function stopKeepalive() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  // PTY output produced before the relay socket is open (e.g. the program's
  // startup banner), flushed on open so the first bytes never lose the race.
  /** @type {Buffer[]} */
  const preOpenBuffer = [];

  // MITIGATION 2 (Cloudflare free-tier op budget): Nagle-style coalescing for
  // the PTY -> relay leg. `send` closes over the live `ws`/`shuttingDown`
  // bindings so it always targets the CURRENT socket (survives reconnects);
  // if the socket isn't open it falls back to the same preOpenBuffer used
  // pre-batching, so no bytes are dropped across a reconnect gap. TEXT/control
  // frames (via outputBatcher.sendControl, unused by this bridge today but
  // kept for any future outbound control frame) are never buffered.
  const outputBatcher = createOutputBatcher({
    send: (chunk, meta) => {
      // Terminal P2 (E2EE): encrypt the FINAL, already-coalesced chunk right
      // here — the one point every outbound binary WS message actually
      // passes through, so a burst that got merged by the batcher still
      // becomes exactly ONE AEAD frame on the wire (encrypting earlier, per
      // onData chunk, would let the batcher concatenate several independent
      // frames into one message — see term.onData's comment above).
      // e2eeEnc always reflects the CURRENT attach (reset in openRelay() on
      // every reconnect), so a chunk re-queued from preOpenBuffer after a
      // reconnect is encrypted with the NEW attach's subkey, never the old.
      // Only encrypt when actually sending now — buffering the PLAINTEXT
      // chunk when the socket isn't open avoids burning a nonce on a frame
      // that's discarded here (it's re-encrypted for real when re-queued).
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(meta.binary && e2eeEnc ? e2eeEnc.encrypt(chunk) : chunk, { binary: meta.binary });
      } else if (!shuttingDown) {
        preOpenBuffer.push(chunk);
      }
    },
  });

  function shutdown(code, why) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(connectTimer);
    clearTimeout(maxTimer);
    clearTimeout(attachTimer);
    clearTimeout(reconnectTimer);
    stopKeepalive();
    // Flush any coalesced PTY output still buffered so the last bytes before
    // shutdown (e.g. a command's final output) aren't lost mid-coalesce-window.
    outputBatcher.flush();
    log("info", "shutting down", { why, bytesOut, bytesIn });
    try { ws?.close(1000, why); } catch { /* ignore */ }
    // Record the code first: with NO PTY (a blocked prompt launch) the event
    // loop can drain before the unref'd hard-exit timer fires, and the process
    // then exits naturally — exitCode makes that natural exit carry the right
    // status.
    process.exitCode = code;
    // give sockets a tick to flush their close frame, then exit
    const exitSoon = () => setTimeout(() => process.exit(code), 200).unref();

    // No PTY (blocked prompt launch) or Windows (conpty — no POSIX signal
    // escalation): node-pty's own kill + the short flush window is all there is.
    if (!term || process.platform === "win32") {
      try { term?.kill(); } catch { /* ignore */ }
      exitSoon();
      return;
    }

    // Verified-kill escalation (the orphaned-`claude` fix). The old code fired
    // ONE unverified SIGHUP and hard-exited 200ms later; a child that ignores
    // SIGHUP (claude does) survived as an orphan because it is its own session/
    // group leader (spawn-helper setsid). Now: SIGHUP → SIGTERM → SIGKILL(+the
    // child's process group), and we do NOT exit until the child is confirmed
    // dead or the SIGKILL has been sent. The escalation's own (ref'd) poll
    // timers keep the event loop alive; SHUTDOWN_CAP_MS is the hard stop.
    const pid = term.pid;
    const hardCap = setTimeout(() => {
      log("warn", "shutdown hard cap reached — exiting", { ms: SHUTDOWN_CAP_MS, pid });
      process.exit(code);
    }, SHUTDOWN_CAP_MS);
    reapPidGroupEscalated(pid, {
      hupWaitMs: KILL_HUP_WAIT_MS,
      termWaitMs: KILL_TERM_WAIT_MS,
      isDead: () => ptyExited,
      onStage: (stage) => log("warn", "pty kill escalated", { stage, pid }),
    })
      .then((res) => {
        if (res.confirmedDead) {
          if (res.stage !== "already-dead") log("info", "pty child confirmed dead", { pid, stage: res.stage });
        } else {
          log("error", "pty child NOT confirmed dead after SIGKILL", { pid });
        }
        clearTimeout(hardCap);
        exitSoon();
      })
      .catch((e) => {
        log("error", "pty kill escalation failed — sending SIGKILL", { pid, err: String(e?.message || e) });
        try { process.kill(-pid, "SIGKILL"); } catch { /* ignore */ }
        try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
        clearTimeout(hardCap);
        exitSoon();
      });
  }

  /**
   * Spawn the PTY and wire its handlers. Called immediately for promptless
   * launches (today's behaviour, unchanged) and ONLY after the relay's
   * `attached` confirmation for prompt-carrying launches (R1 — see below).
   * The prompt is one argv element in `spawnArgs`; it is deliberately NOT
   * logged (only its length is).
   */
  function spawnPty() {
    if (term || shuttingDown) return;
    log("info", "spawning PTY", {
      file,
      args: cmdArgs,
      cwd: CWD,
      promptChars: PROMPT.length,
      cols: SPAWN_COLS,
      rows: SPAWN_ROWS,
    });
    let spawned;
    try {
      spawned = pty.spawn(file, spawnArgs, {
        name: "xterm-color",
        cols: SPAWN_COLS,
        rows: SPAWN_ROWS,
        cwd: CWD,
        env: resolveSpawnEnv(),
      });
    } catch (e) {
      log("error", "PTY spawn failed", { err: String(e?.message || e) });
      if (open) shutdown(1, "spawn-failed");
      else process.exit(1);
      return;
    }
    term = spawned;

    // Tell the supervising helper (if any) which pid to verify-kill should WE
    // die uncleanly (a SIGKILL'd bridge can run no cleanup — matrix row c).
    // Standalone CLI runs have no IPC channel; this is a guarded no-op there.
    if (process.send && process.channel) {
      try {
        process.send({ type: "pty-pid", pid: spawned.pid });
      } catch { /* channel already closing */ }
    }

    // PTY -> relay (binary, verbatim). Coalesced (MITIGATION 2) — see
    // outputBatcher above; a quiet line still goes out immediately. Terminal
    // P2 (E2EE) encrypts in the batcher's own `send` callback below, NOT
    // here — encrypting per-onData-chunk would let the batcher's coalescing
    // concatenate several independent AEAD frames into one WS message, which
    // the one-frame-per-message wire format can't represent.
    term.onData((data) => {
      const buf = Buffer.from(data, "utf8");
      bytesOut += buf.length;
      outputBatcher.queueBinary(buf);
    });

    term.onExit(({ exitCode, signal }) => {
      ptyExited = true; // lets an in-flight kill escalation confirm instantly
      log("info", "PTY exited", { exitCode, signal });
      shutdown(0, "pty-exit");
    });

    // Apply the browser's size if it resized while the spawn was deferred.
    if (pendingResize) {
      try { term.resize(pendingResize.cols, pendingResize.rows); } catch { /* best effort */ }
      pendingResize = null;
    }
  }

  // The relay requires an app-minted `bridge`-role token (slice 2). It binds this
  // leg to its owning user; the matching `browser` token must carry the same owner.
  // Checked BEFORE any spawn — a doomed launch must never create a child process.
  if (!TOKEN) {
    log("error", "missing bridge token — set --token or BRIDGE_TOKEN (minted by the app)");
    process.exit(1);
  }

  // Helper-fork parent-death detection: the helper forks us with an IPC channel.
  // If the helper dies uncleanly (crash/SIGKILL) the channel drops — tear down
  // instead of running parentless forever. Standalone CLI runs have no channel,
  // so this never arms outside a helper fork.
  if (process.channel) {
    process.on("disconnect", () => {
      log("warn", "IPC channel to parent dropped — supervising helper is gone");
      shutdown(1, "helper-gone");
    });
  }

  // R1 SEQUENCING. Promptless launches spawn FIRST, exactly as before — nothing
  // in their flow changes. A URL-carried prompt is different: it must NEVER
  // reach a child process unless the relay has accepted the owner-bound token,
  // and the relay REJECTS bad legs by accept()ing then immediately closing
  // (4005/4006/…) — so `open` alone proves nothing. The spawn is therefore
  // gated on the relay's explicit `attached` control frame, sent only after
  // authorizeAttach + decideAttach pass. No frame → exit, zero spawn.
  if (!PROMPT) spawnPty();
  // E2EE key collection (FR-1/FR-5): a bounded, best-effort fetch BEFORE the
  // relay connect URL is built, so a successful fetch can announce `e2ee=1`
  // on THIS attach (and every reconnect reuses the SAME key — see
  // E2EE_KEY/E2EE_ENC/E2EE_DEC below, refreshed per attach in openRelay()).
  // Never blocks/gates the PTY spawn above — only delays this bridge's OWN
  // relay connect by at most E2EE_KEY_FETCH_TIMEOUT_MS, and any output
  // produced meanwhile is safely queued in preOpenBuffer, not lost.
  const E2EE_KEY = await fetchE2eeSessionKey();
  if (E2EE_KEY) log("info", "e2ee key collected — this session will be encrypted");
  const url =
    `${RELAY.replace(/\/$/, "")}/?session=${encodeURIComponent(SESSION)}` +
    `&role=bridge&token=${encodeURIComponent(TOKEN)}` +
    (HELPER_VERSION ? `&helperVersion=${encodeURIComponent(HELPER_VERSION)}` : "") +
    (HOST ? `&host=${encodeURIComponent(HOST)}` : "") +
    // Exact-conversation Resume (rework 5): announce the id of the claude
    // conversation this launch just spawned/resumed, alongside
    // helperVersion/host — same query-param path, same skew-safe shape (see
    // terminal/shared/control-frames.mjs's EXACT-CONVERSATION RESUME header
    // comment). Absent for an explicit --cmd override or a legacy --continue
    // launch (CONV is null there — nothing honest to announce).
    (CONV ? `&conv=${encodeURIComponent(CONV)}` : "") +
    // Terminal P2 (E2EE, FR-3/FR-5): announce capability alongside the other
    // metadata, reusing this exact mechanism — see control-frames.mjs.
    (E2EE_KEY ? `&e2ee=1` : "");
  const redactedUrl = url.replace(/token=[^&]*/, "token=***");

  // The absolute max-duration cap is armed ONCE and spans reconnects (a link drop
  // must never reset it). BRIDGE_MAX_SECONDS is preserved exactly. Its default
  // (25h) sits 1h above the relay's own 24h backstop so the bridge is never the
  // one to end a long-running session first — the relay's alarm fires, tells the
  // bridge honestly via a real close, and this timer only matters if that somehow
  // doesn't happen.
  maxTimer = setTimeout(() => {
    log("warn", "max-duration cap reached — ending session", { seconds: MAX_SECONDS });
    shutdown(0, "max-duration");
  }, MAX_SECONDS * 1000);

  /** True while the PTY child (`claude`) is alive — the gate for reconnecting. */
  function claudeAlive() {
    return !!term && !ptyExited;
  }

  /**
   * Decide what a relay close means. Only an ABNORMAL close (code 1006 — sleep, Wi-Fi
   * drop, or the keepalive's own missed-pong ws.terminate(); i.e. NO close frame was
   * received) is TRANSIENT: while claude is alive AND within the reconnect budget it
   * RECONNECTS to the same session, keeping the child running. Every DELIBERATE relay
   * close frame is terminal — the relay is ending the session, so reap, never retry:
   *   - 1000                    → a clean end (idle / max / user).
   *   - PEER_GONE 4004          → the relay's grace window elapsed (or an old relay's
   *                               peer-gone) — the session is over.
   *   - 4002 / 4005 / 4006      → duplicate / owner-mismatch / bad-token — cannot
   *                               succeed on retry.
   * (claude already gone, or the budget spent, also reap — see below.)
   */
  function handleRelayClose(code, reason) {
    if (shuttingDown) return; // a real shutdown is already tearing down
    stopKeepalive();
    open = false;
    const transient = code === 1006; // abnormal close = no deliberate frame from the relay
    if (!transient) {
      if (TERMINAL_CLOSE_CODES.has(code)) {
        log("warn", "relay closed with a terminal code — not reconnecting", { code, reason });
        shutdown(1, "ws-close-terminal");
        return;
      }
      // 1000 (clean end) or PEER_GONE 4004 (grace elapsed) — a deliberate session end.
      shutdown(openedAtLeastOnce && !(PROMPT && !term) ? 0 : 1, "ws-close");
      return;
    }
    // Transient drop. Only worth reconnecting if there's a live child to preserve.
    if (!claudeAlive()) {
      shutdown(openedAtLeastOnce && !(PROMPT && !term) ? 0 : 1, "ws-close");
      return;
    }
    const now = Date.now();
    if (reconnectDeadline === 0) reconnectDeadline = now + BRIDGE_RECONNECT_MS;
    if (now >= reconnectDeadline) {
      log("warn", "reconnect budget exhausted — ending session", { budgetMs: BRIDGE_RECONNECT_MS });
      shutdown(0, "reconnect-exhausted");
      return;
    }
    scheduleReconnect(code);
  }

  /** Schedule the next reconnect attempt with jittered exponential backoff, bounded
   *  by the reconnect budget. */
  function scheduleReconnect(code) {
    const attempt = reconnectAttempt++;
    const base = Math.min(1000 * 2 ** attempt, 8000); // 1s → 2s → 4s → 8s cap
    const delay = base + Math.floor(Math.random() * 250); // jitter to de-sync retries
    log("warn", "relay link dropped — will reconnect", {
      code, attempt, delayMs: delay, budgetMsLeft: Math.max(0, reconnectDeadline - Date.now()),
    });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (shuttingDown) return;
      if (Date.now() >= reconnectDeadline) {
        log("warn", "reconnect budget exhausted — ending session", { budgetMs: BRIDGE_RECONNECT_MS });
        shutdown(0, "reconnect-exhausted");
        return;
      }
      openRelay();
    }, delay);
    reconnectTimer.unref?.();
  }

  /**
   * Open (or RE-open) the bridge leg to the relay and wire its handlers. Called once
   * initially and again for each reconnect attempt — the SAME url (relay + sid +
   * token), which is why no re-mint is needed and the relay-allowlist gate (asserted
   * once at startup on this exact RELAY) still holds for every attempt.
   */
  function openRelay() {
    const reconnecting = reconnectDeadline !== 0;
    log("info", reconnecting ? "reconnecting to relay" : "connecting to relay", {
      url: redactedUrl, host: os.hostname(), attempt: reconnectAttempt,
    });
    ws = new WebSocket(url);
    // Terminal P2 (E2EE, FR-4): fresh encryptor/decryptor EVERY attach — a
    // fresh random attachId per FrameEncryptor construction, so the HKDF
    // subkey (and therefore the whole nonce space) is unique to this
    // connection even on a reconnect that reuses the same session key. `null`
    // when this session never collected a key (Phase A plaintext fallback).
    if (E2EE_KEY) {
      e2eeEnc = new FrameEncryptor(E2EE_KEY, "b2w", SESSION);
      e2eeDec = new FrameDecryptor(E2EE_KEY, "w2b", SESSION);
    }

    // Per-attempt open timeout. The FIRST connect failing is fatal; a RECONNECT
    // attempt that won't open just cycles (terminate → close → next attempt/budget).
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (open) return;
      if (reconnecting) {
        log("warn", "reconnect attempt did not open in time — retrying", { ms: RECONNECT_ATTEMPT_TIMEOUT_MS });
        try { ws.terminate(); } catch { /* ignore */ }
      } else {
        log("error", "connect timeout — relay never opened", { ms: CONNECT_TIMEOUT_MS });
        shutdown(1, "connect-timeout");
      }
    }, reconnecting ? RECONNECT_ATTEMPT_TIMEOUT_MS : CONNECT_TIMEOUT_MS);

    // relay -> PTY
    ws.on("message", (data, isBinary) => {
      // Any inbound traffic proves the link is healthy again → reconnect complete.
      if (reconnectDeadline !== 0) {
        log("info", "relay link healthy again — reconnect complete", { attempts: reconnectAttempt });
        reconnectDeadline = 0;
        reconnectAttempt = 0;
      }
      if (isBinary) {
        // opaque keystroke bytes -> PTY stdin. While a prompt spawn is still
        // gated there is no PTY; pre-auth keystrokes are dropped, never buffered.
        // Terminal P2 (E2EE, FR-5): when this attach has a decryptor, EVERY
        // binary frame must decrypt cleanly before it's trusted — a failure
        // (tamper, replay, wrong key, cross-direction reflection) fails
        // closed: the session ends distinctly, and the bytes are NEVER
        // written to the PTY, buffered, or otherwise trusted as input.
        if (e2eeDec) {
          let plaintext;
          try {
            plaintext = e2eeDec.decrypt(Buffer.isBuffer(data) ? data : Buffer.from(data));
          } catch (e) {
            log("error", "e2ee frame verification failed — ending session", {
              err: e instanceof PtyCryptoError ? e.message : String(e?.message || e),
            });
            shutdown(1, "e2ee-verify-failed");
            return;
          }
          // `null` = an in-flight frame from a browser attach we have since
          // moved past (the browser re-attached and rekeyed; this frame was
          // encrypted under its previous attach). Not input — drop it.
          if (plaintext === null) {
            log("debug", "dropped stale-attach e2ee frame");
            return;
          }
          bytesIn += plaintext.length;
          if (term) term.write(plaintext.toString("utf8"));
          return;
        }
        bytesIn += data.length;
        if (term) term.write(data.toString("utf8"));
        return;
      }
      const text = data.toString("utf8");
      // R1: the relay's post-auth confirmation — the ONLY signal that releases a
      // prompt-carrying spawn. Also sent on every (re)attach, so it doubles as the
      // reconnect-complete proof above. For an already-spawned PTY it's a no-op.
      if (isAttachedFrame(text)) {
        clearTimeout(attachTimer);
        attachTimer = null;
        log("info", "relay confirmed attach", { session: SESSION });
        if (PROMPT) spawnPty();
        return;
      }
      // Grace-window notices (relay holding / pair restored). Informational for the
      // bridge — the child keeps running regardless; recognised so they don't log as
      // "unknown". Skew-safe: an old relay simply never sends them.
      if (isPeerDegradedFrame(text)) {
        log("debug", "relay reports peer degraded (holding session)");
        return;
      }
      if (isPeerReattachedFrame(text)) {
        // Terminal P2 (E2EE) reconnect fix (1–2 Sep 2026 incident): the pair
        // is whole again — which includes the BROWSER having re-attached on
        // its own (tab wake, watchdog, Wi-Fi blip, hard refresh) while this
        // bridge kept running. The browser builds a fresh decryptor per
        // attach, so our OUTBOUND stream must restart at a fresh attachId +
        // counter 0 or every frame we send from here is rejected as out of
        // order. Our INBOUND decryptor is rebuilt too: the browser's new
        // encryptor starts a new attach, and a fresh decryptor follows it
        // cleanly (frames still in flight under its previous attach are
        // dropped by FrameDecryptor, never fatal). No-op when this session
        // never collected a key (Phase A plaintext).
        if (E2EE_KEY) {
          e2eeEnc = new FrameEncryptor(E2EE_KEY, "b2w", SESSION);
          e2eeDec = new FrameDecryptor(E2EE_KEY, "w2b", SESSION);
          log("info", "relay reports pair reattached — e2ee rekeyed for the new attach");
        } else {
          log("debug", "relay reports pair reattached");
        }
        return;
      }
      // TEXT control frame (resize). Never written to the PTY as input.
      const ctrl = parseControlMessage(text);
      if (ctrl?.type === "resize") {
        if (!term) {
          pendingResize = ctrl; // applied right after the gated spawn
          return;
        }
        try {
          term.resize(ctrl.cols, ctrl.rows);
          log("debug", "resized PTY", { cols: ctrl.cols, rows: ctrl.rows });
        } catch (e) {
          log("warn", "resize failed", { err: String(e?.message || e) });
        }
      } else {
        log("warn", "ignored unknown control frame");
      }
    });

    // Keepalive: protocol-level ping every PING_INTERVAL_MS; the ws server (and
    // Cloudflare's edge) auto-answers with pongs. A link that misses PING_MAX_MISSED
    // pongs in a row is dead (sleep/network drop with no FIN) — terminate it so
    // `close` fires and handleRelayClose() decides reconnect-vs-reap (within budget
    // it now RECONNECTS rather than immediately reaping the child).
    ws.on("pong", () => {
      missedPongs = 0;
    });

    ws.on("open", () => {
      open = true;
      openedAtLeastOnce = true;
      clearTimeout(connectTimer);
      log("info", "relay connected (bridge leg)", { session: SESSION });
      missedPongs = 0;
      pingTimer = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (missedPongs >= PING_MAX_MISSED) {
          log("warn", "keepalive: pongs missed — terminating dead relay link", { missed: missedPongs });
          try { ws.terminate(); } catch { /* ignore */ }
          return;
        }
        missedPongs += 1;
        try { ws.ping(); } catch { /* ignore */ }
      }, PING_INTERVAL_MS);
      pingTimer.unref?.();
      // Prompt launches: arm the attach-confirmation window. An OLD relay never
      // sends the frame → clean exit with NOTHING spawned (graceful skew; the
      // dock's existing ~8s fallback covers the UX). Reconnects always have a live
      // PTY (term set), so this never arms on a reconnect.
      if (PROMPT && !term && !attachTimer) {
        attachTimer = setTimeout(() => {
          log("error", "no attach confirmation from relay — exiting without spawning", {
            ms: ATTACH_CONFIRM_TIMEOUT_MS,
          });
          shutdown(1, "attach-confirm-timeout");
        }, ATTACH_CONFIRM_TIMEOUT_MS);
      }
      // Flush any PTY output produced before the socket opened (incl. bytes buffered
      // during a reconnect gap) — the pipe resumes seamlessly on re-attach. Routed
      // through the same coalescing batcher (MITIGATION 2) so a catch-up burst
      // after a reconnect gap doesn't turn into one relay message per chunk.
      while (preOpenBuffer.length > 0) {
        outputBatcher.queueBinary(preOpenBuffer.shift());
      }
    });

    ws.on("close", (code, reasonBuf) => {
      const reason = reasonBuf?.toString?.() || "";
      log("info", "relay closed", { code, reason });
      // Any bytes still coalescing when the link drops must not be silently
      // dropped — attempt the flush now (falls back to preOpenBuffer via
      // outputBatcher's send() if the socket is already unusable, so they
      // replay on the next open/reconnect).
      outputBatcher.flush();
      handleRelayClose(code, reason);
    });

    ws.on("error", (e) => {
      log("error", "relay ws error", { err: String(e?.message || e) });
      // 'close' will follow; handleRelayClose there.
    });
  }

  openRelay();

  // Clean teardown on Ctrl-C / kill.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      log("info", "received signal", { sig });
      shutdown(0, sig);
    });
  }
}

let shutdownRef = null; // set by main() once its shutdown() closure exists

main().catch((e) => {
  log("error", "fatal", { err: String(e?.stack || e) });
  if (shutdownRef) shutdownRef(1, "fatal");
  else process.exit(1);
});
