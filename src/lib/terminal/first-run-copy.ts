// In-app terminal — install-first first-run copy.
//
// Centralised so it can be (a) reused by the dock overlay and (b) unit-asserted to
// contain no error-speak or jargon. The audience is a non-coder: the tone is calm
// and reassuring, never "Failed / Error / Nothing opened" (criterion #7) and never
// port/token/relay jargon (criterion #12). Matches the approved UX (Compass) in
// docs/install-first-terminal-ux.html. The Windows version (card 51d424f7) is
// FIRST_RUN_COPY_WINDOWS below, word for word from the approved mock
// docs/design-windows-terminal-setup.html.

import type { TerminalOs } from "./platform";

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
  // Linux, phones and tablets — calm "coming soon", no deep link (criterion
  // #10). Windows left this panel in release 1b (Nick, 24 Nov 2026: the greyed
  // Windows button and its hint went with it).
  comingSoon: {
    heading: "The in-browser terminal works on Mac and Windows for now",
    body: "It isn't available on this device yet, but you can still run Claude Code the usual way in your own terminal.",
  },
  ready: {
    title: "Ready when you are",
    body: "This Mac is already set up. Start a new session, or pick up one of your other sessions.",
    cta: "Start new session",
    browse: "View my other sessions",
  },
  pill: {
    setup: "One-time setup",
    ready: "Ready",
    notConnected: "Not connected yet",
    comingSoon: "Coming soon",
  },
} as const;

/** One run of a note: plain, or bold (the mock bolds Windows' own button names). */
export interface CopyRun {
  text: string;
  bold?: boolean;
}

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

/** The shape both systems' copy share; Windows adds two setup lines. */
export type FirstRunCopy = Omit<Widen<typeof FIRST_RUN_COPY>, "setup"> & {
  setup: Widen<(typeof FIRST_RUN_COPY)["setup"]> & {
    /** Step 2's yellow note (Windows' blue "protected your PC" box). */
    step2Note?: readonly CopyRun[];
    /** Under the subheading: some features arrive in release 1c. */
    previewNote?: string;
  };
};

/**
 * Windows wording, exactly as the approved mock (middle panel). Only the
 * strings that differ from the Mac are written out; the rest are shared.
 * `previewNote` is the approved-plan addition; release 1c removes it.
 */
export const FIRST_RUN_COPY_WINDOWS: FirstRunCopy = {
  ...FIRST_RUN_COPY,
  setup: {
    ...FIRST_RUN_COPY.setup,
    subheading: "Takes about a minute. You only do this once on this PC.",
    step1Desc: "A small app that lets this page mirror Claude Code from your PC. Your code stays on your computer.",
    step2Title: "Open the file to install VibeCodes",
    step2Desc:
      "When the download finishes, open it. It installs in a few seconds and doesn’t ask for an administrator password.",
    step2Note: [
      { text: "Windows may show " },
      { text: "“Windows protected your PC”", bold: true },
      { text: ". Click " },
      { text: "More info", bold: true },
      { text: ", then " },
      { text: "Run anyway", bold: true },
      { text: ". That’s expected while VibeCodes is new to Windows." },
    ],
    previewNote: "Some features are still coming to Windows.",
    openPrompt:
      "When you click Connect, your browser may ask “Open VibeCodes?” — click Open. That’s expected, and it only happens the first time.",
  },
  connecting: {
    ...FIRST_RUN_COPY.connecting,
    heading: "Connecting to your PC…",
    openNudge: "If your browser asks, click Open VibeCodes.",
  },
  timeoutNew: {
    ...FIRST_RUN_COPY.timeoutNew,
    body: "If you just installed it, make sure you clicked Open when your browser asked — then try again.",
  },
  timeoutReturning: {
    ...FIRST_RUN_COPY.timeoutReturning,
    heading: "Couldn’t reach the helper on this PC",
    reassure: "Your work on your PC is safe.",
  },
  ready: {
    ...FIRST_RUN_COPY.ready,
    body: "This PC is already set up. Start a new session, or pick up one of your other sessions.",
  },
};

/** The first-run copy for this visitor's system (the Mac copy for anything but Windows). */
export function firstRunCopyFor(os: TerminalOs | null | undefined): FirstRunCopy {
  return os === "windows" ? FIRST_RUN_COPY_WINDOWS : FIRST_RUN_COPY;
}

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

/** Flatten every string value in the copy (used by the forbidden-words test). Defaults to both systems. */
export function collectFirstRunCopy(copy: unknown = [FIRST_RUN_COPY, FIRST_RUN_COPY_WINDOWS]): string[] {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(copy);
  return out;
}
