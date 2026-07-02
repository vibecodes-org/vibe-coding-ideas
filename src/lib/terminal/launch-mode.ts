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

/**
 * The compact bootstrap prompt the launch button resolved for this launch,
 * split head/tail (buildCompactBootstrapPromptParts) so the dock — which alone
 * knows the final vibecodes:// URL's session/token overhead — can budget-truncate
 * the tail with enforcePromptLength while the load-bearing head survives.
 * Carrying the PARTS (not a joined string) keeps that truncation on the one
 * shared implementation instead of re-splitting a built prompt.
 */
export interface BrowserLaunchPayload {
  promptHead: string;
  promptTail: string;
  /**
   * The working directory the launch should open in — resolved by the button
   * with the SAME rule the claude-cli:// path uses (resolveLaunchCwd over the
   * pinned/effective path), so a pinned or recorded existing-mode folder is
   * honoured in the browser too. Omitted when the state carries no cwd
   * (repo-backed, or a brand-new ~/projects/<slug> the agent creates).
   */
  cwd?: string;
}

/** Ask the board's terminal dock to open + auto-launch in the browser. */
export function requestBrowserLaunch(payload?: BrowserLaunchPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<BrowserLaunchPayload | undefined>(LAUNCH_EVENT, { detail: payload })
  );
}

/** Subscribe to in-browser launch requests; returns an unsubscribe fn. SSR-safe. */
export function subscribeBrowserLaunch(
  handler: (payload?: BrowserLaunchPayload) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) =>
    handler((e as CustomEvent<BrowserLaunchPayload | undefined>).detail ?? undefined);
  window.addEventListener(LAUNCH_EVENT, listener);
  return () => window.removeEventListener(LAUNCH_EVENT, listener);
}
