// In-app terminal — which setup screen to show (card 63a60792, stage 1).
//
// Pure: given how a session ended and what we know about the helper on that
// Mac, pick the screen from the approved mock
// (docs/terminal-agent-setup-mock.html). The panel (terminal-agent-setup-panel.tsx)
// renders it; the strings live in setup-copy.ts.
//
//   start          mock 1/8   the agent isn't installed; one-click install on offer
//   diy            mock 7a    "do it yourself": the command to paste into Terminal
//   old-helper     mock 7b    the helper is too old to install for you
//   signin         mock 3     installed; sign in next
//   ready          mock 5     installed and signed in; Start
//   install-failed mock 6a    the installer didn't finish
//   signin-failed  mock 6b    the sign-in didn't finish

import type { EndedReason } from "./connection";
import type { SetupAction } from "./deep-link";
import { SETUP_MIN_HELPER_VERSION, parseHelperVersion, compareHelperVersions } from "./helper-version";

export type SetupScreen =
  | "start"
  | "diy"
  | "old-helper"
  | "signin"
  | "ready"
  | "install-failed"
  | "signin-failed";

export interface SetupScreenInput {
  reason: EndedReason | null;
  /** The helper version the session's bridge announced, when known. */
  helperVersion: string | null | undefined;
  /** The user chose "Rather do it yourself?" on the start screen. */
  diyOpen: boolean;
}

/** Can this helper run a setup session? Missing or unreadable versions can't. */
export function helperCanRunSetup(version: string | null | undefined): boolean {
  const min = parseHelperVersion(SETUP_MIN_HELPER_VERSION);
  const have = parseHelperVersion(version);
  if (!min || !have) return false;
  return compareHelperVersions(have, min) >= 0;
}

/** Null means "not a setup situation": the ordinary ended panel applies. */
export function setupScreen({ reason, helperVersion, diyOpen }: SetupScreenInput): SetupScreen | null {
  switch (reason) {
    case "agent-not-installed":
      if (!helperCanRunSetup(helperVersion)) return "old-helper";
      return diyOpen ? "diy" : "start";
    case "setup-installed":
      return "signin";
    case "setup-signed-in":
      return "ready";
    case "setup-install-failed":
      return "install-failed";
    case "setup-signin-failed":
      return "signin-failed";
    default:
      return null;
  }
}

/** Which action a setup screen's main button starts, for the launch link. */
export type { SetupAction };
