// VibeCodes macOS helper — SLICE 7 (the "install once" piece).
//
// A thin, installable, URL-scheme-registered wrapper around the existing
// terminal/bridge. Its ONLY jobs:
//
//   1. Register the `vibecodes://` URL scheme so the OS routes the app's signed
//      deep link here (Info.plist CFBundleURLTypes is emitted by electron-builder
//      from `protocols` — see electron-builder.yml; we also call
//      app.setAsDefaultProtocolClient at runtime for dev/registration).
//   2. On `vibecodes://launch?relay&session&token[&cwd]`, run the EXISTING bridge
//      logic with that URL as `--launch-url`. We do NOT re-implement the PTY/relay
//      plumbing — we `fork` terminal/bridge/src/index.js using Electron-as-Node
//      (ELECTRON_RUN_AS_NODE=1). node-pty 1.x is N-API (ABI-stable across Node and
//      Electron) so its prebuilt pty.node loads unchanged; the bridge itself does
//      the macOS spawn-helper chmod.
//
// Headless background helper: no window, no dock icon. It stays alive while a
// bridge child is running and quits shortly after the last one exits, so it does
// not linger as a resident process. A subsequent link just cold-launches it again.

const { app } = require("electron");
const { fork } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const LAUNCH_PREFIX = "vibecodes://";

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

// ── child-bridge bookkeeping + idle quit ─────────────────────────────────────
const children = new Set();
// bridge child -> its PTY child's pid (the grandchild — `claude`). Reported by
// the bridge over IPC ({type:"pty-pid"}) right after its pty.spawn. Needed
// because the grandchild is its OWN session/group leader (spawn-helper setsid):
// if the bridge dies uncleanly (SIGKILL — it can run no cleanup), WE are the
// only thing left that can verify the grandchild died and escalate if not.
const ptyPids = new Map();
// In-flight grandchild verifications. The idle-quit must NOT fire — and
// before-quit must not let the process vanish — while one is pending.
const activeReaps = new Set();
let quitting = false;
let quitTimer = null;
const IDLE_QUIT_MS = 2000; // grace after the last bridge exits before we quit
const REAP_HUP_WAIT_MS = 1000; // grandchild SIGHUP grace before SIGKILL(+group)

function scheduleQuitIfIdle() {
  if (quitting) return;
  if (children.size > 0 || activeReaps.size > 0) {
    if (quitTimer) { clearTimeout(quitTimer); quitTimer = null; }
    return;
  }
  if (quitTimer) clearTimeout(quitTimer);
  quitTimer = setTimeout(() => {
    if (children.size === 0 && activeReaps.size === 0) {
      log("info", "idle — no active sessions, quitting");
      app.quit();
    }
  }, IDLE_QUIT_MS);
  quitTimer.unref?.();
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
    scheduleQuitIfIdle();
  });
  return p;
}

/**
 * Hand a `vibecodes://launch?…` URL to the existing bridge. Validates with the
 * SHARED parser first (so we never fork on garbage), then forks the bridge with
 * `--launch-url`. The bridge re-parses the same string (single source of truth)
 * and connects as the relay's bridge leg.
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
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);

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
    // so the idle-quit below cannot fire before the verification completes).
    const ptyPid = ptyPids.get(child);
    ptyPids.delete(child);
    if (ptyPid) reapGrandchild(ptyPid, `bridge-exit code=${code} signal=${signal}`);
    scheduleQuitIfIdle();
  });
  child.on("error", (err) => {
    children.delete(child);
    log("error", "bridge failed to start", { err: String(err?.message || err) });
    const ptyPid = ptyPids.get(child);
    ptyPids.delete(child);
    if (ptyPid) reapGrandchild(ptyPid, "bridge-error");
    scheduleQuitIfIdle();
  });
}

// Pull a vibecodes:// link out of an argv array (cold launch on macOS dev /
// Windows, and the second-instance forward).
function urlFromArgv(argv) {
  return argv.find((a) => typeof a === "string" && a.startsWith(LAUNCH_PREFIX));
}

// ── single-instance: forward a second click's URL to the running helper ──────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = urlFromArgv(argv);
    if (url) handleLaunchUrl(url);
  });

  // macOS delivers URL-scheme activations (cold AND warm) as an Apple Event that
  // Electron surfaces here. URLs can arrive before `ready` — queue until then.
  const pending = [];
  let ready = false;
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (ready) handleLaunchUrl(url);
    else pending.push(url);
  });

  app.whenReady().then(() => {
    ready = true;
    app.dock?.hide(); // background helper — no dock icon
    // Register the scheme. Packaged builds also declare it in Info.plist via
    // electron-builder `protocols`; this runtime call covers dev + (re)registration.
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(LAUNCH_PREFIX.replace("://", ""));
    } else {
      // Dev: point the registration at this Electron + project dir.
      app.setAsDefaultProtocolClient(LAUNCH_PREFIX.replace("://", ""), process.execPath, [
        path.resolve(__dirname),
      ]);
    }

    // Drain anything that arrived pre-ready, then a cold-launch argv URL (covers
    // the dev/verify path where the link is passed on the command line).
    for (const u of pending.splice(0)) handleLaunchUrl(u);
    const argvUrl = urlFromArgv(process.argv);
    if (argvUrl) handleLaunchUrl(argvUrl);

    scheduleQuitIfIdle();
  });

  // We never open a window; keep the app alive on our own terms.
  app.on("window-all-closed", () => { /* no-op: managed via scheduleQuitIfIdle */ });

  app.on("before-quit", (event) => {
    if (quitting) return; // our own deferred quit path re-entering — let it go
    for (const child of children) {
      try { child.kill(); } catch { /* ignore */ }
    }
    const pids = [...ptyPids.values()];
    if (pids.length === 0 && activeReaps.size === 0) return; // nothing to verify
    // Hold the quit until every known grandchild is VERIFIED dead (bounded:
    // ~1s SIGHUP grace then SIGKILL(+group), per pid, in parallel) and any
    // in-flight reaps have finished — then exit for real.
    quitting = true;
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
