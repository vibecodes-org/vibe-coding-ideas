// In-app terminal — launch-mode selection + cross-component launch bus (SLICE 4).
//
// "Launch Claude Code" is a PICK-ONE control: Claude runs in exactly one place at a
// time. This module owns the pure decision of WHICH modes the menu offers (gated on
// the terminal flag) plus a tiny SSR-safe event bus so the toolbar's menu item can
// ask the board's terminal dock (a separate, page-level component) to open in the
// browser. Keeping the selection logic pure makes it unit-testable without React.

/** The two destinations Claude can run in. "terminal-window" = today's behaviour. */
export type LaunchTarget = "terminal-window" | "browser";

/**
 * The launch modes the menu should offer, in display order.
 *
 *  - flag OFF → only "terminal-window" (the in-browser item is simply NOT rendered;
 *    the control looks and behaves exactly as it does today).
 *  - flag ON  → "terminal-window" (default, first) then "browser" (Beta).
 *
 * "terminal-window" is ALWAYS present and ALWAYS first, so the existing default
 * action is never moved or removed by enabling the flag.
 */
export function launchModeOptions(terminalEnabled: boolean): LaunchTarget[] {
  return terminalEnabled ? ["terminal-window", "browser"] : ["terminal-window"];
}

/** Whether the in-browser destination should appear in the menu. */
export function isBrowserLaunchAvailable(terminalEnabled: boolean): boolean {
  return launchModeOptions(terminalEnabled).includes("browser");
}

// ── launch bus ────────────────────────────────────────────────────────────────
// The "In the browser" menu item lives in the board toolbar; the terminal dock that
// mints the session + fires the deep link is a sibling at the bottom of the board.
// A scoped CustomEvent lets the former trigger the latter without restructuring the
// page or minting a session twice. SSR-safe (no-ops without a window).

const LAUNCH_EVENT = "vibecodes:terminal-browser-launch";

/** Ask the board's terminal dock to open + auto-launch in the browser. */
export function requestBrowserLaunch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LAUNCH_EVENT));
}

/** Subscribe to in-browser launch requests; returns an unsubscribe fn. SSR-safe. */
export function subscribeBrowserLaunch(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(LAUNCH_EVENT, listener);
  return () => window.removeEventListener(LAUNCH_EVENT, listener);
}
