// In-app terminal — install-first presentation flow (pure).
//
// The connection STATE MACHINE (connection.ts) tracks the socket lifecycle; this
// module layers the install-first *presentation* on top of it: which centred panel
// + header pill the dock shows, and how the deep-link launch phase advances on the
// ~8s timeout. Kept pure so the branch logic is unit-testable without React or a DOM.

import type { TerminalStatus } from "./connection";

/** UI phase for the same-machine deep-link auto-launch path. */
export type LaunchPhase = "idle" | "opening" | "helper-timeout";

/**
 * The presentation view of the dock body, derived from the connection status, the
 * launch phase, and the install-first gate (platform supported + browser paired).
 * Drives BOTH the header pill and the centred overlay from one decision.
 */
export type DockView =
  | "coming-soon"
  | "setup"
  | "connecting"
  | "connecting-returning"
  | "legacy-waiting"
  | "timeout-new"
  | "timeout-returning"
  | "connected"
  | "disconnected"
  | "session-ended"
  | "error";

/**
 * Decide the current view. Pure over its inputs so the pill + overlay never diverge.
 *
 *  - idle + unsupported            → "coming-soon"  (no deep link)
 *  - idle + supported + unpaired   → "setup"        (numbered setup; no deep link yet)
 *  - connecting/opening            → "connecting"[-returning]
 *  - waiting + helper-timeout      → "timeout-new" | "timeout-returning" (~8s fallback)
 *  - waiting + idle launch phase   → "legacy-waiting" (manual cross-machine pairing)
 *
 * A paired browser auto-connects out of idle immediately, so it never lingers on the
 * "setup" view.
 */
export function resolveDockView(
  status: TerminalStatus,
  launchPhase: LaunchPhase,
  supported: boolean,
  paired: boolean,
): DockView {
  switch (status) {
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "session-ended":
      return "session-ended";
    case "error":
      return "error";
    case "connecting":
      return paired ? "connecting-returning" : "connecting";
    case "waiting-to-pair":
      if (launchPhase === "helper-timeout") return paired ? "timeout-returning" : "timeout-new";
      if (launchPhase === "opening") return paired ? "connecting-returning" : "connecting";
      return "legacy-waiting";
    case "idle":
    default:
      if (!supported) return "coming-soon";
      return "setup";
  }
}

/**
 * Advance the launch phase when the ~8s helper-open timer fires. Only an "opening"
 * (deep-link fired, still waiting) drops to the calm fallback; any other phase is
 * left untouched (e.g. the helper already streamed and reset us to "idle"). This is
 * the safety net for criterion #8 — we always leave "opening", never spin forever.
 */
export function nextLaunchPhaseOnTimeout(current: LaunchPhase): LaunchPhase {
  return current === "opening" ? "helper-timeout" : current;
}

/** Whether the ~8s calm fallback is currently showing (Retry + Download). */
export function isTimeoutFallbackView(view: DockView): boolean {
  return view === "timeout-new" || view === "timeout-returning";
}
