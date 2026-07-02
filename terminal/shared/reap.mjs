// Verified process-kill escalation — shared by the BRIDGE (killing its own PTY
// child at shutdown) and the HELPER (reaping a dead bridge's orphaned PTY
// grandchild). POSIX only; callers guard win32.
//
// WHY THIS EXISTS (the orphaned-`claude` bug): node-pty's `term.kill()` is ONE
// unverified SIGHUP. `claude` can ignore/outlive it, and because node-pty's
// spawn-helper `setsid`s the PTY child into its OWN session + process group,
// nothing else (parent death, group signals from the bridge's group) ever
// reaches it. The fix is to VERIFY death and escalate:
//
//   SIGHUP  → poll up to hupWaitMs  →
//   SIGTERM → poll up to termWaitMs → (skipped when termWaitMs <= 0)
//   SIGKILL to the PROCESS GROUP (-pid) and the pid itself
//
// The group kill at the SIGKILL stage matters: the PTY child is its own group
// leader, so `-pid` sweeps any children IT spawned (sub-shells, MCP servers, …).

/** Is `pid` still alive? EPERM means "alive but not ours" — still alive. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/** Best-effort signal; returns false instead of throwing (ESRCH/EPERM). */
export function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve true as soon as `pid` is dead (or `isDead()` reports it), false if it
 * is still alive after `capMs`. Polls every `pollMs`; checks immediately first.
 */
export function waitForPidExit(pid, capMs, { pollMs = 50, isDead } = {}) {
  const dead = () => Boolean(isDead?.()) || !pidAlive(pid);
  return new Promise((resolve) => {
    if (dead()) return resolve(true);
    const started = Date.now();
    const iv = setInterval(() => {
      if (dead()) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - started >= capMs) {
        clearInterval(iv);
        resolve(false);
      }
    }, pollMs);
  });
}

/**
 * Kill `pid` with verified escalation (see module header). Total time is
 * bounded by hupWaitMs + termWaitMs + ~500ms of final confirmation.
 *
 * @param {number} pid  the PTY child (its own session/group leader).
 * @param {{ hupWaitMs?: number, termWaitMs?: number, pollMs?: number,
 *           isDead?: () => boolean, onStage?: (stage: string) => void }} [opts]
 *   `termWaitMs <= 0` skips the SIGTERM stage (the helper's HUP→KILL profile).
 *   `isDead` — an extra authoritative liveness source (e.g. node-pty's onExit).
 *   `onStage` — called before each ESCALATED stage (SIGTERM / SIGKILL) for logs.
 * @returns {Promise<{ stage: "already-dead"|"SIGHUP"|"SIGTERM"|"SIGKILL",
 *                     confirmedDead: boolean }>}
 *   `stage` = the signal that (finally) took it down; `confirmedDead: false`
 *   means even SIGKILL could not be confirmed within the bound (caller logs it).
 */
export async function reapPidGroupEscalated(pid, opts = {}) {
  const { hupWaitMs = 2000, termWaitMs = 1000, pollMs = 50, isDead, onStage } = opts;
  const dead = () => Boolean(isDead?.()) || !pidAlive(pid);

  if (dead()) return { stage: "already-dead", confirmedDead: true };

  sendSignal(pid, "SIGHUP");
  if (await waitForPidExit(pid, hupWaitMs, { pollMs, isDead })) {
    return { stage: "SIGHUP", confirmedDead: true };
  }

  if (termWaitMs > 0) {
    onStage?.("SIGTERM");
    sendSignal(pid, "SIGTERM");
    if (await waitForPidExit(pid, termWaitMs, { pollMs, isDead })) {
      return { stage: "SIGTERM", confirmedDead: true };
    }
  }

  onStage?.("SIGKILL");
  // Group first (sweeps the child's own children), then the leader itself.
  sendSignal(-pid, "SIGKILL");
  sendSignal(pid, "SIGKILL");
  const confirmedDead = await waitForPidExit(pid, 500, { pollMs, isDead });
  return { stage: "SIGKILL", confirmedDead };
}
