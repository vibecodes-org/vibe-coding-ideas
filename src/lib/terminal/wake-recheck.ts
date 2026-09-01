// Sleep/resume routing fix (card dccd6c95) — PURE derivation for the dock's
// "wake recheck": on tab visibility/online regain, terminal-dock.tsx re-fetches
// the registry (its existing `refreshRegistry`) and calls this module to find
// which OPEN tabs' sessions the server now says are `ended`, even though the
// tab's own socket may still be sitting in "error" (a Mac that slept never
// fires a clean close — the socket just stops, and nothing here re-evaluates
// until something like this notices).
//
// Investigation findings this builds on (task 0dd23803's Reproduce &
// Investigate, cited in the board comment): terminal-dock.tsx has no
// visibilitychange/focus/online listener, so a tab that dies while the
// browser tab is hidden or the Mac is asleep never re-checks anything —
// `refreshRegistry` only ever runs once, on mount. `/api/terminal/session/
// list` already returns `cwd`/`claudeSessionId`/`endedAt` for a row ended
// within the last 48h (the same fields the chooser's Recent section already
// resumes from), so no route change is needed — this module only has to
// cross-reference what it returns against the dock's own open tabs.
//
// Deliberately narrow: this NEVER decides to resume anything — it only
// answers "does this open tab now have resume material available", which
// terminal-dock.tsx threads into TerminalSessionView's `wakeResume` prop so
// Fix 1's error-panel Resume affordance can light up. Offering, never
// auto-executing, is the approved scope (human sign-off gates any actual
// relaunch — see terminal-session-view.tsx's `handleResume`).

/** The minimal per-row shape this decision needs — a subset of ChooserRegistryRow (chooser-data.ts). */
export interface WakeRegistryRow {
  sid: string;
  status: "active" | "ended";
  cwd: string | null;
  claudeSessionId: string | null;
  endedAt: string | null;
}

/** One open dock tab, as far as this module needs to know about it. */
export interface WakeTabSid {
  /** The tab's `SessionEntry.key` (terminal-tabs.ts) — stable across the tab's lifetime. */
  key: string;
  /**
   * This tab's session id, mirrored from `SessionSummary.sessionId`
   * (terminal-session-view.tsx) — set once a session is created/attached and
   * never cleared on error (see use-terminal-session.ts's `setPair` call
   * sites), so it stays available for a tab that's currently erroring. `null`
   * for a tab that never got far enough to have one (nothing to look up).
   */
  sid: string | null;
}

/** What Fix 1's error panel needs to offer Resume — mirrors `TerminalSessionViewProps.wakeResume`. */
export interface WakeResumeMaterial {
  cwd: string;
  claudeSessionId: string | null;
  endedAt: string;
}

/**
 * Given the caller's fresh registry rows and its currently-open tabs, returns
 * the resume material for every tab whose sid the registry now reports
 * `ended` WITH enough to resume (a recorded `cwd`; `claudeSessionId` is
 * optional — its absence just falls back to `--continue`, same as everywhere
 * else Resume degrades). Keyed by tab `key`, not `sid` — that's what
 * `terminal-dock.tsx` threads back into a specific `TerminalSessionView`.
 *
 * A tab is OMITTED from the result (never present with `null`) when: it has
 * no sid yet; the registry has no row for its sid at all (nothing to say —
 * never guess); the row is still `active` (nothing died); or the row is
 * `ended` but has no recorded `cwd` (no folder, nothing resumable — Fix 1's
 * `wakeResume` consumer already requires `cwd` before it'll offer anything,
 * this module just keeps that same honesty at the source).
 */
export function computeWakeRecheck(
  rows: readonly WakeRegistryRow[],
  tabs: readonly WakeTabSid[],
): Record<string, WakeResumeMaterial> {
  const bySid = new Map(rows.map((row) => [row.sid, row]));
  const result: Record<string, WakeResumeMaterial> = {};
  for (const tab of tabs) {
    if (!tab.sid) continue;
    const row = bySid.get(tab.sid);
    if (!row) continue;
    if (row.status !== "ended") continue;
    if (!row.cwd || !row.endedAt) continue;
    result[tab.key] = { cwd: row.cwd, claudeSessionId: row.claudeSessionId, endedAt: row.endedAt };
  }
  return result;
}
