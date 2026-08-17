// Session entry chooser + reload-reattach (card cbe60db5) — the top-level
// PURE decision every terminal entry point (dock chevron, board toolbar "In
// the browser", a task-launch bus event) routes through before it's allowed
// to mint or attach anything (design's Common Foundations F1 + the instant-
// continue variant).
//
// Exactly one of three outcomes, in this priority order:
//   1. instant-continue — a fresh (<60s) snapshot for a sid that IS a live,
//      owned session in the registry → reattach it immediately, no click.
//   2. chooser           — any other live session, or any recent (≤48h)
//      ended session exists → render the chooser, mint nothing until a
//      click.
//   3. empty-launch      — nothing live or recent anywhere → today's
//      unchanged open→launch behaviour (F1: "there is nothing to choose
//      between, and this is explicitly fine").
//
// Bug 9fb9fced (2026-08-17): `isRecentEnded` used to also require a recorded
// `cwd`, mirroring chooser-data.ts's old F4 filter. A session whose cwd was
// never recorded (the PATCH that saves it only fires when the launch already
// had a known project path) then read as neither live nor recent — this
// function returned `empty-launch`, and the dock silently minted a brand-new
// session instead of showing the chooser/ended screen for a session that had
// in fact just ended. `cwd` is no longer part of this predicate; a recently-
// ended row with no recorded folder still routes to `chooser` (it just can't
// offer Resume there — see chooser-data.ts's matching fix).

import { RECENT_WINDOW_MS } from "./chooser-data";
import { isSnapshotFresh } from "./session-snapshot";

/** The minimal per-row shape this decision needs — a subset of ChooserRegistryRow. */
export interface EntryRegistryRow {
  sid: string;
  status: "active" | "ended";
  cwd: string | null;
  endedAt: string | null;
}

export interface EntrySnapshotInfo {
  sid: string;
  savedAt: number;
}

export type EntryDecision =
  | { kind: "instant-continue"; sid: string }
  | { kind: "chooser" }
  | { kind: "empty-launch" };

function isRecentEnded(row: EntryRegistryRow, nowMs: number): boolean {
  if (row.status !== "ended") return false;
  if (!row.endedAt) return false;
  const t = Date.parse(row.endedAt);
  if (Number.isNaN(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age <= RECENT_WINDOW_MS;
}

/**
 * `rows` — every one of the caller's registry rows (active + recently-ended,
 * exactly what the extended list route returns; see chooser-data.ts for the
 * shared 48h/cwd rules this mirrors). `snapshotInfo` — this tab's own
 * `vc:term:snap:<sid>` metadata, if any (see session-snapshot.ts); `null`
 * when nothing was ever saved in this tab.
 */
export function decideEntryBehaviour(
  rows: EntryRegistryRow[],
  snapshotInfo: EntrySnapshotInfo | null,
  nowMs: number = Date.now(),
): EntryDecision {
  if (snapshotInfo && isSnapshotFresh(snapshotInfo.savedAt, nowMs)) {
    const row = rows.find((r) => r.sid === snapshotInfo.sid && r.status === "active");
    if (row) return { kind: "instant-continue", sid: snapshotInfo.sid };
  }

  const hasLive = rows.some((r) => r.status === "active");
  const hasRecent = rows.some((r) => isRecentEnded(r, nowMs));
  if (hasLive || hasRecent) return { kind: "chooser" };

  return { kind: "empty-launch" };
}
