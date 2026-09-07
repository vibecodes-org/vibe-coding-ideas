// VibeCodes macOS helper — SLICE 7 (the "install once" piece) + card cc74a067
// (helper lifecycle: quit-when-idle, crash handling, the standing control
// connection, and the "Keep helper ready" always-on opt-in).
//
// A thin, installable, URL-scheme-registered wrapper around the existing
// terminal/bridge. Its jobs:
//
//   1. Register the `vibecodes://` URL scheme so the OS routes the app's signed
//      deep link here (Info.plist CFBundleURLTypes is emitted by electron-builder
//      from `protocols` — see electron-builder.yml; we also call
//      app.setAsDefaultProtocolClient at runtime for dev/registration).
//   2. On `vibecodes://launch?relay&session&token[&helperToken][&cwd]`, run the
//      EXISTING bridge logic with that URL as `--launch-url`. We do NOT
//      re-implement the PTY/relay plumbing — we `fork` terminal/bridge/src/
//      index.js using Electron-as-Node (ELECTRON_RUN_AS_NODE=1). node-pty 1.x
//      is N-API (ABI-stable across Node and Electron) so its prebuilt pty.node
//      loads unchanged; the bridge itself does the macOS spawn-helper chmod.
//   3. Hold a SEPARATE, standing, per-owner CONTROL connection to the relay
//      (design §2/§3) for the whole process lifetime — carrying stop/quiesce/
//      set-always-on commands in and presence/version/always-on out. This is
//      independent of any bridge child: it opens at launch (from a fresh deep
//      link's `helperToken`, or a persisted one on a login-item restart) and
//      stays open through both "Active" (bridges running) and "Lingering"
//      (idle, counting down) states.
//   4. Manage its own lifecycle (design §1 decision 2): quit-when-idle by
//      default (a 60s linger after the last bridge exits — see lifecycle.js),
//      or never quit while "Keep helper ready" (always-on) is on, in which
//      case it also registers as a login item and shows a menu-bar icon
//      (design §5b).
//   5. Crash log-and-exit: an uncaught error is written to a log file, best-
//      effort goodbye'd to the relay, and the process exits — never a native
//      dialog (design §1 decision 5).
//
// Headless background helper: no window, no dock icon.

const {
  app,
  dialog,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} = require("electron");
const { fork, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { shouldRegisterProtocolInDev } = require("./proto-reg");
const lifecycle = require("./lifecycle");
const { TRAY_ICON_PNG_BASE64 } = require("./tray-icon");

const LAUNCH_PREFIX = "vibecodes://";

// This helper's OWN version — the single source of truth for the update-nudge
// feature (release-gate rework 2a/2b) AND the version this helper announces on
// its own control connection (helper/status's `version` field). Forked through
// to the bridge as BRIDGE_HELPER_VERSION below; the bridge announces it to the
// relay too, via its own bridge leg. Bump THIS package.json's `version` on
// every release — nothing else needs touching for the announced version to
// follow.
const HELPER_VERSION = require("./package.json").version;

// ── where the reused bridge + shared modules live ────────────────────────────
// Packaged: copied into the app bundle under Resources/ via electron-builder
// `extraResources` (kept OUTSIDE app.asar so node-pty's native pty.node + the
// spawn-helper binary stay executable on disk). Dev: straight from the repo.
const BRIDGE_ENTRY = app.isPackaged
  ? path.join(process.resourcesPath, "bridge", "src", "index.js")
  : path.resolve(__dirname, "..", "bridge", "src", "index.js");

const SHARED_DEEPLINK = app.isPackaged
  ? path.join(process.resourcesPath, "shared", "deep-link.mjs")
  : path.resolve(__dirname, "..", "shared", "deep-link.mjs");

const SHARED_REAP = app.isPackaged
  ? path.join(process.resourcesPath, "shared", "reap.mjs")
  : path.resolve(__dirname, "..", "shared", "reap.mjs");

const SHARED_ALLOWLIST = app.isPackaged
  ? path.join(process.resourcesPath, "shared", "relay-allowlist.mjs")
  : path.resolve(__dirname, "..", "shared", "relay-allowlist.mjs");

// The helper role's mint/decode helpers (helperSessionId is baked into the
// token's own `sid` claim by mintHelperToken, so decodeTokenClaims is all this
// process needs to learn its own session id — see connectControl below).
const SHARED_SESSION_TOKEN = app.isPackaged
  ? path.join(process.resourcesPath, "shared", "session-token.mjs")
  : path.resolve(__dirname, "..", "shared", "session-token.mjs");

const SHARED_CONTROL_FRAMES = app.isPackaged
  ? path.join(process.resourcesPath, "shared", "control-frames.mjs")
  : path.resolve(__dirname, "..", "shared", "control-frames.mjs");

// Codex support (docs/codex-terminal-requirements.md FR-3/FR-11) — the shared
// PATH-resolution + binary-existence checks, same split as every other
// SHARED_* constant above.
const SHARED_SPAWN_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "shared", "spawn-path.mjs")
  : path.resolve(__dirname, "..", "shared", "spawn-path.mjs");

const SHARED_BINARY_CHECK = app.isPackaged
  ? path.join(process.resourcesPath, "shared", "binary-check.mjs")
  : path.resolve(__dirname, "..", "shared", "binary-check.mjs");

// terminal/helper's OWN modules (ship inside app.asar alongside main.js via
// electron-builder.yml's `files:` list — NOT extraResources). __dirname
// already resolves correctly relative to main.js's own location whether
// packaged or not, so no app.isPackaged branch is needed here (unlike the
// SHARED_* constants above, which cross the asar/extraResources boundary).
const LOCAL_AGENT_AVAILABILITY = path.resolve(__dirname, "agent-availability.mjs");
const LOCAL_OPEN_TERMINAL = path.resolve(__dirname, "open-terminal.mjs");
const LOCAL_OPEN_TERMINAL_GATE = path.resolve(__dirname, "open-terminal-gate.mjs");
const LOCAL_CONTROL_URL = path.resolve(__dirname, "control-url.mjs");

// The control connection is plain `ws` — the SAME package the bridge already
// depends on (terminal/bridge/package.json), shipped alongside it under
// Resources/bridge/node_modules by the SAME extraResources copy that ships the
// bridge itself (electron-builder.yml never excludes node_modules there). No
// new dependency: this just resolves the one bridge/src/index.js already uses,
// exactly like BRIDGE_ENTRY above reuses the bridge's own code.
const WS_MODULE = app.isPackaged
  ? path.join(process.resourcesPath, "bridge", "node_modules", "ws")
  : path.resolve(__dirname, "..", "bridge", "node_modules", "ws");
const WebSocket = require(WS_MODULE);

// ── logging (metadata only — NEVER log the deep-link token) ───────────────────
const t0 = Date.now();
function log(level, msg, extra) {
  const rec = { t: ((Date.now() - t0) / 1000).toFixed(2) + "s", level, comp: "helper", msg, ...extra };
  process.stderr.write(JSON.stringify(rec) + "\n");
}

// Lazily import the shared (ESM) parser/redactor once. Reused — not duplicated.
let _shared = null;
async function shared() {
  if (!_shared) _shared = await import(pathToFileURL(SHARED_DEEPLINK).href);
  return _shared;
}

// Lazily import the shared verified-kill escalation (same module the bridge uses).
let _reap = null;
async function reapMod() {
  if (!_reap) _reap = await import(pathToFileURL(SHARED_REAP).href);
  return _reap;
}

// Lazily import the shared relay-host allowlist (same module + predicate the
// bridge's own gate uses — single source of truth).
let _allowlist = null;
async function allowlistMod() {
  if (!_allowlist) _allowlist = await import(pathToFileURL(SHARED_ALLOWLIST).href);
  return _allowlist;
}

let _sessionToken = null;
async function sessionTokenMod() {
  if (!_sessionToken) _sessionToken = await import(pathToFileURL(SHARED_SESSION_TOKEN).href);
  return _sessionToken;
}

let _controlFrames = null;
async function controlFramesMod() {
  if (!_controlFrames) _controlFrames = await import(pathToFileURL(SHARED_CONTROL_FRAMES).href);
  return _controlFrames;
}

let _spawnPath = null;
async function spawnPathMod() {
  if (!_spawnPath) _spawnPath = await import(pathToFileURL(SHARED_SPAWN_PATH).href);
  return _spawnPath;
}

let _binaryCheck = null;
async function binaryCheckMod() {
  if (!_binaryCheck) _binaryCheck = await import(pathToFileURL(SHARED_BINARY_CHECK).href);
  return _binaryCheck;
}

let _agentAvailability = null;
async function agentAvailabilityMod() {
  if (!_agentAvailability) _agentAvailability = await import(pathToFileURL(LOCAL_AGENT_AVAILABILITY).href);
  return _agentAvailability;
}

let _openTerminal = null;
async function openTerminalMod() {
  if (!_openTerminal) _openTerminal = await import(pathToFileURL(LOCAL_OPEN_TERMINAL).href);
  return _openTerminal;
}

let _openTerminalGate = null;
async function openTerminalGateMod() {
  if (!_openTerminalGate) _openTerminalGate = await import(pathToFileURL(LOCAL_OPEN_TERMINAL_GATE).href);
  return _openTerminalGate;
}

let _controlUrl = null;
async function controlUrlMod() {
  if (!_controlUrl) _controlUrl = await import(pathToFileURL(LOCAL_CONTROL_URL).href);
  return _controlUrl;
}

/**
 * Check which known agents are installed, using the SAME PATH-resolution
 * algorithm the bridge uses for its own pre-flight (FR-3) — resolved and
 * injected HERE (never left to agent-availability.mjs's own dev/test-only
 * fallback import) so this call never depends on a relative import crossing
 * the asar/extraResources boundary in the packaged app (see
 * agent-availability.mjs's own header comment for the full reasoning).
 * @returns {Promise<{ claude: boolean, codex: boolean }>}
 */
async function checkAgentAvailabilityForHelper() {
  const [{ resolveLoginShellPath }, { isBinaryInstalled }, { checkAgentAvailability }] = await Promise.all([
    spawnPathMod(),
    binaryCheckMod(),
    agentAvailabilityMod(),
  ]);
  return checkAgentAvailability({
    resolveLoginShellPathImpl: resolveLoginShellPath,
    isBinaryInstalledImpl: isBinaryInstalled,
  });
}

// ── userData persistence (settings + the last control credentials) ───────────
// Both are small, best-effort JSON files under the helper's own userData dir —
// never anything sensitive beyond the short-lived control token itself (a
// device credential, not a password). A missing/corrupt file is treated
// exactly like "nothing persisted yet"; a write failure is logged and ignored
// (nothing here is load-bearing for this launch — only for a LATER restart).
function settingsPath() {
  return path.join(app.getPath("userData"), "helper-settings.json");
}
function controlCredentialsPath() {
  return path.join(app.getPath("userData"), "helper-control-credentials.json");
}
function crashLogPath() {
  return path.join(app.getPath("userData"), "helper-crash.log");
}

/** @returns {{ alwaysOn: boolean }} */
function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { alwaysOn: raw?.alwaysOn === true };
  } catch {
    return { alwaysOn: false };
  }
}
function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings), "utf8");
  } catch (e) {
    log("warn", "could not persist helper settings", { err: String(e?.message || e) });
  }
}

/** @returns {{ token: string, relay: string } | null} */
function loadControlCredentials() {
  try {
    const raw = JSON.parse(fs.readFileSync(controlCredentialsPath(), "utf8"));
    if (typeof raw?.token === "string" && typeof raw?.relay === "string") return raw;
    return null;
  } catch {
    return null;
  }
}
function saveControlCredentials(creds) {
  try {
    fs.mkdirSync(path.dirname(controlCredentialsPath()), { recursive: true });
    fs.writeFileSync(controlCredentialsPath(), JSON.stringify(creds), "utf8");
  } catch (e) {
    log("warn", "could not persist control credentials", { err: String(e?.message || e) });
  }
}

// ── crash handling (design §1 decision 5: log-and-exit, never a dialog) ──────
// Registered FIRST, before anything else runs, so even a startup-time throw is
// caught. Node shows its own fatal-error stack trace + exit(1) ONLY when
// `uncaughtException` has NO listener — attaching this one IS the suppression
// (there is no separate Electron dialog to additionally silence for a plain
// main-process JS exception; the risk this guards against is a future
// dependency adding one, or a renderer-side crash reporter default).
let crashing = false;
function handleCrash(kind, err) {
  if (crashing) return; // a crash during crash handling — don't loop
  crashing = true;
  const message = err?.stack || err?.message || String(err);
  try {
    fs.mkdirSync(path.dirname(crashLogPath()), { recursive: true });
    fs.appendFileSync(
      crashLogPath(),
      `[${new Date().toISOString()}] ${kind}: ${message}\n`,
      "utf8",
    );
  } catch {
    /* best effort — a failed crash log must never block the exit below */
  }
  cleanupPendingOpenTerminalScriptsSync();
  log("error", "crash — logging and exiting", { kind, err: message });
  // Best-effort goodbye — no await (the event loop may be unhealthy); a failed
  // send just means this disconnect is later classed "stopped unexpectedly",
  // which is the honest outcome for an actual crash anyway.
  try {
    sendGoodbye("crash");
  } catch {
    /* ignore */
  }
  // Kill child bridges directly — no verified-kill escalation here (that's an
  // async, multi-second process this handler cannot safely wait through); the
  // crash log preserves diagnosability if a grandchild is left needing a
  // manual sweep, which is the same trade-off an external `kill -9` already has.
  for (const child of children) {
    try { child.kill(); } catch { /* ignore */ }
  }
  app.exit(1);
}
process.on("uncaughtException", (err) => handleCrash("uncaughtException", err));
process.on("unhandledRejection", (reason) => handleCrash("unhandledRejection", reason));

// ── child-bridge bookkeeping + quit-when-idle (design §1/§2) ─────────────────
const children = new Set();
// bridge child -> its PTY child's pid (the grandchild — `claude`). Reported by
// the bridge over IPC ({type:"pty-pid"}) right after its pty.spawn. Needed
// because the grandchild is its OWN session/group leader (spawn-helper setsid):
// if the bridge dies uncleanly (SIGKILL — it can run no cleanup), WE are the
// only thing left that can verify the grandchild died and escalate if not.
const ptyPids = new Map();
// In-flight grandchild verifications. The linger timer must not conclude the
// helper is safe to quit — and before-quit must not let the process vanish —
// while one is pending.
const activeReaps = new Set();
let quitting = false;
let quitReason = "quit"; // default if app.quit() is ever reached some other way
let lingerTimer = null;
const REAP_HUP_WAIT_MS = 1000; // grandchild SIGHUP grace before SIGKILL(+group)

// "Keep helper ready" (design §1 decision 1/§3 follow-up, approved for v1 —
// see the card's design-review note). Loaded synchronously at module load so
// every code path below (including the very first updateLingerTimer() call)
// sees the persisted value from the start, not a default that flips under it
// a tick later.
let alwaysOn = loadSettings().alwaysOn;

/**
 * (Re)decide the linger timer given the CURRENT bridge count + always-on
 * setting — see lifecycle.js for the pure rule. Called on every bridge-count
 * change and every always-on change.
 */
function updateLingerTimer() {
  if (quitting) return;
  const action = lifecycle.decideLingerAction({ bridgeCount: children.size, alwaysOn });
  if (action === "cancel") {
    if (lingerTimer) {
      clearTimeout(lingerTimer);
      lingerTimer = null;
    }
    return;
  }
  // action === "start": (re)arm a fresh window — a new deep link / session
  // during an existing linger cancels then restarts it via this same path.
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    if (activeReaps.size > 0) return; // still verifying a grandchild; its own
    // completion below calls updateLingerTimer() again, which re-arms us.
    if (!lifecycle.shouldQuitOnLingerExpiry({ bridgeCount: children.size, alwaysOn })) return;
    log("info", "idle for the linger window — quitting", { ms: lifecycle.LINGER_MS });
    beginCleanQuit("idle-quit");
  }, lifecycle.LINGER_MS);
  lingerTimer.unref?.();
}

/**
 * Verify a dead bridge's PTY grandchild actually died; escalate
 * SIGHUP → (1s) → SIGKILL(+process group) if not. Bounded (~1.6s worst case).
 * This is the ONLY cleanup path when the bridge is SIGKILL'd (matrix row c).
 */
function reapGrandchild(pid, why) {
  const p = (async () => {
    const { pidAlive, reapPidGroupEscalated } = await reapMod();
    if (!pidAlive(pid)) {
      log("debug", "grandchild already dead", { pid, why });
      return;
    }
    log("warn", "bridge gone but its PTY child is still alive — escalating", { pid, why });
    const res = await reapPidGroupEscalated(pid, { hupWaitMs: REAP_HUP_WAIT_MS, termWaitMs: 0 });
    log(res.confirmedDead ? "info" : "error", "grandchild reap finished", {
      pid,
      stage: res.stage,
      confirmedDead: res.confirmedDead,
    });
  })().catch((err) => {
    log("error", "grandchild reap failed", { pid, err: String(err?.message || err) });
  });
  activeReaps.add(p);
  p.finally(() => {
    activeReaps.delete(p);
    updateLingerTimer();
    refreshTray();
  });
  return p;
}

/**
 * Hand a `vibecodes://launch?…` URL to the existing bridge. Validates with the
 * SHARED parser first (so we never fork on garbage), then forks the bridge with
 * `--launch-url`. The bridge re-parses the same string (single source of truth)
 * and connects as the relay's bridge leg. Also (re)establishes the standing
 * control connection from the link's `helperToken`, when present — see
 * connectControl below; an already-connected helper treats a redundant one as
 * a no-op (the deep-link module's own doc comment).
 */
async function handleLaunchUrl(rawUrl) {
  const { parseLaunchDeepLink, redactDeepLinkToken } = await shared();
  const parsed = parseLaunchDeepLink(rawUrl);
  if (!parsed) {
    log("warn", "ignoring non-launch / malformed vibecodes:// url", {
      url: redactDeepLinkToken(rawUrl),
    });
    return;
  }

  // RELAY-HOST ALLOWLIST (first-line reject, so we never fork on a hostile host).
  // `relay=` is attacker-controllable — any web page can fire this deep link. Pin
  // the dial target to the prod relay (loopback allowed only in dev). The forked
  // bridge re-checks with the SAME predicate (single source of truth); this early
  // reject just avoids spending a fork on a doomed launch. Log the HOST ONLY.
  const { isRelayHostAllowed } = await allowlistMod();
  if (!isRelayHostAllowed(parsed.relay, { allowLoopback: !app.isPackaged })) {
    let host = "unparseable";
    try { host = new URL(parsed.relay).host; } catch { /* never echo the token */ }
    log("error", "relay host not allowed — refusing to launch bridge", { host });
    return;
  }

  log("info", "launching bridge for deep link", { url: redactDeepLinkToken(rawUrl) });

  // Every launch that carries a helperToken (re)establishes/refreshes the
  // control connection — persisting the credential so a later LaunchAgent
  // restart (no deep link at all) can reconnect with the SAME token.
  if (parsed.helperToken) {
    saveControlCredentials({ token: parsed.helperToken, relay: parsed.relay });
    void connectControl(parsed.relay, parsed.helperToken);
  }

  // ELECTRON_RUN_AS_NODE=1 → the forked process is plain Node (Electron's bundled
  // runtime), so the bridge runs exactly as it does from the CLI. We pass our env
  // through verbatim so test seams (e.g. BRIDGE_CMD) keep working; in production
  // the bridge defaults the spawned command to `claude`.
  const child = fork(BRIDGE_ENTRY, ["--launch-url", rawUrl], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      // Signal the bridge's OWN allowlist gate whether we're packaged. Packaged
      // → loopback + any non-prod host rejected; dev → loopback allowed. Keeps
      // the two gates (helper here + bridge) in lockstep.
      VIBECODES_PACKAGED: app.isPackaged ? "1" : "",
      // This helper's version, so the forked bridge announces IT (not its own
      // bridge/package.json version) to the relay — single source of truth.
      BRIDGE_HELPER_VERSION: HELPER_VERSION,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  updateLingerTimer();
  refreshTray();

  // Surface the bridge's structured logs on our stderr (already token-redacted by
  // the bridge). Never touch stream content.
  const relay = (line) => { if (line.trim()) process.stderr.write(line.endsWith("\n") ? line : line + "\n"); };
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", relay);
  child.stderr?.on("data", relay);

  // The bridge reports its PTY child's pid over IPC so we can verify-kill the
  // grandchild if the bridge itself dies uncleanly.
  child.on("message", (m) => {
    if (m && m.type === "pty-pid" && Number.isInteger(m.pid) && m.pid > 0) {
      ptyPids.set(child, m.pid);
      log("debug", "recorded bridge's pty pid", { pid: m.pid });
    }
  });

  child.on("exit", (code, signal) => {
    children.delete(child);
    log("info", "bridge exited", { code, signal, active: children.size });
    // Trust nothing: whatever the bridge's exit looked like, VERIFY the
    // grandchild is gone (reapGrandchild registers in activeReaps synchronously,
    // so the linger timer's fire callback above cannot conclude "safe to quit"
    // before the verification completes).
    const ptyPid = ptyPids.get(child);
    ptyPids.delete(child);
    if (ptyPid) reapGrandchild(ptyPid, `bridge-exit code=${code} signal=${signal}`);
    updateLingerTimer();
    refreshTray();
  });
  child.on("error", (err) => {
    children.delete(child);
    log("error", "bridge failed to start", { err: String(err?.message || err) });
    const ptyPid = ptyPids.get(child);
    ptyPids.delete(child);
    if (ptyPid) reapGrandchild(ptyPid, "bridge-error");
    updateLingerTimer();
    refreshTray();
  });
}

/**
 * Route a `vibecodes://…` link to the right handler based on its action —
 * `launch` (the existing invisible-bridge path, unchanged) or `open-terminal`
 * (Codex support, FR-11: a NEW action that opens a real Terminal.app window —
 * see handleOpenTerminalUrl below). Called from every place a link can
 * arrive (open-url, second-instance, cold-launch argv) so both actions work
 * everywhere `launch` already did. An unrecognised action (old link shape, a
 * future action this build doesn't know, or plain garbage) is a no-op —
 * skew-safe in both directions, same posture as every unknown deep-link
 * param elsewhere in this codebase.
 */
async function handleDeepLink(rawUrl) {
  const { parseLaunchDeepLink, parseOpenTerminalDeepLink, redactDeepLinkToken } = await shared();
  if (parseLaunchDeepLink(rawUrl)) return handleLaunchUrl(rawUrl);
  if (parseOpenTerminalDeepLink(rawUrl)) return handleOpenTerminalUrl(rawUrl);
  log("warn", "ignoring unrecognised vibecodes:// url", { url: redactDeepLinkToken(rawUrl) });
}

// ── Desktop Codex: `vibecodes://open-terminal?…` (FR-11, US-10) ─────────────
//
// Opens a REAL Terminal.app window running `codex` in a folder — a
// completely different animal from `launch` above: nothing is minted, no
// relay session, no invisible bridge fork. See terminal/helper/open-terminal.mjs
// for the script-building/quoting logic and the security properties it
// enforces (fixed binary, shell's own post-cd pwd, prompt as one argv
// element, the S-5 "press Enter" safeguard). This function does the
// surrounding I/O: temp-file hygiene, the `open` invocation, and the
// pre-flight/failure/spam guards the requirements demand (FR-13, AC-16/17,
// security note).

/** How long a temp launch script is allowed to survive on disk as a fallback
 *  net (FR-11 hygiene) — the script's OWN first action is to self-delete, so
 *  this only matters if Terminal never got the chance to run it at all. */
const OPEN_TERMINAL_SCRIPT_CLEANUP_MS = 5 * 60 * 1000;
/** The fixed prefix randomScriptFilename() always uses — the sweep below
 *  matches on it, never a full guess of the random suffix. */
const OPEN_TERMINAL_SCRIPT_PREFIX = "vibecodes-codex-";
/** One review window "in flight" at a time (security note: "guard
 *  window-spam / ignore repeats within a few seconds"). Approximated with a
 *  fixed cooldown — the helper has no feedback channel to know when the user
 *  actually presses Enter or closes the window in Terminal.app. Generous
 *  enough to cover a real "read this, then decide" interaction; short enough
 *  that a genuine second attempt (the first window was missed/closed) isn't
 *  locked out for long. */
const OPEN_TERMINAL_COOLDOWN_MS = 20_000;
let openTerminalCooldownUntil = 0;
/** Scripts written but not yet confirmed self-deleted — best-effort cleanup
 *  on quit/crash in addition to the fallback timer and the next-start sweep. */
const pendingOpenTerminalScripts = new Set();

/**
 * Best-effort native notification for a failure the pre-flight couldn't
 * predict (FR-13's fallback path; the not-installed case is normally caught
 * BEFORE the click on the app side per UX design §12d — this only fires for
 * something that changed since the last status report, or another failure
 * class entirely). Minimum v1 delivery per FR-13.
 *
 * NOT IMPLEMENTED in this slice: also reporting the reason back over the
 * standing control connection so the BROWSER shows the same message (FR-13's
 * "nice-to-have… made the normal path" per the UX design rework) — that
 * needs a new control-frame type plus relay storage/forward plus an app-side
 * listener, a three-way protocol change beyond this slice's scope. The
 * native notification here is the only channel for now; see the
 * implementation report.
 * @param {string} message
 */
function reportOpenTerminalFailure(message) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: "VibeCodes", body: message }).show();
    }
  } catch (e) {
    log("warn", "could not show open-terminal failure notification", { err: String(e?.message || e) });
  }
}

/** Remove any leftover launch scripts from a PREVIOUS run (a crash, or a
 *  link that never got as far as `open`) — FR-11's "removed … on next helper
 *  start" hygiene requirement. A leftover script's self-delete line never ran
 *  (that's WHY it's still there), so it is always safe to remove. */
function sweepStaleOpenTerminalScripts() {
  try {
    const dir = app.getPath("temp");
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(OPEN_TERMINAL_SCRIPT_PREFIX) && name.endsWith(".command")) {
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* already gone, or a permissions race — not fatal */ }
      }
    }
  } catch (e) {
    log("warn", "could not sweep stale open-terminal launch scripts", { err: String(e?.message || e) });
  }
}

/** Best-effort synchronous cleanup of any scripts this process itself wrote
 *  but never confirmed gone — called from the quit/crash paths, where an
 *  async cleanup can't be awaited safely. */
function cleanupPendingOpenTerminalScriptsSync() {
  for (const p of pendingOpenTerminalScripts) {
    try { fs.unlinkSync(p); } catch { /* already gone, or Terminal is still using it — leave it for the next sweep */ }
  }
  pendingOpenTerminalScripts.clear();
}

async function handleOpenTerminalUrl(rawUrl) {
  const { parseOpenTerminalDeepLink, redactDeepLinkToken } = await shared();
  const parsed = parseOpenTerminalDeepLink(rawUrl);
  if (!parsed) {
    log("warn", "ignoring malformed vibecodes://open-terminal url", { url: redactDeepLinkToken(rawUrl) });
    return;
  }

  // RELAY-HOST ALLOWLIST — same first-line reject as handleLaunchUrl, before
  // anything else. `relay=` is attacker-controllable. Checked BEFORE the
  // spam cooldown below is armed — cheap basic validation, so a malformed
  // link never costs a legitimate later request its cooldown window
  // (security note's self-DoS concern).
  const { isRelayHostAllowed } = await allowlistMod();
  if (!isRelayHostAllowed(parsed.relay, { allowLoopback: !app.isPackaged })) {
    let host = "unparseable";
    try { host = new URL(parsed.relay).host; } catch { /* never echo the token */ }
    log("error", "relay host not allowed — refusing open-terminal request", { host });
    return;
  }

  // Local shape/role sanity check ONLY (defense in depth, never the gate —
  // see the doc block below). Also checked before the cooldown is armed.
  const { decodeTokenClaims } = await sessionTokenMod();
  const claims = decodeTokenClaims(parsed.helperToken);
  if (claims?.role !== "helper" || !claims?.sid) {
    log("error", "open-terminal helperToken is not a well-formed helper-role token — refusing");
    return;
  }

  // Window-spam guard — see OPEN_TERMINAL_COOLDOWN_MS's doc above. Armed only
  // once the request has cleared the cheap checks above, so a malformed/
  // disallowed link can't burn a legitimate request's cooldown window; a
  // request that reaches here is about to do real (if bounded) work — a
  // relay round trip, a codex PATH check — so everything past this point is
  // exactly what the cooldown exists to rate-limit.
  const now = Date.now();
  if (now < openTerminalCooldownUntil) {
    log("warn", "ignoring open-terminal request — one is already in flight");
    return;
  }
  openTerminalCooldownUntil = now + OPEN_TERMINAL_COOLDOWN_MS;

  // SECURITY FIX (Finding 1 — CRITICAL): the helper holds no copy of
  // TERMINAL_SESSION_SECRET, so it can NEVER verify the token's signature
  // itself — decodeTokenClaims above is a cheap shape/role check only, not
  // authorization. Only the RELAY can authoritatively verify this token (via
  // authorizeAttach), so open a DEDICATED control socket carrying an explicit
  // `purpose=open-terminal` marker (connectOpenTerminalControl — NEVER the
  // primary connectControl; see that function's header comment for the live
  // regression this split fixes) and AWAIT its authenticated
  // `open-terminal-authorized` ack before writing anything to disk or
  // spawning `open -a Terminal`. A bare WebSocket "open" event does NOT prove
  // acceptance — the relay accept()s a bad token too, then closes it — so
  // this function must never treat connectOpenTerminalControl's return alone
  // as success; see open-terminal-gate.mjs for the wait itself. This is also
  // what lets a desktop-only user (who never fired a browser `launch` link)
  // get a control connection at all — the requirements' explicit note that
  // this link must carry helperToken.
  saveControlCredentials({ token: parsed.helperToken, relay: parsed.relay });

  // RACE FIX: pre-import the gate + frame-parser modules BEFORE opening the
  // socket, so `waitForOpenTerminalAuthorization` can attach its "message"
  // listener in the SAME synchronous tick the socket becomes available — no
  // `await` gap in between. Before this fix, these dynamic imports ran AFTER
  // the socket was opened, and an ack that arrived during that gap (reliably,
  // against the real relay) was silently dropped, always producing the full
  // 8s timeout and opening no window.
  const [{ waitForOpenTerminalAuthorization }, { isOpenTerminalAuthorizedFrame }] = await Promise.all([
    openTerminalGateMod(),
    controlFramesMod(),
  ]);
  const controlSocket = await connectOpenTerminalControl(parsed.relay, parsed.helperToken);
  if (!controlSocket) {
    log("error", "open-terminal — could not open a control connection to verify this request — refusing to open a window");
    reportOpenTerminalFailure("Couldn't verify this request with VibeCodes — nothing was opened.");
    return;
  }
  // No `await` between having the socket and listening — attach synchronously.
  const authorization = waitForOpenTerminalAuthorization(controlSocket, {
    isAuthorizedFrame: isOpenTerminalAuthorizedFrame,
  });
  try {
    await authorization;
  } catch (e) {
    log("error", "open-terminal request was not authorized by the relay — refusing to open a window", {
      err: String(e?.message || e),
    });
    reportOpenTerminalFailure("Couldn't verify this request with VibeCodes — nothing was opened.");
    return;
  } finally {
    // The handshake is a one-shot — close it the instant it settles (success,
    // rejection, or timeout), whichever branch is taken. Never lingers, and
    // never touches the primary controlWs.
    try { controlSocket.close(); } catch { /* already closing */ }
  }
  log("info", "open-terminal request authorized by relay");

  // Pre-flight "is codex installed?" (FR-13) — checked FRESH against the
  // real PATH, never trusted from an earlier control-connection announcement
  // alone (that report can be stale — UX design §12b step 5a).
  let availability;
  try {
    availability = await checkAgentAvailabilityForHelper();
  } catch (e) {
    log("error", "open-terminal pre-flight check failed — refusing to open a window", { err: String(e?.message || e) });
    reportOpenTerminalFailure("Couldn't check whether Codex is installed on this Mac.");
    return;
  }
  if (!availability.codex) {
    log("warn", "open-terminal refused — codex not found on PATH");
    reportOpenTerminalFailure("Codex isn't installed on this Mac.");
    return;
  }

  const [{ pathFallbackShellSnippet }, { buildOpenTerminalScript, randomScriptFilename }] = await Promise.all([
    spawnPathMod(),
    openTerminalMod(),
  ]);

  let scriptText;
  try {
    scriptText = buildOpenTerminalScript({
      cwd: parsed.cwd,
      prompt: parsed.prompt || "",
      pathFallbackSnippet: pathFallbackShellSnippet(),
    });
  } catch (e) {
    log("error", "could not build the open-terminal launch script", { err: String(e?.message || e) });
    reportOpenTerminalFailure("Couldn't prepare the Codex launch.");
    return;
  }

  const scriptPath = path.join(app.getPath("temp"), randomScriptFilename());
  try {
    fs.writeFileSync(scriptPath, scriptText, { mode: 0o700 });
  } catch (e) {
    log("error", "couldn't write the launch script — refusing to open a window", { err: String(e?.message || e) });
    reportOpenTerminalFailure("Couldn't prepare the Codex launch.");
    return;
  }
  pendingOpenTerminalScripts.add(scriptPath);

  execFile("open", ["-a", "Terminal", scriptPath], (err) => {
    if (err) {
      log("error", "`open -a Terminal` failed — nothing was started", { err: String(err?.message || err) });
      reportOpenTerminalFailure("Couldn't open a Terminal window for Codex.");
      // The script never got a chance to self-delete — clean up ourselves.
      try { fs.unlinkSync(scriptPath); } catch { /* already gone, or never existed */ }
      pendingOpenTerminalScripts.delete(scriptPath);
      return;
    }
    log("info", "opened Terminal for a desktop Codex launch");
    // Fallback net: the script self-deletes as ITS OWN first action once
    // Terminal actually runs it. If Terminal never got to it for any reason
    // (a permission prompt the user never answered, a Terminal preference
    // that delays execution, anything else unpredicted), don't leave the
    // temp file around forever.
    const cleanupTimer = setTimeout(() => {
      try { fs.unlinkSync(scriptPath); } catch { /* already gone — the normal, expected case */ }
      pendingOpenTerminalScripts.delete(scriptPath);
    }, OPEN_TERMINAL_SCRIPT_CLEANUP_MS);
    cleanupTimer.unref?.();
  });
}

// Pull a vibecodes:// link out of an argv array (cold launch on macOS dev /
// Windows, and the second-instance forward).
function urlFromArgv(argv) {
  return argv.find((a) => typeof a === "string" && a.startsWith(LAUNCH_PREFIX));
}

// ── the standing control connection (design §2/§3) ────────────────────────────
// One WebSocket, role=helper, on the owner's reserved session id — opened at
// launch (from a deep link's helperToken, or a persisted one) and held for the
// whole process lifetime. Hibernation-friendly: no client-side keepalive
// beyond what the relay's own WebSocket handling needs (mirrors the design's
// explicit "no client-side keepalive" note) — we only reconnect on an
// unexpected drop, with simple capped backoff, never a ping loop.
let controlWs = null;
let controlReconnectTimer = null;
let controlReconnectAttempt = 0;
const CONTROL_RECONNECT_BASE_MS = 2000;
const CONTROL_RECONNECT_MAX_MS = 30_000;
/** The relay's BAD_TOKEN close (terminal/shared/session-token.mjs RELAY_CLOSE) — auth, never transient. */
const CONTROL_AUTH_REJECTED_CLOSE_CODE = 4006;

/** Best-effort: send a goodbye frame if the control connection is currently open. */
async function sendGoodbye(reason) {
  if (!controlWs) return;
  try {
    const { encodeGoodbyeFrame } = await controlFramesMod();
    if (controlWs.readyState === WebSocket.OPEN) controlWs.send(encodeGoodbyeFrame(reason));
  } catch (e) {
    log("warn", "could not send goodbye frame", { reason, err: String(e?.message || e) });
  }
}

function closeControlConnection() {
  if (controlReconnectTimer) {
    clearTimeout(controlReconnectTimer);
    controlReconnectTimer = null;
  }
  const ws = controlWs;
  controlWs = null;
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch { /* already closing */ }
  }
}

/**
 * Look up a token's claims + a fresh agent-availability snapshot — the two
 * pieces of state both connectControl and connectOpenTerminalControl need
 * before they can build a connect URL. Pulled out so neither duplicates the
 * other's decode-and-probe logic.
 * @returns {Promise<{ claims: { sid?: string } | null, availability: { claude: boolean, codex: boolean } | null }>}
 */
async function resolveControlConnectInputs(token) {
  const { decodeTokenClaims } = await sessionTokenMod();
  const claims = decodeTokenClaims(token);

  // Codex support (FR-3's helper-side half): report which known agents are
  // installed on THIS attach — a fresh, best-effort check every time (not
  // cached across the helper's whole lifetime), so installing/upgrading an
  // agent while the helper keeps running is reflected on the NEXT reconnect
  // rather than never. Never blocks/fails the control connect itself: a
  // failed check just means "unknown" (both fields omitted), the same
  // graceful-degrade shape as every other optional query param here.
  let availability = null;
  try {
    availability = await checkAgentAvailabilityForHelper();
  } catch (e) {
    log("warn", "agent availability check failed — reporting unknown", { err: String(e?.message || e) });
  }
  return { claims, availability };
}

/**
 * Open (or re-open) the PRIMARY control connection to `relay` with the given
 * HELPER role token. A redundant call for the SAME (relay, token) while
 * already open is a no-op (the deep-link module's own contract for a repeat
 * launch). Returns the live `ws.WebSocket` it is using (the reused one, or a
 * freshly created one), or `null` if no connection was (re)established
 * (quitting, or an unparseable token).
 *
 * This is the ONLY function allowed to read or assign the module-level
 * `controlWs` — the desktop-Codex open-terminal handshake uses the
 * completely separate connectOpenTerminalControl() below precisely so it can
 * never disturb this connection or the live session it may be keeping alive
 * (regression fixed here, live-confirmed on Nick's Mac 6 Sep 2026: a
 * `purpose=open-terminal` call used to reuse this same function, which
 * unconditionally closed and replaced `controlWs`).
 *
 * @param {string} relayBase @param {string} token
 * @returns {Promise<import("ws").WebSocket | null>}
 */
async function connectControl(relayBase, token) {
  if (quitting) return null;
  if (controlWs && controlWs.readyState === WebSocket.OPEN && controlWs.__vcToken === token) {
    return controlWs; // already connected with this exact credential — no-op
  }
  closeControlConnection();

  const { claims, availability } = await resolveControlConnectInputs(token);
  if (!claims?.sid) {
    log("error", "control token unparseable — cannot open control connection");
    return null;
  }

  const { buildControlConnectUrl } = await controlUrlMod();
  const url = buildControlConnectUrl({
    relayBase,
    sid: claims.sid,
    token,
    helperVersion: HELPER_VERSION,
    machineLabel: os.hostname(),
    alwaysOn,
    availability,
  });
  log("info", "opening control connection", { host: (() => { try { return new URL(relayBase).host; } catch { return "unparseable"; } })() });

  const ws = new WebSocket(url);
  ws.__vcToken = token;
  controlWs = ws;

  ws.on("open", () => {
    controlReconnectAttempt = 0;
    log("info", "control connection open");
  });
  ws.on("message", async (data, isBinary) => {
    if (isBinary) return; // the control leg never receives binary
    const text = data.toString();
    const { parseHelperCommandFrame } = await controlFramesMod();
    const cmd = parseHelperCommandFrame(text);
    if (!cmd) return;
    log("info", "received helper command", { cmd: cmd.cmd });
    if (cmd.cmd === "stop") beginCleanQuit("stop");
    else if (cmd.cmd === "quiesce") beginCleanQuit("quiesce");
    else if (cmd.cmd === "set-always-on") await setAlwaysOn(cmd.value, { echo: false });
  });
  ws.on("error", (err) => {
    log("warn", "control connection error", { err: String(err?.message || err) });
  });
  ws.on("close", (code, reasonBuf) => {
    if (controlWs !== ws) return; // superseded by a newer connect
    controlWs = null;
    if (quitting) return; // an intentional close during quit — never reconnect
    // The relay REJECTED this credential (4006 BAD_TOKEN — expired/forged):
    // retrying with the same token can only be rejected again. Seen live on
    // 2 Sep 2026: once the 5-minute helperToken lapsed, this loop hammered
    // the relay every 2 s (the accept-then-close counts as a successful
    // "open", which reset the backoff each time). Stop here; the next deep
    // link carries a fresh token and connectControl() runs again.
    if (code === CONTROL_AUTH_REJECTED_CLOSE_CODE) {
      const reason = reasonBuf ? String(reasonBuf) : "";
      log("warn", "control credential rejected by relay — not retrying until a new token arrives", { code, reason });
      return;
    }
    scheduleControlReconnect(relayBase, token);
  });
  return ws;
}

/**
 * Open a DEDICATED, throwaway control-connection socket for the desktop-Codex
 * open-terminal authorization handshake (security review Finding 1). This
 * function is deliberately NOT a mode of connectControl — it:
 *   - NEVER reads or assigns the module-level `controlWs`, so the PRIMARY
 *     control connection (and any live session it is keeping alive) is
 *     completely undisturbed by an open-terminal request;
 *   - installs no reconnect-on-close scheduling — it is a one-shot handshake
 *     socket, not a standing connection;
 *   - shares ONLY the URL/param-building logic with connectControl
 *     (buildControlConnectUrl via resolveControlConnectInputs), never its
 *     socket wiring.
 * Always carries `purpose=open-terminal`. Never a no-op reuse — every call
 * gets a genuinely fresh socket, so the caller has a real round trip to
 * verify against (a reused connection could have been authorized for
 * whatever it originally connected for, possibly nothing).
 *
 * The caller (handleOpenTerminalUrl) owns the returned socket's entire
 * lifecycle and MUST close it once the handshake settles — success,
 * rejection, or timeout. This function only attaches a log-on-error
 * listener; it never closes the socket itself.
 *
 * @param {string} relayBase @param {string} token
 * @returns {Promise<import("ws").WebSocket | null>} null if the token is unparseable.
 */
async function connectOpenTerminalControl(relayBase, token) {
  const { claims, availability } = await resolveControlConnectInputs(token);
  if (!claims?.sid) {
    log("error", "open-terminal control token unparseable — cannot open control connection");
    return null;
  }

  const { buildControlConnectUrl } = await controlUrlMod();
  const url = buildControlConnectUrl({
    relayBase,
    sid: claims.sid,
    token,
    helperVersion: HELPER_VERSION,
    machineLabel: os.hostname(),
    alwaysOn,
    availability,
    purpose: "open-terminal",
  });
  log("info", "opening dedicated open-terminal control connection", {
    host: (() => { try { return new URL(relayBase).host; } catch { return "unparseable"; } })(),
  });

  const ws = new WebSocket(url);
  // Log-only — the actual accept/reject outcome is handled by
  // waitForOpenTerminalAuthorization's own close/error listeners in
  // open-terminal-gate.mjs. This never touches controlWs.
  ws.on("error", (err) => {
    log("warn", "open-terminal control connection error", { err: String(err?.message || err) });
  });
  return ws;
}

function scheduleControlReconnect(relayBase, token) {
  if (controlReconnectTimer) return;
  const delay = Math.min(
    CONTROL_RECONNECT_BASE_MS * 2 ** controlReconnectAttempt,
    CONTROL_RECONNECT_MAX_MS,
  );
  controlReconnectAttempt += 1;
  log("warn", "control connection dropped — reconnecting", { delayMs: delay });
  controlReconnectTimer = setTimeout(() => {
    controlReconnectTimer = null;
    void connectControl(relayBase, token);
  }, delay);
  controlReconnectTimer.unref?.();
}

/** Load persisted control credentials (if any) and connect proactively — the
 *  path a LaunchAgent restart takes with no deep link at all. */
async function maybeConnectControlFromPersisted() {
  const creds = loadControlCredentials();
  if (creds) void connectControl(creds.relay, creds.token);
}

// ── always-on / login item / tray (design §1 decision 1, §5b — approved for v1) ──
let tray = null;

/** Apply everything "Keep helper ready" implies: login item, tray, the linger timer. */
function applyAlwaysOnEffects() {
  try {
    app.setLoginItemSettings({ openAtLogin: alwaysOn });
  } catch (e) {
    // Non-fatal (e.g. sandboxed/dev environments can reject this) — the
    // setting itself still governs the linger timer either way.
    log("warn", "could not update login item", { err: String(e?.message || e) });
  }
  if (alwaysOn) createTray();
  else destroyTray();
  updateLingerTimer();
}

/**
 * Change the always-on setting: persist it, apply its effects, and — unless
 * this call itself IS the echo of an inbound `set-always-on` command — report
 * the new value back over the control connection (design: "reporting its
 * persisted setting... and again whenever the setting changes locally").
 */
async function setAlwaysOn(value, { echo = true } = {}) {
  alwaysOn = !!value;
  saveSettings({ alwaysOn });
  applyAlwaysOnEffects();
  if (echo && controlWs && controlWs.readyState === WebSocket.OPEN) {
    try {
      const { encodeAlwaysOnFrame } = await controlFramesMod();
      controlWs.send(encodeAlwaysOnFrame(alwaysOn));
    } catch (e) {
      log("warn", "could not report always-on change", { err: String(e?.message || e) });
    }
  }
}

function trayStatusLabel() {
  const n = children.size;
  if (n === 0) return "Ready";
  return `${n} session${n === 1 ? "" : "s"} running`;
}

function quitFromTray() {
  if (children.size > 0) {
    const n = children.size;
    const choice = dialog.showMessageBoxSync({
      type: "question",
      buttons: ["Cancel", "Quit"],
      defaultId: 0,
      cancelId: 0,
      message: `Quit and end ${n} running session${n === 1 ? "" : "s"}?`,
    });
    if (choice !== 1) return; // cancelled
  }
  beginCleanQuit("quit");
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: trayStatusLabel(), enabled: false },
    { type: "separator" },
    {
      label: "Open VibeCodes",
      click: () => { void shell.openExternal(process.env.VIBECODES_APP_URL || "https://vibecodes.co.uk"); },
    },
    {
      label: "Keep helper ready",
      type: "checkbox",
      checked: alwaysOn,
      // Toggle off the CURRENT value — Electron's own checkbox visual state
      // updates from the next buildTrayMenu() call (refreshTray, triggered by
      // setAlwaysOn -> applyAlwaysOnEffects), not from this click flipping it
      // itself.
      click: () => { void setAlwaysOn(!alwaysOn, { echo: true }); },
    },
    {
      label: "Quit VibeCodes Helper",
      click: () => quitFromTray(),
    },
  ]);
}

// Rebuilding the whole template (rather than mutating items in place) keeps
// the checkbox's `checked` and the status label always in sync with current
// state — this menu is tiny, so a rebuild on every change is simplest and
// cheap (design §5b: "minimal by design").
function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`VibeCodes Helper — ${trayStatusLabel()}`);
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  if (tray) {
    refreshTray();
    return;
  }
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, "base64"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  refreshTray();
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

// ── clean-quit orchestration ──────────────────────────────────────────────────
/**
 * Start a clean shutdown: send the goodbye frame (best effort — see
 * sendGoodbye), then hand off to Electron's normal quit sequence, which the
 * `before-quit` handler below turns into "kill children, verify every
 * grandchild is really dead, then exit(0)". Idempotent — a second call while
 * one is already underway is a no-op (mirrors the design's "a second Stop is a
 * no-op").
 * @param {"idle-quit"|"stop"|"quiesce"|"quit"} reason
 */
function beginCleanQuit(reason) {
  if (quitting) return;
  quitting = true;
  quitReason = reason;
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  cleanupPendingOpenTerminalScriptsSync();
  void sendGoodbye(reason).finally(() => {
    closeControlConnection();
    app.quit();
  });
}

// ── single-instance: forward a second click's URL to the running helper ──────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = urlFromArgv(argv);
    if (url) handleDeepLink(url);
  });

  // macOS delivers URL-scheme activations (cold AND warm) as an Apple Event that
  // Electron surfaces here. URLs can arrive before `ready` — queue until then.
  const pending = [];
  let ready = false;
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (ready) handleDeepLink(url);
    else pending.push(url);
  });

  app.whenReady().then(() => {
    ready = true;
    app.dock?.hide(); // background helper — no dock icon
    // Register the scheme. Packaged builds also declare it in Info.plist via
    // electron-builder `protocols`; this runtime call covers dev + (re)registration.
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(LAUNCH_PREFIX.replace("://", ""));
    } else if (shouldRegisterProtocolInDev(process.env)) {
      // Dev: OFF by default. On macOS setAsDefaultProtocolClient IGNORES the
      // path/args below — Launch Services registers the running bundle, i.e.
      // the raw Electron binary (com.github.Electron), stealing vibecodes://
      // from the installed app. Opt in with VIBECODES_DEV_PROTO_REG=1; repair
      // by launching /Applications/VibeCodes.app once.
      app.setAsDefaultProtocolClient(LAUNCH_PREFIX.replace("://", ""), process.execPath, [
        path.resolve(__dirname),
      ]);
    }

    // Apply whatever was persisted BEFORE this launch (login item / tray) —
    // covers a LaunchAgent restart, and repairs drift if the OS-level login
    // item state ever fell out of sync with our own settings file.
    applyAlwaysOnEffects();
    // Reconnect the control connection from a persisted credential (the
    // LaunchAgent-restart path with no deep link at all). A deep link that
    // arrives moments later (below) will simply no-op against this if its
    // helperToken matches, or supersede it if the app was reinstalled/re-auth'd.
    void maybeConnectControlFromPersisted();
    // Codex support (FR-11 hygiene): remove any desktop-Codex launch scripts
    // left over from a previous run (crash, or a link that never reached
    // `open`) before anything new can write one.
    sweepStaleOpenTerminalScripts();

    // Drain anything that arrived pre-ready, then a cold-launch argv URL (covers
    // the dev/verify path where the link is passed on the command line).
    for (const u of pending.splice(0)) handleDeepLink(u);
    const argvUrl = urlFromArgv(process.argv);
    if (argvUrl) handleDeepLink(argvUrl);

    updateLingerTimer();
  });

  // We never open a window; keep the app alive on our own terms.
  app.on("window-all-closed", () => { /* no-op: managed via updateLingerTimer */ });

  let cleanupStarted = false;
  app.on("before-quit", (event) => {
    if (!quitting) {
      // A quit was requested through some path that didn't go via
      // beginCleanQuit (e.g. an OS session-end/logout signal to app.quit()) —
      // treat it as the generic "quit" reason so the relay still gets an
      // honest goodbye rather than being left to infer "stopped unexpectedly".
      quitting = true;
      void sendGoodbye(quitReason);
    }
    // Re-entrancy guard for the async cleanup below only (sendGoodbye above is
    // safe to call multiple times; the child-kill + verified-reap block is not
    // — and Electron hands this listener a FRESH event object on every fire,
    // so the guard has to live on the module, not on `event`).
    if (cleanupStarted) return;
    for (const child of children) {
      try { child.kill(); } catch { /* ignore */ }
    }
    const pids = [...ptyPids.values()];
    if (pids.length === 0 && activeReaps.size === 0) return; // nothing to verify
    // Hold the quit until every known grandchild is VERIFIED dead (bounded:
    // ~1s SIGHUP grace then SIGKILL(+group), per pid, in parallel) and any
    // in-flight reaps have finished — then exit for real.
    cleanupStarted = true;
    event.preventDefault();
    (async () => {
      try {
        const inflight = [...activeReaps];
        const { pidAlive, reapPidGroupEscalated } = await reapMod();
        await Promise.all(
          pids.map(async (pid) => {
            if (!pidAlive(pid)) return;
            const res = await reapPidGroupEscalated(pid, { hupWaitMs: REAP_HUP_WAIT_MS, termWaitMs: 0 });
            log("info", "before-quit reaped grandchild", { pid, stage: res.stage, confirmedDead: res.confirmedDead });
          }),
        );
        await Promise.allSettled(inflight);
      } catch (err) {
        log("error", "before-quit reap failed", { err: String(err?.message || err) });
      }
      app.exit(0);
    })();
  });
}

// ── test-only hook ────────────────────────────────────────────────────────
// main.js is always launched as Electron's own entry point (`electron .`) —
// nothing in production ever `require()`s it. Exporting these internals is
// therefore harmless in production and is what lets
// terminal/test/control-connection.test.mjs load this file (with `electron`
// and `ws` swapped for fakes) to regression-test the exact bug fixed here: a
// desktop-Codex open-terminal handshake must never touch the primary
// `controlWs` — see connectControl's and connectOpenTerminalControl's header
// comments above.
module.exports = {
  __test: {
    connectControl,
    connectOpenTerminalControl,
    handleOpenTerminalUrl,
    closeControlConnection,
    getControlWs: () => controlWs,
    resetOpenTerminalCooldown: () => { openTerminalCooldownUntil = 0; },
  },
};
