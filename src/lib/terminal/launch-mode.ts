// In-app terminal — launch-mode selection + cross-component launch bus (SLICE 4).
//
// "Launch Claude Code" is a PICK-ONE-PER-CLICK control: each launch starts Claude in
// exactly one destination (a terminal window OR a new browser tab). That is no longer
// a claim about the app as a whole, though — multi-session (docs/design-terminal-multi-
// session-popout.html) lets several sessions run at once, in any mix of terminal
// windows and in-browser tabs (capped per user, see session-cap.ts; never re-derive
// that number here — copy sweep A3). This module owns the pure decision of WHICH modes
// the menu offers (gated on the terminal flag) plus a tiny SSR-safe event bus so the
// toolbar's menu item can ask the board's terminal dock (a separate, page-level
// component) to open a NEW tab in the browser. Keeping the selection logic pure makes
// it unit-testable without React.

import type { CompactPromptEssentials } from "@/lib/launch-claude-code";

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
 * The compact bootstrap prompt the launch button resolved for this launch, as
 * ESSENTIALS (buildCompactPromptEssentials — BUG 5 follow-through, 4th rework
 * cycle) rather than the unconditional head/tail parts
 * (buildCompactBootstrapPromptParts) this payload used to carry: the
 * unconditional builder bakes the worktree-isolation protocol into the
 * never-trimmed head whenever it's in scope, so a long cwd could push the
 * vibecodes:// URL over its budget with no clean way to drop the protocol
 * afterwards (the dock's bare enforcePromptLength clamp had already baked it
 * in). Carrying the essentials (path-length-independent head + trimmable tail
 * + the protocol candidate kept SEPARATE) lets the dock — which alone knows
 * the final URL's session/token overhead — hand off to
 * fitCompactWorktreeProtocol, the SAME atomic protocol-omit helper the
 * claude-cli:// deep link uses, so the two launch destinations degrade
 * identically (never overflow, never a half-truncated protocol fragment).
 */
export interface BrowserLaunchPayload {
  /**
   * Optional ONLY for a `resume` payload (see below) — a `--continue` launch
   * carries no bootstrap prompt at all, so there is nothing to build
   * essentials for. Every other payload always sets this.
   */
  essentials?: CompactPromptEssentials;
  /**
   * The working directory the launch should open in — resolved by the button
   * with the SAME rule the claude-cli:// path uses (resolveLaunchCwd over the
   * pinned/effective path), so a pinned or recorded existing-mode folder is
   * honoured in the browser too. Omitted when the state carries no cwd
   * (repo-backed, or a brand-new ~/projects/<slug> the agent creates).
   *
   * REQUIRED when `resume` is true — a resumed session always runs in a
   * SPECIFIC recorded folder (the ended session's own `cwd`), never the
   * board's default target.
   */
  cwd?: string;
  /**
   * Session entry chooser — Resume (card cbe60db5, design item 7, F4), LEGACY
   * path for a row with no tracked conversation id: this launch is a chooser
   * "Resume" pick, not a fresh bootstrap. The dock skips building/sending a
   * prompt entirely and fires the deep link with the `resume` flag instead,
   * so the local bridge runs `claude --continue` in `cwd` (the ended
   * session's recorded folder) rather than spawning a new bootstrap
   * conversation. Always paired with `cwd`; `essentials` is not read for a
   * resume payload. Superseded by `resumeId` when present.
   */
  resume?: boolean;
  /**
   * EXACT-CONVERSATION Resume (rework 5, card cbe60db5 — the proper fix): the
   * SPECIFIC claude conversation id to resume
   * (`terminal_sessions.claude_session_id`, tracked from the row the user
   * clicked). When set, the dock fires the deep link with `resumeId` instead
   * of `resume`, so the local bridge runs `claude --resume <id>` — the
   * resumed content is always exactly the row the user clicked, never
   * whatever else has run in that folder since. Always paired with `cwd`,
   * same as `resume`.
   */
  resumeId?: string;
  /**
   * Multi-session stage 2 (B10 dedupe, B3 tab labels): the task this launch was
   * scoped to, when it came from a task card ("task-icon" / "task-menu-item"
   * variants of LaunchClaudeCodeButton) rather than the board toolbar. Undefined
   * for board-level launches — those never carry a task identity, so B10's
   * dedupe never applies to them (only a REAL task identity is keyed on; cwd/
   * prompt equivalence is deliberately never treated as a match).
   */
  taskId?: string;
  /** The task's title, for the tab label (B3) when `taskId` is present. */
  taskTitle?: string;
  /**
   * Cross-board resume fix (bug 62e57071): the idea this launch's underlying
   * conversation actually belongs to — set ONLY by a resume payload built
   * from a `ChooserRecentRow`/ended-session record whose own `ideaId` is
   * known (chooser Resume, task-choice Resume, the ended-panel's "Resume
   * this conversation"). Undefined for every other payload (toolbar/"+"/
   * task-launch), which never carries board ambiguity — those always target
   * whichever board is currently open. terminal-dock.tsx's resume handlers
   * compare this against the dock's own `ideaId` prop and navigate to the
   * row's own board FIRST when they differ, rather than minting here under
   * the wrong one — see handleChooserResume/handleResumeEndedSession.
   */
  ideaId?: string;
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
