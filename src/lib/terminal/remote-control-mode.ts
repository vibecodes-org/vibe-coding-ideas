// Terminal Remote Control (task 5c8969cc, "Start with Remote Control on").
// Same mechanism as auto-accept-mode.ts (user row -> mint response -> deep-link
// param -> bridge flag) with one difference: Remote Control only lasts for one
// run of claude, so it also rides RESUME links while
// REMOTE_CONTROL_APPLIES_TO_RESUME is true. The bridge always honours the field
// on every Claude branch, so flipping that constant never needs a helper
// release. See docs/terminal-remote-control-ux.html.
//
// Framework-agnostic (no "use server", no Next.js-only imports, no Supabase
// import) — same posture as auto-accept-mode.ts.

/** V1 switch — set false if `claude --remote-control --resume/--continue` fails live. */
export const REMOTE_CONTROL_APPLIES_TO_RESUME = true;
/** V2 switch — set true if Remote Control needs a claude.ai sign-in (API-key users).
 *  Live check V2 (10 Oct 2026, Claude Code 2.1.296): signed in with an API key,
 *  `claude --remote-control` starts normally but Remote Control never comes on
 *  and Claude prints nothing about it — so the help text has to say so. */
export const REMOTE_CONTROL_NEEDS_CLAUDE_AI_SIGN_IN = true;

// Copy lifted verbatim from the approved mock's COPY object
// (docs/terminal-remote-control-ux.html).
export const REMOTE_CONTROL_SWITCH_LABEL = "Start with Remote Control on";
export const REMOTE_CONTROL_HELP_OFF =
  "Lets you carry on a Claude Code session from the Claude app on your phone or at claude.ai/code. Applies to new and resumed sessions. A session that's already running isn't changed — type /remote-control in it instead. Codex isn't affected.";
export const REMOTE_CONTROL_HELP_ON =
  "📱 New and resumed Claude Code sessions can be carried on from the Claude app or claude.ai/code. Anyone signed in to your Claude account can see and continue them there. A session that's already running isn't changed. Codex isn't affected.";
export const REMOTE_CONTROL_HELP_OFF_NEW_ONLY =
  "Lets you carry on a Claude Code session from the Claude app on your phone or at claude.ai/code. New sessions only — resumed or already-running sessions aren't changed (type /remote-control in one to turn it on). Codex isn't affected.";
export const REMOTE_CONTROL_HELP_ON_NEW_ONLY =
  "📱 New Claude Code sessions can be carried on from the Claude app or claude.ai/code. Anyone signed in to your Claude account can see and continue them there. Resumed and already-running sessions aren't changed. Codex isn't affected.";
export const REMOTE_CONTROL_SIGN_IN_NOTE =
  "Needs Claude Code signed in with your claude.ai account (not an API key).";
export const REMOTE_CONTROL_CHIP = "📱 remote control on";
export const REMOTE_CONTROL_CHOOSER_REMINDER_NEW_ONLY =
  "Only a fresh session starts with Remote Control — resuming doesn't turn it on.";
export const REMOTE_CONTROL_DIALOG_REMINDER_NEW_ONLY = "Only starting fresh applies Remote Control.";

/** The Settings help text under the switch, for its on/off state. */
export function terminalRemoteControlHelp(
  on: boolean,
  opts?: { appliesToResume?: boolean; needsSignIn?: boolean }
): string {
  const applies = opts?.appliesToResume ?? REMOTE_CONTROL_APPLIES_TO_RESUME;
  const needsSignIn = opts?.needsSignIn ?? REMOTE_CONTROL_NEEDS_CLAUDE_AI_SIGN_IN;
  const base = on
    ? applies
      ? REMOTE_CONTROL_HELP_ON
      : REMOTE_CONTROL_HELP_ON_NEW_ONLY
    : applies
      ? REMOTE_CONTROL_HELP_OFF
      : REMOTE_CONTROL_HELP_OFF_NEW_ONLY;
  return needsSignIn ? `${base} ${REMOTE_CONTROL_SIGN_IN_NOTE}` : base;
}

/** The passive launch-surface label shown straight after "⚡ auto mode on".
 *  Null when off — nothing renders, no reserved space. */
export function terminalLaunchRemoteControlChip(remoteControl: boolean): string | null {
  return remoteControl ? REMOTE_CONTROL_CHIP : null;
}

/** The "new sessions only" reminder line under the launch label — only when
 *  resumes don't carry Remote Control (V1 failed). */
export function terminalLaunchRemoteControlReminder(
  surface: "chooser" | "dialog",
  appliesToResume: boolean = REMOTE_CONTROL_APPLIES_TO_RESUME
): string | null {
  if (appliesToResume) return null;
  return surface === "chooser" ? REMOTE_CONTROL_CHOOSER_REMINDER_NEW_ONLY : REMOTE_CONTROL_DIALOG_REMINDER_NEW_ONLY;
}

/**
 * Whether a launch link should carry `remoteControl=1`: the mint/reattach
 * route asked for it, the agent isn't Codex, and — for a resume-shaped link —
 * resumes are covered. `true` or undefined (an omitted link field), never
 * `false`, so an off launch builds a byte-identical link.
 */
export function remoteControlForLaunch(a: {
  requested: boolean;
  agent: string | null | undefined;
  isResume: boolean;
  appliesToResume?: boolean;
}): true | undefined {
  const applies = a.appliesToResume ?? REMOTE_CONTROL_APPLIES_TO_RESUME;
  if (!a.requested || a.agent === "codex" || (a.isResume && !applies)) return undefined;
  return true;
}

/**
 * One line on the "Session ended" panel when a Remote Control launch stops
 * straight away (Nick's decision, 10 Oct 2026). Live check V3: Claude Code
 * 2.0.50 exits at once with "error: unknown option '--remote-control'", and
 * that error is hidden under the ended overlay — so the hint lives on the
 * panel itself, never in the PTY stream.
 */
export const REMOTE_CONTROL_EARLY_EXIT_HINT =
  'Claude Code stopped straight away — if it\'s out of date, run "claude update", or turn off Remote Control in Settings.';

/** How soon after Claude's first output an exit still counts as "straight
 *  away" for {@link shouldShowRemoteControlEarlyExitHint} (V3, 10 Oct 2026). */
export const REMOTE_CONTROL_EARLY_EXIT_MS = 15_000;

/**
 * Whether the ended panel shows {@link REMOTE_CONTROL_EARLY_EXIT_HINT}: the
 * launch asked for Remote Control, Claude's own process ended the session
 * ("remote"), and it did so within {@link REMOTE_CONTROL_EARLY_EXIT_MS} of its
 * first output (or before any). Nick's decision of 10 Oct 2026, from live
 * check V3 (an old Claude Code's "unknown option" error is hidden under the
 * ended overlay).
 */
export function shouldShowRemoteControlEarlyExitHint(a: {
  launchedWithRemoteControl: boolean;
  endedReason: string | null;
  firstOutputAt: number | null;
  endedAt: number;
}): boolean {
  if (!a.launchedWithRemoteControl) return false;
  if (a.endedReason !== "remote") return false;
  if (a.firstOutputAt === null) return true;
  return a.endedAt - a.firstOutputAt <= REMOTE_CONTROL_EARLY_EXIT_MS;
}
