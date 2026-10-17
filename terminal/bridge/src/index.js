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
//   --cwd     <dir>      the page's suggested project folder [BRIDGE_CWD] — a HINT the bridge
//                        checks on this Mac (card 6b2cb8ac, see folder-resolve.js); the dev/test
//                        --cmd override falls back to process.cwd()
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
import { resolveAgentLaunch } from "./resume-cmd.js";
import { buildSpawnArgs, codexAgentConfigArgs, codexAgentFiles, serializeSessionAgents, wantsSessionAgents } from "./session-agents.js";
import { resolveSpawnDims } from "./spawn-dims.js";
import { checkWorktreeEligibility, worktreeFallbackBanner } from "./worktree-eligibility.js";
import { agentNotInstalledBanner } from "./agent-copy.js";
import { resolveWorkspaceFolder } from "./folder-resolve.js";
import { cloneRepo } from "./git-clone.js";
import { progressLine, failureLines, earlyExitLine, promptFolderNote } from "./bridge-copy.js";
import { resolveMachineNames } from "../../shared/machine-name.mjs";
import { stripClaudeWorktreeSuffix } from "../../shared/project-path.mjs";
import { isBinaryInstalled } from "../../shared/binary-check.mjs";
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
  encodeBridgeCwdFrame,
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
// `new WebSocket()` and before ANY pty.spawn on every path (spawn-first, resume
// after the agents fetch, AND prompt-deferred). Loopback is allowed only when NOT packaged (dev/tests dial
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
// Codex support (docs/codex-terminal-requirements.md FR-1/FR-2) — which agent
// to spawn. The shared deep-link parser already whitelists this to exactly
// "codex" or absent (see deep-link.mjs's isAgentSafe); re-normalized here as
// defense in depth, same posture as RESUME_ID's re-check below. `BRIDGE_AGENT`
// mirrors BRIDGE_CMD/BRIDGE_MODEL's own dev/test convenience env fallback.
const AGENT = (launched?.agent || process.env.BRIDGE_AGENT) === "codex" ? "codex" : "claude";
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
// The reasoning effort, already parse-time whitelisted by the shared module
// (union of both ladders; each branch re-whitelists its own). Codex (FR-4):
// only on a FRESH launch, alongside MODEL — which, for a Codex launch, is the
// Codex model id the mint resolved. Claude (task 18a37612): `--effort <level>`
// on fresh, --resume and --continue launches. `BRIDGE_EFFORT` env mirrors BRIDGE_MODEL's dev/test fallback.
const EFFORT = launched?.effort || process.env.BRIDGE_EFFORT || null;
// Task d3de150c ("Terminal mode" auto-accept toggle): the deep link's
// `permissionMode` param, already parse-time whitelisted by the shared
// module's isPermissionModeSafe (only the literal "auto" ever
// survives parsing — see deep-link.mjs). Only ever applied by
// resolveClaudeLaunch on a genuinely fresh session (branch 4) — resume/
// resumeId/explicitCmd never read it, same as MODEL above.
// `BRIDGE_PERMISSION_MODE` env mirrors BRIDGE_MODEL's own dev/test
// convenience fallback.
const PERMISSION_MODE = launched?.permissionMode || process.env.BRIDGE_PERMISSION_MODE || null;
// Task 5c8969cc: the deep link's `remoteControl` flag (parse-time whitelisted
// to "1" by the shared module). resolveClaudeLaunch puts `--remote-control`
// straight after `claude` on every Claude branch; Codex and --cmd never read
// it. `BRIDGE_REMOTE_CONTROL=1` mirrors BRIDGE_WORKTREE's dev/test fallback.
const REMOTE_CONTROL = launched?.remoteControl === true || process.env.BRIDGE_REMOTE_CONTROL === "1";
// Concurrent-terminal isolation (QA-flagged fix): the deep link's `worktree`
// boolean (see shared/deep-link.mjs), set by the app whenever this launch
// needs isolation (existing-mode with a known/possibly-shared folder — see
// src/lib/launch-claude-code.ts's CompactPromptEssentials.isolate). Only ever
// applied by resolveClaudeLaunch on a genuinely fresh session (branch 4) —
// resume/resumeId/explicitCmd never read it, same as MODEL/PERMISSION_MODE
// above. `BRIDGE_WORKTREE` env mirrors their own dev/test convenience
// fallback.
const WORKTREE_REQUESTED = !!(launched?.worktree ?? (process.env.BRIDGE_WORKTREE === "1"));
// FOLDER (card 6b2cb8ac). The page's folder is only a HINT: it can be
// another Mac's folder, or missing entirely on a Mac that has never run this
// board. node-pty can't enter a folder that doesn't exist, so the agent used
// to die in ~20ms with a blank terminal (and with no folder at all it started
// at "/", the helper's own folder). The bridge now resolves the real folder ON
// THIS MAC before the agent starts — see folder-resolve.js. Three launch modes:
//   - "direct": an explicit --cmd/BRIDGE_CMD with no prompt (dev/test only).
//     Today's behaviour exactly: spawns first, in the hint or process.cwd().
//   - "resume": the conversation belongs to its folder — it must exist here,
//     or the session ends with `folder-missing` (checked synchronously below).
//   - "fresh": everything else. The spawn waits for the relay's `attached`
//     frame (R1, as before) and the folder resolution that follows it.
const IS_RESUME = !explicitCmd && !!(RESUME || RESUME_ID);
const LAUNCH_PROMPT = RESUME || RESUME_ID ? "" : launched?.prompt || "";
const MODE = IS_RESUME ? "resume" : explicitCmd && !LAUNCH_PROMPT ? "direct" : "fresh";
const HINT = launched?.cwd || args.cwd || process.env.BRIDGE_CWD || (explicitCmd ? process.cwd() : null);
// The folder the PTY spawns in: known now for direct/resume, set after the
// resolution for a fresh launch (spawnPty is never called before that).
let CWD = MODE === "direct" ? HINT : null;
/** A resume whose folder isn't on this Mac — ended once the relay link opens. */
let folderFailure = null;
if (MODE === "resume") {
  const hint = HINT ? stripClaudeWorktreeSuffix(HINT) : null;
  let ok = false;
  try {
    ok = !!hint && fs.statSync(hint).isDirectory();
  } catch { /* missing */ }
  if (ok) CWD = hint;
  else {
    folderFailure = { reason: "folder-missing", detail: null };
    log("warn", "resume folder isn't on this Mac — not spawning", { cwd: HINT });
  }
}
// Task 5b8a3865 (Nick, 5 Sep 2026): a requested worktree is only APPENDED when
// the folder can actually take one. `claude --worktree` branches off HEAD, so
// a git repo with no commits yet (or a folder that isn't a repo at all) made
// Claude Code exit on the spot with "Error creating worktree: Failed to
// resolve base branch HEAD" and the session was dead before the first
// keystroke. Checked in prepareLaunch() once the folder is known, ONLY for a
// genuinely fresh launch (resume/resumeId/explicitCmd never append the flag
// anyway). When the folder can't host a worktree the launch proceeds in the
// main folder and `WORKTREE_FALLBACK_BANNER` is written into the terminal
// ahead of Claude's own output so the user knows the two sessions now share
// the folder.
let WORKTREE_FALLBACK_BANNER = null;
// One conversation id for the whole process: the launch command is built
// before the folder is known (for the relay URL's `conv`) and again after it
// (prepareLaunch, which may add --worktree) — both must name the same id.
const CONV_ID = crypto.randomUUID();
/** @param {boolean} worktree */
function computeLaunch(worktree) {
  return resolveAgentLaunch({
    agent: AGENT,
    explicitCmd,
    resumeId: RESUME_ID,
    resume: RESUME,
    model: MODEL,
    // FR-4: for a Codex launch MODEL is the Codex model id (mint-resolved); the
    // codex branch reads codexModel/codexEffort, the claude branch reads model —
    // only one fires per AGENT, so passing MODEL to both is safe.
    codexModel: MODEL,
    codexEffort: EFFORT,
    // Task 18a37612: Claude's `--effort` (the claude branch re-whitelists it;
    // the codex branch never reads this one).
    effort: EFFORT,
    permissionMode: PERMISSION_MODE,
    worktree,
    remoteControl: REMOTE_CONTROL,
    mintId: () => CONV_ID,
  });
}
const INITIAL_LAUNCH = computeLaunch(false);
let CMD = INITIAL_LAUNCH.cmd;
const CONV = INITIAL_LAUNCH.conv;
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
// May gain a short "you're already in <folder>" note once the folder is
// resolved (local argv only — the launch link's budget is untouched).
let PROMPT = LAUNCH_PROMPT;
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
// Card 6b2cb8ac: a Mac's hostname drifts with the network (one MacBook shows
// up as two machines), so the CANONICAL name is the Mac's fixed
// LocalHostName (+ ".local"); the hostname stays as an alias. Every name goes
// to the app with the workspace/folder calls so folder records stay per-Mac.
const MACHINE = resolveMachineNames({
  hostname: os.hostname(),
  platform: process.platform,
  run: (file, runArgs) =>
    require("node:child_process").execFileSync(file, runArgs, {
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
    }),
});
const HOST = MACHINE.canonical ?? sanitizeMachineLabel(os.hostname());

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

// ── The board's agents as real subagents (task 59889027) ────────────────────
// Same off-relay channel and token as the E2EE key above. The definitions can
// be tens of KB, far past the launch link's length cap, so they never travel
// in it. Never throws: any failure launches the session exactly as before.
const SESSION_AGENTS_FETCH_TIMEOUT_MS = 5000;
// Fresh AND resumed launches (a resumed conversation loses its agents).
const WANTS_AGENTS = wantsSessionAgents({ agent: AGENT, explicitCmd });

/** @returns {Promise<unknown>} the endpoint's body, or null */
async function fetchSessionAgents() {
  if (!TOKEN || !SESSION) return null;
  if (!WANTS_AGENTS) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SESSION_AGENTS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/terminal/session/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `agent` picks the tier models/efforts: Claude's or Codex's.
      body: JSON.stringify({ sid: SESSION, token: TOKEN, agent: AGENT }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    log("warn", "session agents fetch failed — launching without them", { err: String(e?.message || e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── This board's project folder on this Mac (card 6b2cb8ac) ─────────────────
// Same off-relay channel and token as the key/agents fetches. The app answers
// with the board's repo (clone address built server-side), the folder names,
// THIS Mac's saved folders only, and how many other live sessions run on this
// Mac (for the worktree decision). Never throws: null on any failure, and the
// resolver then uses the page's folder only if it exists here.
const WORKSPACE_FETCH_TIMEOUT_MS = 5000;
const FOLDER_RECORD_TIMEOUT_MS = 3000;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** @param {unknown} raw @returns {import("./folder-resolve.js").Workspace | null} */
function sanitizeWorkspace(raw) {
  if (!raw || typeof raw !== "object") return null;
  const w = /** @type {any} */ (raw);
  let repo = null;
  if (w.repo && typeof w.repo === "object") {
    const { owner, name, cloneUrl } = w.repo;
    if (typeof owner === "string" && SAFE_SEGMENT_RE.test(owner) && typeof name === "string" && SAFE_SEGMENT_RE.test(name) && typeof cloneUrl === "string") {
      repo = { owner, name, cloneUrl };
    }
  }
  if (typeof w.newFolderName !== "string") return null;
  return {
    repo,
    repoFolderName: typeof w.repoFolderName === "string" ? w.repoFolderName : repo ? repo.name : null,
    newFolderName: w.newFolderName,
    savedFolders: Array.isArray(w.savedFolders) ? w.savedFolders.filter((p) => typeof p === "string").slice(0, 10) : [],
    otherLiveSessionsOnThisMac: Number.isFinite(w.otherLiveSessionsOnThisMac) ? Number(w.otherLiveSessionsOnThisMac) : 0,
  };
}

/** @returns {Promise<import("./folder-resolve.js").Workspace | null>} */
async function fetchWorkspace() {
  if (!TOKEN || !SESSION || MACHINE.names.length === 0) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKSPACE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/terminal/session/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sid: SESSION, token: TOKEN, machineNames: MACHINE.names }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    return sanitizeWorkspace(body?.workspace);
  } catch (e) {
    log("warn", "workspace fetch failed — using the page's folder only", { err: String(e?.message || e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Save the resolved folder for THIS Mac (every name it goes by). Best effort. */
async function recordFolder(folderPath, how) {
  if (!TOKEN || !SESSION || MACHINE.names.length === 0) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FOLDER_RECORD_TIMEOUT_MS);
  try {
    const res = await fetch(`${APP_URL.replace(/\/$/, "")}/api/terminal/session/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sid: SESSION, token: TOKEN, machineNames: MACHINE.names, path: folderPath, how }),
      signal: controller.signal,
    });
    log(res.ok ? "info" : "warn", "project folder recorded", { how, status: res.status });
  } catch (e) {
    log("warn", "couldn't record the project folder (the agent's own record step is the backup)", { err: String(e?.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

// Codex reads custom agents only from role files (see session-agents.js), so
// a Codex launch writes them to a private temp folder — outside the project
// and ~/.codex — that is removed when this bridge exits, on every exit path
// that runs code. (A SIGKILLed bridge leaves it to the OS temp cleaner.)
let agentFilesDir = null;
function removeAgentFiles() {
  if (!agentFilesDir) return;
  try { fs.rmSync(agentFilesDir, { recursive: true, force: true }); } catch { /* ignore */ }
  agentFilesDir = null;
}
process.on("exit", removeAgentFiles);

/**
 * The launch flags that hand the CLI the board's agents, or [] (launch as
 * before). Claude Code takes them inline; Codex gets role files.
 * @param {unknown} body
 * @returns {string[]}
 */
function sessionAgentArgs(body) {
  if (!body) return [];
  if (AGENT === "codex") {
    const files = codexAgentFiles(body);
    if (!files) return [];
    try {
      agentFilesDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibecodes-agents-"));
      const written = files.map(({ name, fileName, toml }) => {
        const filePath = path.join(agentFilesDir, fileName);
        fs.writeFileSync(filePath, toml, { mode: 0o600 });
        return { name, path: filePath };
      });
      return codexAgentConfigArgs(written);
    } catch (e) {
      log("warn", "couldn't write codex agent files — launching without them", { err: String(e?.message || e) });
      removeAgentFiles();
      return [];
    }
  }
  const json = serializeSessionAgents(body);
  return json ? ["--agents", json] : [];
}

const MAX_SECONDS = Number(args["max-seconds"] || process.env.BRIDGE_MAX_SECONDS || 90000);
// An agent that exits this soon after spawning "stopped straight away" (card 6b2cb8ac).
const EARLY_EXIT_MS = 10000;
// How long a fresh launch waits for the browser leg to be paired before it
// writes its folder progress lines (the relay drops frames with no peer).
const PEER_WAIT_MS = 3000;
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

let [file, ...cmdArgs] = shellSplit(CMD);
// `--agents` (task 59889027) is added once fetchSessionAgents() resolves —
// always before the child spawns: a fresh launch waits for the relay's
// `attached` frame (which comes after the fetch), and a promptless resume
// waits for the fetch itself; see buildSpawnArgs.
let sessionAgentFlags = [];
let spawnArgs = buildSpawnArgs(cmdArgs, sessionAgentFlags, PROMPT);

/**
 * Build the final launch for a FRESH session once its folder is known:
 * the worktree decision (decision 8: only when another live session runs on
 * THIS Mac — `isolateHere`), its eligibility check on the real folder, then
 * the command and argv (with the possibly-noted prompt).
 * @param {string} folder @param {{ isolateHere: boolean }} opts
 */
function prepareLaunch(folder, { isolateHere }) {
  const wantWorktree = WORKTREE_REQUESTED && isolateHere && !explicitCmd;
  const eligibility = wantWorktree ? checkWorktreeEligibility(folder, { run: runGitSync }) : { eligible: true, reason: /** @type {const} */ ("ok") };
  WORKTREE_FALLBACK_BANNER = wantWorktree ? worktreeFallbackBanner(eligibility.reason) : null;
  if (WORKTREE_REQUESTED && !isolateHere) {
    log("info", "worktree isolation requested, but no other live session runs on this Mac — using the main folder");
  }
  if (WORKTREE_FALLBACK_BANNER) {
    log("warn", "worktree isolation requested but the folder can't host one — launching in the main folder", {
      cwd: folder,
      reason: eligibility.reason,
    });
  }
  ({ cmd: CMD } = computeLaunch(wantWorktree && eligibility.eligible));
  [file, ...cmdArgs] = shellSplit(CMD);
  spawnArgs = buildSpawnArgs(cmdArgs, sessionAgentFlags, PROMPT);
}

/** The real path of the page's hint, or null (for "did the bridge pick another folder?"). */
function realHint() {
  if (!HINT) return null;
  try {
    return fs.realpathSync(stripClaudeWorktreeSuffix(HINT));
  } catch {
    return null;
  }
}

/** Sync probe for git-clone.js (git/xcode-select/gh): status + error, never throws. */
function runProbeSync(cmd, cmdArgsList, opts = {}) {
  const r = require("node:child_process").spawnSync(cmd, cmdArgsList, {
    env: opts.env,
    timeout: 5000,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return { status: r.status, error: r.error };
}

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

// ── git probe for the worktree eligibility gate (task 5b8a3865) ──────────────
// `git` on macOS lives at /usr/bin/git (the Xcode CLT shim), which is on even
// the minimal LaunchServices PATH the helper inherits — so unlike `claude`
// (see resolveSpawnEnv below) no login-shell PATH capture is needed here.
// Bounded (3s) and never throws past the eligibility checker: a null status
// plus `error` is how spawnSync reports "couldn't run at all" (ENOENT/timeout),
// and the checker maps that to a fallback reason rather than a crash.
function runGitSync(gitArgs) {
  const r = require("node:child_process").spawnSync("git", gitArgs, {
    timeout: 3000,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return { status: r.status, error: r.error };
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

  let term = null; // spawned lazily: after the relay's `attached` frame (prompt launches) or the agents fetch (resumes) — R1 gate below
  let ptyExited = false; // set by term.onExit — authoritative "child is dead"
  let pendingResize = null; // a resize that arrived while the spawn was deferred
  let ws = null;
  // Pre-flight "is the agent installed?" check (FR-3): set the moment
  // spawnPty() discovers `file` doesn't resolve on the spawn PATH. Once true,
  // spawnPty() never attempts pty.spawn again — the banner has already been
  // queued (see checkAgentInstalled below); only WHEN the session actually
  // ends differs by launch shape (see the two call sites).
  let agentMissing = false;
  let cachedSpawnEnv = null; // resolveSpawnEnv() does a bounded subprocess call — compute once
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

  /** Write lines into the terminal stream (buffered until the link is open). */
  function writeLines(text) {
    if (!text) return;
    const buf = Buffer.from(text, "utf8");
    bytesOut += buf.length;
    outputBatcher.queueBinary(buf);
  }

  // A resume whose folder isn't on this Mac: the line goes out the moment the
  // relay link opens, and the session ends there (see the ws "open" handler).
  if (folderFailure) {
    writeLines(failureLines(folderFailure, { home: os.homedir(), agent: AGENT, folder: HINT }).join(""));
  }

  // Whether the browser leg is paired right now (peer-reattached / -degraded).
  let peerPaired = false;
  /** @type {Array<() => void>} */
  let peerWaiters = [];
  function waitForPeer(ms) {
    if (peerPaired) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        peerWaiters = peerWaiters.filter((w) => w !== done);
        resolve();
      }
      peerWaiters.push(done);
    });
  }

  function shutdown(code, why) {
    if (shuttingDown) return;
    shuttingDown = true;
    removeAgentFiles();
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
   * Pre-flight "is the chosen agent actually installed?" (FR-3): checks the
   * SAME PATH the real spawn below will use. On a miss, queues ONE calm
   * banner line into the output stream (never `command not found`) and sets
   * `agentMissing` so spawnPty() never attempts pty.spawn. Runs exactly once
   * — cheap the second time either way since spawnPty() itself no-ops once
   * `agentMissing` is set.
   * @returns {boolean} true iff the agent resolved and spawning may proceed
   */
  function checkAgentInstalled() {
    cachedSpawnEnv = cachedSpawnEnv || resolveSpawnEnv();
    if (isBinaryInstalled(file, cachedSpawnEnv.PATH)) return true;
    agentMissing = true;
    log("error", "agent binary not found on PATH — not spawning", { agent: AGENT, file });
    const banner = Buffer.from(agentNotInstalledBanner(AGENT), "utf8");
    bytesOut += banner.length;
    outputBatcher.queueBinary(banner);
    return false;
  }

  /**
   * Spawn the PTY and wire its handlers. Called immediately only for a
   * promptless launch that wants no board agents (an explicit command); a
   * resume waits for the agents fetch, and a prompt-carrying launch spawns ONLY
   * after the relay's `attached` confirmation (R1 — see below).
   * The prompt is one argv element in `spawnArgs`; it is deliberately NOT
   * logged (only its length is).
   */
  function spawnPty(cwd = CWD) {
    if (term || shuttingDown || agentMissing || folderFailure) return;
    if (!cwd) {
      // Never "/" or the helper's own folder (card 6b2cb8ac): no folder, no spawn.
      log("error", "no project folder resolved — not spawning");
      if (open) shutdown(1, "folder-lookup-failed");
      return;
    }
    if (!checkAgentInstalled()) {
      // Nothing to spawn — FR-3: no `command not found`, no half-started
      // session. For a PROMPT-carrying launch this runs after the relay's
      // `attached` frame, so the socket is already open and the banner (just
      // queued above) can be flushed and the session ended right away. For a
      // PROMPTLESS launch this runs BEFORE the relay socket ever opens (see
      // the top-level promptless spawnPty() calls) — the banner is queued
      // into preOpenBuffer instead, `open` is still false here, so we simply
      // return and let the normal flow continue to openRelay(); the ws
      // "open" handler below flushes the banner and ends the session once
      // both have happened (it checks `agentMissing` for exactly this case).
      if (open) shutdown(1, "agent-not-installed");
      return;
    }
    log("info", "spawning PTY", {
      file,
      args: cmdArgs,
      cwd,
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
        cwd,
        env: cachedSpawnEnv,
      });
    } catch (e) {
      log("error", "PTY spawn failed", { err: String(e?.message || e) });
      if (open) shutdown(1, "spawn-failed");
      else process.exit(1);
      return;
    }
    term = spawned;
    const spawnedAt = Date.now();

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
    // Task 5b8a3865: the "your sessions share this folder" note goes out FIRST,
    // through the same batcher (so it's coalesced/encrypted like any other
    // output and buffered pre-open like a startup banner), ahead of whatever
    // Claude Code prints. Written once, only on a fallback launch.
    if (WORKTREE_FALLBACK_BANNER) {
      const banner = Buffer.from(WORKTREE_FALLBACK_BANNER, "utf8");
      bytesOut += banner.length;
      outputBatcher.queueBinary(banner);
    }

    term.onData((data) => {
      const buf = Buffer.from(data, "utf8");
      bytesOut += buf.length;
      outputBatcher.queueBinary(buf);
    });

    term.onExit(({ exitCode, signal }) => {
      ptyExited = true; // lets an in-flight kill escalation confirm instantly
      log("info", "PTY exited", { exitCode, signal });
      // Card 6b2cb8ac: an agent that quits within seconds, without saying why
      // on screen, gets a plain line and its own end reason, so the page shows
      // "stopped on your Mac straight away" (with no Resume) instead of a
      // generic end.
      if (!shuttingDown && Date.now() - spawnedAt < EARLY_EXIT_MS) {
        const code = Number.isInteger(exitCode) ? exitCode : 0;
        const line = Buffer.from(earlyExitLine(AGENT, code), "utf8");
        bytesOut += line.length;
        outputBatcher.queueBinary(line);
        shutdown(0, `agent-stopped-early:${code}`);
        return;
      }
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

  // Clean teardown on Ctrl-C / kill. Registered BEFORE the first await below:
  // with no handler a SIGTERM kills the process outright (no exit handlers), so
  // the Codex role-file folder written right after the agents fetch would be
  // left behind if it landed during the login-shell PATH lookup that follows.
  // shutdown() is safe this early: every binding it reads is declared above, and
  // with no PTY yet it just closes up and exits.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      log("info", "received signal", { sig });
      shutdown(0, sig);
    });
  }

  // R1 SEQUENCING. A promptless launch spawns first only when it wants no board
  // agents (an explicit command). A resume wants them on its command line, so it
  // waits for the fetch below. A URL-carried prompt is different again: it must
  // NEVER reach a child process unless the relay has accepted the owner-bound
  // token, and the relay REJECTS bad legs by accept()ing then immediately
  // closing (4005/4006/…) — so `open` alone proves nothing. The spawn is
  // therefore gated on the relay's explicit `attached` control frame, sent only
  // after authorizeAttach + decideAttach pass. No frame → exit, zero spawn.
  if (MODE !== "fresh" && !WANTS_AGENTS) spawnPty();
  // E2EE key collection (FR-1/FR-5): a bounded, best-effort fetch BEFORE the
  // relay connect URL is built, so a successful fetch can announce `e2ee=1`
  // on THIS attach (and every reconnect reuses the SAME key — see
  // E2EE_KEY/E2EE_ENC/E2EE_DEC below, refreshed per attach in openRelay()).
  // Never blocks/gates the PTY spawn above (a resume spawns after, below) — only
  // delays this bridge's OWN relay connect by at most E2EE_KEY_FETCH_TIMEOUT_MS, and any output
  // produced meanwhile is safely queued in preOpenBuffer, not lost.
  // Fetched in parallel; the agents must land before the child spawns. A
  // prompt-carrying launch hasn't spawned yet (it waits for the relay's
  // `attached` frame); a resume is held until the fetch finishes (bounded by
  // SESSION_AGENTS_FETCH_TIMEOUT_MS, no agents on any failure).
  // Card 6b2cb8ac: a fresh launch also asks the app where this board's
  // project lives on this Mac, in parallel (bounded, null on any failure).
  const [E2EE_KEY, SESSION_AGENTS_BODY, WORKSPACE] = await Promise.all([
    fetchE2eeSessionKey(),
    fetchSessionAgents(),
    MODE === "fresh" ? fetchWorkspace() : Promise.resolve(null),
  ]);
  // A signal or helper-gone shutdown landed during the fetch: write no role
  // files, spawn nothing and don't dial the relay.
  if (shuttingDown) return;
  if (SESSION_AGENTS_BODY && !term) {
    const agentArgs = sessionAgentArgs(SESSION_AGENTS_BODY);
    if (agentArgs.length > 0) {
      sessionAgentFlags = agentArgs;
      spawnArgs = buildSpawnArgs(cmdArgs, sessionAgentFlags, PROMPT);
      log("info", "session agents collected", { agent: AGENT, flags: agentArgs.length });
    }
  }
  if (MODE !== "fresh" && WANTS_AGENTS && !term) spawnPty();
  if (E2EE_KEY) log("info", "e2ee key collected — this session will be encrypted");

  /**
   * FRESH LAUNCH (card 6b2cb8ac), run once on the relay's `attached` frame:
   * is the agent installed (no point downloading a project for a missing
   * CLI) → wait for the browser to be paired so the progress lines are seen →
   * resolve the folder on this Mac (saved → search → clone → new) → record it
   * for this Mac → tell the page → spawn there. Any failure writes its line(s)
   * first, then ends the session with its reason — never a silent death.
   */
  let freshStarted = false;
  async function startFreshLaunch() {
    if (freshStarted || term || shuttingDown) return;
    freshStarted = true;
    if (!checkAgentInstalled()) {
      shutdown(1, "agent-not-installed");
      return;
    }
    await waitForPeer(PEER_WAIT_MS);
    if (shuttingDown) return;
    const home = os.homedir();
    const progress = (event) => writeLines(progressLine(event, { home, agent: AGENT }));
    const res = await resolveWorkspaceFolder({
      hint: HINT,
      workspace: WORKSPACE,
      isResume: false,
      deps: {
        fs,
        homedir: home,
        now: () => Date.now(),
        onProgress: progress,
        log: (msg, extra) => log("info", msg, extra),
        clone: (cloneArgs) =>
          cloneRepo({
            ...cloneArgs,
            home,
            env: cachedSpawnEnv || resolveSpawnEnv(),
            run: runProbeSync,
            spawn: require("node:child_process").spawn,
            fs,
            onProgress: progress,
            log: (msg, extra) => log("info", msg, extra),
          }),
      },
    });
    if (shuttingDown) return;
    if (!res.ok) {
      const newFolder = WORKSPACE
        ? path.join(home, "projects", (WORKSPACE.repo ? WORKSPACE.repoFolderName : WORKSPACE.newFolderName) || "")
        : null;
      writeLines(failureLines(res, { home, agent: AGENT, folder: HINT, newFolder }).join(""));
      log("warn", "project folder not ready — not spawning", { reason: res.reason });
      shutdown(1, res.reason);
      return;
    }
    if (res.how === "cloned") progress({ kind: "clone-done" });
    CWD = res.path;
    log("info", "project folder ready", { how: res.how, cwd: res.path, alsoFound: res.alsoFound.length });
    if (WORKSPACE) await recordFolder(res.path, res.how);
    if (shuttingDown) return;
    // The page learns the folder from the bridge (plaintext metadata, like
    // host/conv). Text frames are never buffered, so only when the link is up.
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { outputBatcher.sendControl(encodeBridgeCwdFrame(res.path)); } catch { /* best effort */ }
    }
    // The page's prompt may still say "cd into your clone, or git clone…";
    // tell the agent it is already in the right place (local argv only).
    if (PROMPT && res.path !== realHint()) PROMPT = `${promptFolderNote(res)}\n\n${PROMPT}`;
    prepareLaunch(res.path, { isolateHere: WORKSPACE ? WORKSPACE.otherLiveSessionsOnThisMac > 0 : true });
    spawnPty(res.path);
  }
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
      shutdown(openedAtLeastOnce && !(MODE === "fresh" && !term) ? 0 : 1, "ws-close");
      return;
    }
    // Transient drop. Only worth reconnecting if there's a live child to preserve.
    if (!claudeAlive()) {
      shutdown(openedAtLeastOnce && !(MODE === "fresh" && !term) ? 0 : 1, "ws-close");
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
        if (MODE === "fresh") {
          startFreshLaunch().catch((e) => {
            log("error", "fresh launch failed", { err: String(e?.stack || e) });
            shutdown(1, "fatal");
          });
        }
        return;
      }
      // Grace-window notices (relay holding / pair restored). Informational for the
      // bridge — the child keeps running regardless; recognised so they don't log as
      // "unknown". Skew-safe: an old relay simply never sends them.
      if (isPeerDegradedFrame(text)) {
        peerPaired = false;
        log("debug", "relay reports peer degraded (holding session)");
        return;
      }
      if (isPeerReattachedFrame(text)) {
        peerPaired = true;
        for (const w of [...peerWaiters]) w();
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
      if (MODE === "fresh" && !term && !freshStarted && !attachTimer) {
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
      // FR-3, promptless-launch case: checkAgentInstalled() ran (and queued
      // its banner into preOpenBuffer, just flushed above) BEFORE the socket
      // ever opened, so the session could only be ended here — now that the
      // banner has actually reached the wire.
      if (agentMissing) {
        shutdown(1, "agent-not-installed");
        return;
      }
      // Card 6b2cb8ac: same for a resume whose folder isn't on this Mac.
      if (folderFailure) {
        shutdown(1, folderFailure.reason);
        return;
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

}

let shutdownRef = null; // set by main() once its shutdown() closure exists

main().catch((e) => {
  log("error", "fatal", { err: String(e?.stack || e) });
  if (shutdownRef) shutdownRef(1, "fatal");
  else process.exit(1);
});
