// In-app terminal — install-first first-run copy.
//
// Centralised so it can be (a) reused by the dock overlay and (b) unit-asserted to
// contain no error-speak or jargon. The audience is a non-coder: the tone is calm
// and reassuring, never "Failed / Error / Nothing opened" (criterion #7) and never
// port/token/relay jargon (criterion #12). Matches the approved UX (Compass) in
// docs/install-first-terminal-ux.html.

export const FIRST_RUN_COPY = {
  setup: {
    heading: "Run Claude Code here — one-time setup",
    subheading: "Takes about a minute. You only do this once on this Mac.",
    step1Title: "Download the VibeCodes helper",
    step1Desc:
      "A small, Apple-notarized app that lets this page mirror Claude Code from your Mac. Your code stays on your computer.",
    step2Title: "Open the file and drag VibeCodes to Applications",
    step2Desc:
      "When the download finishes, open it and drag the VibeCodes icon onto the Applications folder shown next to it.",
    step3Title: "Connect this board to the helper",
    // Pre-warns the OS prompt right above the trigger — criterion #4.
    openPrompt:
      "When you click Connect, your Mac may ask “Open VibeCodes?” — click Open. That’s expected, and it only happens the first time.",
    connect: "Connect",
    alreadyInstalled: "Already installed it? Just click Connect.",
  },
  connecting: {
    heading: "Connecting to your Mac…",
    body: "Setting up a secure link to the VibeCodes helper. This is usually a few seconds.",
    // The OS-prompt nudge, repeated in context — criterion #4 reinforcement.
    openNudge: "If your Mac asks, click Open VibeCodes.",
    returningBody: "Welcome back — reopening your terminal. No setup needed this time.",
  },
  // ~8s fallback for a first-timer who just installed (criterion #7).
  timeoutNew: {
    heading: "Didn’t connect yet",
    body: "If you just installed it, make sure you clicked Open when your Mac asked — then try again.",
    retry: "Retry",
    download: "Download the helper",
    hint: "Not installed yet? Get the helper, then Retry.",
  },
  // ~8s fallback for a paired browser whose helper didn't answer (criterion #8).
  timeoutReturning: {
    heading: "Couldn’t reach the helper on this Mac",
    body: "It may not be running. Try again — or re-install the helper if it keeps happening.",
    retry: "Retry",
    reinstall: "Re-install the helper",
    reassure: "Your work on your Mac is safe.",
  },
  // Non-Mac / unsupported machine — calm "coming soon", no deep link (criterion #10).
  comingSoon: {
    heading: "The in-browser terminal is Mac-only for now",
    body: "Windows support is on the way. In the meantime you can still run Claude Code the usual way in your own terminal.",
    download: "Download for Windows",
    hint: "The download unlocks automatically when Windows support ships.",
  },
  pill: {
    setup: "One-time setup",
    notConnected: "Not connected yet",
    comingSoon: "Coming soon",
  },
} as const;

/**
 * Words/phrases that read as error-speak (criterion #7) or infrastructure jargon
 * (criterion #12) to a non-coder. Asserted absent from every FIRST_RUN_COPY string
 * with word-boundary matching (so legitimate words like "support" don't trip the
 * "port" check).
 */
export const FORBIDDEN_FIRST_RUN_COPY = [
  "Nothing opened",
  "Failed",
  "Error",
  "port",
  "token",
  "relay",
] as const;

/** Flatten every string value in FIRST_RUN_COPY (used by the forbidden-words test). */
export function collectFirstRunCopy(): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(FIRST_RUN_COPY);
  return out;
}
