// Terminal auto-accept mode (task d3de150c "Terminal mode"). Mirrors
// model-resolution.ts's MECHANISM (validated value -> deep-link param ->
// bridge-side flag append, fresh-launch only) but deliberately NOT its
// vocabulary: this feature has exactly one legal non-empty value, so there
// is nothing to "resolve" — either the user's own row asked for it or it
// didn't. See docs/design-terminal-auto-accept-mode.html.
//
// Framework-agnostic (no "use server", no Next.js-only imports, no Supabase
// import) so it's usable from client components, server actions, and the API
// route alike — same posture as model-resolution.ts.

/**
 * The ONLY value this feature is ever allowed to send Claude Code. Hard
 * safety requirement (not a nice-to-have): `bypassPermissions` — or any
 * other permission-mode string — must never be reachable through this
 * feature's UI, deep link, or bridge argv. A two-state Switch in the
 * settings UI makes the forbidden value structurally impossible to stage;
 * this whitelist makes it structurally impossible to transmit or spawn,
 * even if some future caller tried to pass one through.
 */
export const AUTO_PERMISSION_MODE = "auto";

/**
 * Whitelist check used on BOTH the parse side (deep link parsing, in the
 * app's TS module and its shared .mjs mirror) and again immediately before
 * the value is appended to the bridge's spawn command (defense in depth —
 * same posture as validateTerminalModelValue's config-time check plus the
 * deep-link modules' own isSafeModelValue re-check). Anything other than
 * the exact literal is rejected, including case variants, whitespace, and
 * every other real Claude Code permission mode (e.g. `bypassPermissions`,
 * `plan`, `default`).
 */
export function isValidPermissionModeValue(value: unknown): value is typeof AUTO_PERMISSION_MODE {
  return value === AUTO_PERMISSION_MODE;
}

/**
 * The passive launch-surface chip (design §2): "⚡ auto mode on" appended
 * beside the existing model chip when the toggle is ON. Returns null when
 * OFF — the design's instruction is byte-identical-to-today when the
 * setting is off, so nothing renders, no reserved space.
 */
export function terminalLaunchAutoAcceptChip(autoAccept: boolean): string | null {
  return autoAccept ? "⚡ auto mode on" : null;
}

/** Session-header / collapsed-bar badge copy — kept in one place so every
 *  surface (dock panel, split view, pop-out, collapsed bar title) uses the
 *  identical word "Auto-accept" (design review note 3: don't let "requested"
 *  and "Auto-accept" drift apart in the shipped copy). */
export const AUTO_ACCEPT_BADGE_LABEL = "Auto mode";
export const AUTO_ACCEPT_BADGE_TITLE =
  "Launched in auto mode — Claude Code approves routine edits and commands itself. Shift+Tab in the terminal changes the live mode.";

/** Settings/help copy — fresh-launch-only rule, stated once here so the
 *  Profile dialog, the chooser footer and the per-task dialog can all quote
 *  the same sentence instead of each drifting independently. */
export const AUTO_ACCEPT_FRESH_ONLY_HELP =
  "Off = Claude Code asks before each action (recommended). Applies to fresh sessions only — resumed sessions keep asking, and you can switch any session live with Shift+Tab in the terminal.";
export const AUTO_ACCEPT_ON_CONSEQUENCE =
  "⚡ New sessions run in auto mode — Claude Code edits files and runs routine commands on your machine without confirming each one. The session header shows an Auto mode badge whenever this is active.";
