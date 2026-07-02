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
//   --max-seconds <n>    hard self-kill safety cap       [BRIDGE_MAX_SECONDS] default 28800 (8h)
//   --connect-timeout-ms <n>  fail if relay not open in time  [default 30000]

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import WebSocket from "ws";
import { parseControlMessage } from "./framing.js";
import { parseLaunchDeepLink, redactDeepLinkToken } from "../../shared/deep-link.mjs";
import { isAttachedFrame } from "../../shared/control-frames.mjs";

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
const SESSION = launched?.session || args.session || process.env.SESSION_ID || `dev-${Math.random().toString(36).slice(2, 10)}`;
const TOKEN = launched?.token || args.token || process.env.BRIDGE_TOKEN || "";
const CMD = args.cmd || process.env.BRIDGE_CMD || "claude";
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
const PROMPT = launched?.prompt || "";
const MAX_SECONDS = Number(args["max-seconds"] || process.env.BRIDGE_MAX_SECONDS || 28800);
const CONNECT_TIMEOUT_MS = Number(args["connect-timeout-ms"] || 30000);
// How long after the socket opens we wait for the relay's `attached` frame before
// giving up (prompt launches only). An OLD relay never sends it → clean exit, no
// spawn — the dock's existing ~8s fallback covers the UX.
const ATTACH_CONFIRM_TIMEOUT_MS = Number(args["attach-confirm-timeout-ms"] || 10000);

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

  let term = null; // spawned lazily for prompt-carrying launches (R1 gate below)
  let pendingResize = null; // a resize that arrived while the spawn was deferred
  let ws = null;
  let bytesOut = 0; // PTY -> ws
  let bytesIn = 0; // ws -> PTY
  let open = false;
  let shuttingDown = false;
  let connectTimer = null;
  let maxTimer = null;
  let attachTimer = null;

  // PTY output produced before the relay socket is open (e.g. the program's
  // startup banner), flushed on open so the first bytes never lose the race.
  /** @type {Buffer[]} */
  const preOpenBuffer = [];

  function shutdown(code, why) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(connectTimer);
    clearTimeout(maxTimer);
    clearTimeout(attachTimer);
    log("info", "shutting down", { why, bytesOut, bytesIn });
    try { ws?.close(1000, why); } catch { /* ignore */ }
    try { term?.kill(); } catch { /* ignore */ }
    // Record the code first: with NO PTY (a blocked prompt launch) the event
    // loop can drain before the unref'd hard-exit timer fires, and the process
    // then exits naturally — exitCode makes that natural exit carry the right
    // status. The timer stays as the hard stop for the PTY-alive case.
    process.exitCode = code;
    // give sockets a tick to flush their close frame, then exit hard
    setTimeout(() => process.exit(code), 200).unref();
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
    log("info", "spawning PTY", { file, args: cmdArgs, cwd: CWD, promptChars: PROMPT.length });
    let spawned;
    try {
      spawned = pty.spawn(file, spawnArgs, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
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

    // PTY -> relay (binary, verbatim).
    term.onData((data) => {
      const buf = Buffer.from(data, "utf8");
      bytesOut += buf.length;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(buf, { binary: true });
      } else if (!shuttingDown) {
        preOpenBuffer.push(buf);
      }
    });

    term.onExit(({ exitCode, signal }) => {
      log("info", "PTY exited", { exitCode, signal });
      shutdown(0, "pty-exit");
    });

    // Apply the browser's size if it resized while the spawn was deferred.
    if (pendingResize) {
      try { term.resize(pendingResize.cols, pendingResize.rows); } catch { /* best effort */ }
      pendingResize = null;
    }
  }

  // R1 SEQUENCING. Promptless launches spawn FIRST, exactly as before — nothing
  // in their flow changes. A URL-carried prompt is different: it must NEVER
  // reach a child process unless the relay has accepted the owner-bound token,
  // and the relay REJECTS bad legs by accept()ing then immediately closing
  // (4005/4006/…) — so `open` alone proves nothing. The spawn is therefore
  // gated on the relay's explicit `attached` control frame, sent only after
  // authorizeAttach + decideAttach pass. No frame → exit, zero spawn.
  if (!PROMPT) spawnPty();

  // The relay requires an app-minted `bridge`-role token (slice 2). It binds this
  // leg to its owning user; the matching `browser` token must carry the same owner.
  if (!TOKEN) {
    log("error", "missing bridge token — set --token or BRIDGE_TOKEN (minted by the app)");
    process.exit(1);
  }
  const url =
    `${RELAY.replace(/\/$/, "")}/?session=${encodeURIComponent(SESSION)}` +
    `&role=bridge&token=${encodeURIComponent(TOKEN)}`;
  // Log the URL WITHOUT the token (never log secrets).
  log("info", "connecting to relay", { url: url.replace(/token=[^&]*/, "token=***"), host: os.hostname() });
  ws = new WebSocket(url);

  // Hard timeouts so nothing hangs.
  connectTimer = setTimeout(() => {
    if (!open) {
      log("error", "connect timeout — relay never opened", { ms: CONNECT_TIMEOUT_MS });
      shutdown(1, "connect-timeout");
    }
  }, CONNECT_TIMEOUT_MS);

  maxTimer = setTimeout(() => {
    log("warn", "max-duration cap reached — ending session", { seconds: MAX_SECONDS });
    shutdown(0, "max-duration");
  }, MAX_SECONDS * 1000);

  // relay -> PTY
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      // opaque keystroke bytes -> PTY stdin. While a prompt spawn is still
      // gated there is no PTY; pre-auth keystrokes are dropped, never buffered.
      bytesIn += data.length;
      if (term) term.write(data.toString("utf8"));
      return;
    }
    const text = data.toString("utf8");
    // R1: the relay's post-auth confirmation — the ONLY signal that releases a
    // prompt-carrying spawn. For promptless launches (already spawned) or an
    // already-spawned PTY it is a harmless no-op.
    if (isAttachedFrame(text)) {
      clearTimeout(attachTimer);
      attachTimer = null;
      log("info", "relay confirmed attach", { session: SESSION });
      if (PROMPT) spawnPty();
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

  ws.on("open", () => {
    open = true;
    clearTimeout(connectTimer);
    log("info", "relay connected (bridge leg)", { session: SESSION });
    // Prompt launches: arm the attach-confirmation window. An OLD relay never
    // sends the frame → clean exit with NOTHING spawned (graceful skew; the
    // dock's existing ~8s fallback covers the UX).
    if (PROMPT && !term && !attachTimer) {
      attachTimer = setTimeout(() => {
        log("error", "no attach confirmation from relay — exiting without spawning", {
          ms: ATTACH_CONFIRM_TIMEOUT_MS,
        });
        shutdown(1, "attach-confirm-timeout");
      }, ATTACH_CONFIRM_TIMEOUT_MS);
    }
    // Flush any PTY output produced before the socket opened.
    while (preOpenBuffer.length > 0) {
      ws.send(preOpenBuffer.shift(), { binary: true });
    }
  });

  ws.on("close", (code, reasonBuf) => {
    const reason = reasonBuf?.toString?.() || "";
    log("info", "relay closed", { code, reason });
    // A prompt launch whose spawn never got released (auth rejected / old relay)
    // is a failure even though the socket technically opened.
    shutdown(open && !(PROMPT && !term) ? 0 : 1, "ws-close");
  });

  ws.on("error", (e) => {
    log("error", "relay ws error", { err: String(e?.message || e) });
    // 'close' will follow; shutdown there.
  });

  // Clean teardown on Ctrl-C / kill.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      log("info", "received signal", { sig });
      shutdown(0, sig);
    });
  }
}

main().catch((e) => {
  log("error", "fatal", { err: String(e?.stack || e) });
  process.exit(1);
});
