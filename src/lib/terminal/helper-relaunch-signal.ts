// In-app terminal — cheap cross-component signal for the
// `terminal_helper_relaunch_within_2m` PostHog metric (card cc74a067, design
// §9 "Linger length — agreed, or do we want telemetry first?").
//
// The metric pairs two events that happen in DIFFERENT components, possibly
// different tabs/reloads apart: the Helper row (in "My sessions") OBSERVING
// an idle-quit via its own status polling, and a terminal session being
// MINTED later (use-terminal-session.ts's connect()). There is no shared
// in-memory state between them, so — mirroring paired-flag.ts's existing
// pattern for exactly this kind of cross-component, cross-reload signal — a
// tiny localStorage flag carries the observation across the gap. This is the
// "derive cheaply from Helper-row status transitions" the card asks for: no
// new relay field, no server round trip, just a timestamp + a window check.
//
// An idle-quit is inferred CLIENT-SIDE from the Helper row's own chip history
// (see terminal-my-sessions-panel.tsx): connected+winding-down transitioning
// to not-connected, with no Stop/Update command issued by this client in the
// interim. That inference lives in the component (it needs the chip
// transition + "did I just click Stop" context); this module is only the
// pure, SSR-safe store + the "was one observed recently" check.

/** localStorage key for the last observed helper idle-quit timestamp (unix ms). */
export const HELPER_IDLE_QUIT_OBSERVED_KEY = "vibecodes:terminal:helper-idle-quit-observed-at";

/** The metric's own window: a session mint within this long of an observed
 *  idle-quit counts as "the user came right back". */
export const RELAUNCH_WITHIN_MS = 2 * 60 * 1000;

/** Record that an idle-quit was just observed (the Helper row calls this on
 *  the winding-down -> not-running transition, absent a local Stop/Update). */
export function recordHelperIdleQuitObserved(nowMs: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HELPER_IDLE_QUIT_OBSERVED_KEY, String(nowMs));
  } catch {
    // Storage disabled/full — worst case this one observation is never paired.
  }
}

/**
 * Check (and CONSUME — a single relaunch should only ever fire the metric
 * once) whether a session mint happening right now falls within
 * RELAUNCH_WITHIN_MS of a previously observed idle-quit. Always clears the
 * stored timestamp when it's stale or consumed, so a second, unrelated mint
 * later never double-counts the same idle-quit.
 */
export function consumeRecentHelperIdleQuit(nowMs: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(HELPER_IDLE_QUIT_OBSERVED_KEY);
    if (raw === null) return false;
    window.localStorage.removeItem(HELPER_IDLE_QUIT_OBSERVED_KEY);
    const observedAt = Number(raw);
    if (!Number.isFinite(observedAt)) return false;
    return nowMs - observedAt >= 0 && nowMs - observedAt < RELAUNCH_WITHIN_MS;
  } catch {
    return false;
  }
}
