// In-app terminal — Terminal P2 (E2EE) rollout UX copy, single-sourced.
//
// Every exact string from docs/terminal-e2ee-ux-design.html §6 ("Copy table")
// lives here — mirroring how helper-update-flow.ts exports its own strings —
// so no surface can drift from the approved wording, and every future surface
// reuses the same constant instead of retyping it.
//
// AC-6/AC-7 (version-skew matrix, design §7): none of this copy may name a
// version number, claim the update "adds encryption" as a dated fact, or
// assume the web app and helper deployed together — e2ee-copy.test.ts
// enforces that mechanically.

import { shouldShowHelperUpdateNudge } from "./helper-version";

export const E2EE_COPY = {
  chip: {
    notE2ee: "Not encrypted end-to-end",
    notE2eeTooltip:
      "Traffic to this session is protected in transit, but the relay server can technically read it. Update the helper to close that gap.",
  },
  nudge: {
    body: "This session isn’t end-to-end encrypted yet — the helper on your Mac needs an update.",
    sub: "Everything keeps working in the meantime; the update takes about a minute.",
  },
  required: {
    pill: "Update needed",
    title: "Update the helper to reconnect",
    body: "Terminal sessions are now end-to-end encrypted, and the helper on your Mac is too old to take part. Nothing was sent unprotected — we stopped before connecting.",
    fine: "The update takes about a minute. Your project files and any local work are untouched.",
  },
  integrity: {
    pill: "Secure link interrupted",
    title: "Secure link interrupted",
    body: "Some data on this session’s encrypted stream couldn’t be verified, so we stopped it rather than show you output we can’t vouch for. This is usually a network hiccup. Your agent may still be running on your machine — reconnecting starts a fresh, verified stream.",
  },
  // Card f0a13bde follow-up: the helper is already up to date, but THIS
  // session couldn't fetch its key from the website when it started. Telling
  // the user to update would be wrong; a new session is what fixes it.
  startupFailed: {
    chipTooltip:
      "Traffic to this session is protected in transit, but the relay server can technically read it. This session couldn’t set up encryption when it started; a new session will.",
    body: "This session isn’t end-to-end encrypted — it couldn’t set up encryption when it started, so messages from other sessions are off for it too.",
    sub: "Your helper is up to date. Close this session and open a new one to get both back.",
  },
  connected: {
    tooltip:
      "Connected · end-to-end encrypted — only this browser tab and the helper on your Mac hold the keys; the relay in between can’t read your session.",
  },
} as const;

/**
 * Which "not encrypted" wording fits: an out-of-date (or unknown) helper gets
 * the update nudge with its Update now button; an up-to-date helper means this
 * session's start-up went wrong, so it says that and offers no update.
 */
export function notEncryptedCopy(helperVersion: string | null | undefined): {
  chipTooltip: string;
  body: string;
  sub: string;
  offerUpdate: boolean;
} {
  if (shouldShowHelperUpdateNudge(helperVersion)) {
    return {
      chipTooltip: E2EE_COPY.chip.notE2eeTooltip,
      body: E2EE_COPY.nudge.body,
      sub: E2EE_COPY.nudge.sub,
      offerUpdate: true,
    };
  }
  return { ...E2EE_COPY.startupFailed, offerUpdate: false };
}
