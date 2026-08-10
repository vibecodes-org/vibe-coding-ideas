// In-app terminal — the "My sessions" panel's Helper row (card cc74a067,
// design §5a). Pure status→chip derivation + the exact copy strings from the
// design doc, decoupled from the fetch/poll plumbing so it's fully
// unit-testable without a network mock.
//
// The relay's GET /helper/status (see terminal/relay/src/helper-status.js →
// computeHelperStatus, mirrored 1:1 by this HelperStatus type) already decides
// "connected" vs "stopped unexpectedly" durably server-side. The ONE thing it
// can't know is whether any SESSIONS are live right now — that's the My
// sessions panel's own list, already fetched for the rest of the popover — so
// the "winding down" (lingering) state is derived HERE, by combining the two:
// connected + zero sessions is exactly the linger window (design §2's
// Active → Lingering transition).

/** Mirrors terminal/relay/src/helper-status.js's computeHelperStatus() output. */
export interface HelperStatus {
  connected: boolean;
  version: string | null;
  machineLabel: string | null;
  alwaysOn: boolean;
  stoppedUnexpectedly: boolean;
  lastEventAt: number | null;
}

/**
 * Shared fetch for the caller's own helper status (`GET
 * /api/terminal/helper/status` — see that route's header comment). Both the
 * My sessions panel and the session chooser (card cbe60db5, rework 3) need
 * "the last-known helper version", so the fetch + failure handling lives
 * here once instead of being duplicated. ANY failure — network error,
 * non-2xx, unparseable body — resolves to `null`; every caller treats a
 * failed check as best-effort/silent, never a confirmed "not running".
 */
export async function fetchHelperStatus(): Promise<HelperStatus | null> {
  try {
    const res = await fetch("/api/terminal/helper/status");
    if (!res.ok) return null;
    return (await res.json()) as HelperStatus;
  } catch {
    return null;
  }
}

export type HelperChipKind = "running" | "winding-down" | "not-running" | "stopped-unexpectedly";

export interface HelperChip {
  kind: HelperChipKind;
  /** The pill's own text (design §5 copy table — "Chip · …"). */
  label: string;
  /** The explanatory line under the chip. Never colour-alone (design §7). */
  subline: string;
}

/**
 * Derive the Helper row's chip from the relay's status + the panel's own live
 * session count. `status === null` means "still loading" — the caller decides
 * how to render that (e.g. nothing, or a neutral placeholder); this function
 * only maps a SETTLED status.
 */
export function deriveHelperChip(status: HelperStatus | null, sessionCount: number): HelperChip | null {
  if (!status) return null;
  if (status.connected) {
    return sessionCount > 0
      ? {
          kind: "running",
          label: "Helper running",
          subline: "The small app that connects terminals to this Mac.",
        }
      : {
          kind: "winding-down",
          label: "Winding down",
          subline: "No sessions left — the helper quits itself in about a minute.",
        };
  }
  return status.stoppedUnexpectedly
    ? {
        kind: "stopped-unexpectedly",
        label: "Stopped unexpectedly",
        subline: "It starts fresh next time you launch a terminal.",
      }
    : {
        kind: "not-running",
        label: "Helper not running",
        subline: "It starts automatically next time you launch a terminal.",
      };
}

/** Only "running" and "winding-down" offer a Stop affordance (design §4 mocks). */
export function shouldShowStopButton(chip: HelperChip | null): boolean {
  return chip?.kind === "running" || chip?.kind === "winding-down";
}

/** "Stop" while running, "Stop now" while lingering (design §5 copy table). */
export function stopButtonLabel(chip: HelperChip | null): string {
  return chip?.kind === "winding-down" ? "Stop now" : "Stop";
}

// ── exact copy strings (design §5) ────────────────────────────────────────────

export const HELPER_ROW_STOP_TOAST = "Helper stopped. It starts again next time you launch a terminal.";
export const HELPER_ROW_STOP_FAILED_TOAST =
  "Couldn't reach the helper — it may already be stopped. Check again in a moment.";

export const STOP_CONFIRM_HEADING = "Stop the helper?";
export function stopConfirmBody(sessionCount: number): string {
  return `This ends your ${sessionCount} session${sessionCount === 1 ? "" : "s"}. Claude stops on your machine — your files and unpushed changes stay on disk.`;
}

export function updateNudgeCopy(newVersion: string): string {
  return `A newer terminal helper is available (v${newVersion}).`;
}

/** Relative age for the "stopped unexpectedly" chip's timestamp (design §5a
 *  mock shows a clock time; this mirrors the panel's existing session-age
 *  idiom — src/lib/terminal/session-registry.ts's formatSessionAge — for one
 *  consistent "how long ago" vocabulary across the popover). */
export function formatHelperEventAge(atMs: number, nowMs: number = Date.now()): string {
  const totalMinutes = Math.max(0, Math.floor((nowMs - atMs) / 60_000));
  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ago`;
}

// ── always-on ("Keep helper ready") — approved for v1 (card cc74a067's
// design-review note), despite the design doc's own "follow-up" label. ───────
//
// BINDING DEVIATION from the design doc's exact consent copy: the doc (§5,
// "Always-on toggle") promises "terminals open instantly". Nick's approval
// note for shipping this in v1 requires the WEAKER, honest claim "connect
// faster" instead — v1 has no auto-discovery/zero-prompt start (explicitly
// out of scope, see the card's "what NOT to build" list), so "open instantly"
// would overpromise what always-on alone delivers this release.
export const ALWAYS_ON_LABEL = "Keep helper ready";
export const ALWAYS_ON_CONSENT_BODY =
  "The helper starts when you log in to your Mac and stays running so terminals connect faster. It shows an icon in your menu bar, and you can turn this off or quit it there any time.";
