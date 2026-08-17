// Session entry chooser (card cbe60db5, Option A) — PURE derivation of the
// chooser's three sections from the registry's raw rows, so the component
// itself never has to reason about dedupe/48h/null-cwd rules.
//
// The registry list route (GET /api/terminal/session/list) returns every one
// of the caller's rows that's either still ACTIVE or ENDED within the last
// 48h (extended for this card — see that route's doc) — this module turns
// that flat list into "Running now · this board", "Running now · other
// boards", and "Recent · ended in the last 48h", applying the design's rules
// (docs/design-terminal-session-entry-options.html §3), AS SUPERSEDED for
// Recent by Nick's rework 8b instruction below:
//   - Recent = ended ≤48h ago, max 10. Dedupe is per-conversation, not
//     strictly per-folder any more — see the EVERY RESUMABLE CONVERSATION
//     section below.
//   - Live sessions split by whether they belong to the board currently open
//     (`currentIdeaId`) or another one.
//
// NULL-CWD ROWS (bug 9fb9fced, 2026-08-17 — SUPERSEDES the old F4 rule below):
// `cwd` is only recorded once the client's post-connect PATCH lands, which
// never fires at all when the launch had no known project path to begin
// with. F4 used to hide those rows from Recent COMPLETELY, not just their
// Resume button — so a session that force-closed before its cwd ever landed
// vanished from history outright, and a refresh landing in that gap read as
// "nothing to reconnect to" and silently launched a brand-new session (see
// entry-decision.ts's matching fix). A null-cwd row is now KEPT in Recent —
// it still has a sid, an ended time, and often a machine label worth
// showing — with only its Resume affordance suppressed by the chooser UI
// (terminal-session-chooser.tsx), since Resume genuinely has no folder to
// reopen. `ChooserRecentRow.cwd` is `string | null` accordingly.
//
// MACHINE IDENTITY (Nick's sign-off change 2 — "hide conversations that
// aren't on the machine that you're running vibecodes on"): Recent rows also
// get filtered against `storedMachineLabel` (this browser's own recorded
// identity — see machine-identity.ts). A row is hidden ONLY when BOTH sides
// are known and disagree (`row.machineLabel` set AND differs from the stored
// one) — a row with no recorded machine label stays visible (honest
// omission, not assumed foreign), and when this browser has never recorded
// an identity at all, nothing is filtered (same honest-omission spirit as
// the null-cwd fix above: never a silently empty section over data we simply
// don't have an opinion on yet). "Running now"
// sections are NEVER filtered — a live session is unambiguously reachable
// regardless of which machine it's on.
//
// EVERY RESUMABLE CONVERSATION (rework 8b, card cbe60db5 — Nick, explicit,
// 2026-08-12: "is there any way we can show MORE than one resume session?"
// → "yes, make that change."). The design doc's original binding spec (§3)
// said Recent is "max 5, one per project folder" — that one-per-folder rule
// existed only because the legacy Resume path (`claude --continue`) could
// reopen nothing more specific than "the folder's most recent conversation";
// showing several rows for one folder would all have resumed the SAME
// conversation, which is why they were collapsed. Rework 5 gave rows their
// own exact `claudeSessionId` (a real, distinct conversation to resume) —
// once a row can point at ITS OWN conversation, collapsing it into another
// row of the same folder hides genuine history instead of avoiding a
// duplicate. Nick's instruction above supersedes the one-per-folder spec for
// those rows; see this module's row-selection rules just below.
//
// Selection rules, applied AFTER the existing 48h/machine filtering above
// (unchanged) and the existing newest-ended-first sort:
//   1. Every row that carries a `claudeSessionId` is kept, no matter how many
//      other rows share its `cwd` — each one resumes its own exact
//      conversation, so none of them is a duplicate of another.
//   2. Rows WITHOUT a `claudeSessionId` but WITH a recorded `cwd` still can't
//      be told apart from one another by Resume (it falls back to "most
//      recent in this folder", the pre-rework-5 behaviour) — so they keep the
//      old one-per-folder collapse, keeping only the newest such row per
//      `cwd`.
//   3. A folder that already has an ID-bearing row shown ALSO gets its single
//      newest ID-less row shown (not suppressed) — that ID-less row is a
//      distinct, older-era conversation pointer (from before the bridge
//      announced ids, or a bridge too old to ever announce one) that the
//      ID-bearing rows cannot stand in for. This is the simplest honest rule:
//      "one ID-less pointer per folder, plus every distinct ID we have."
//   4. A row with NEITHER a `claudeSessionId` NOR a recorded `cwd` (null-cwd
//      fix above) has no folder to collapse it against another row by — it
//      is never deduped away, only ever capped by RECENT_MAX like everything
//      else.
//   5. The combined result is capped at RECENT_MAX (raised 5 → 10 for this
//      rework — more rows are now legitimately distinct, so the old cap would
//      truncate real history), newest-ended first.

export const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RECENT_MAX = 10;

/** One row as the (extended) list route returns it — active or recently-ended. */
export interface ChooserRegistryRow {
  sid: string;
  ideaId: string;
  ideaTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  machineLabel: string | null;
  cwd: string | null;
  /**
   * Exact-conversation Resume (rework 5, card cbe60db5): the id of the claude
   * conversation this session's bridge spawned/resumed, once announced —
   * null before the bridge attaches, or forever for a bridge too old to
   * announce one. Only meaningful on an ENDED row (a live row is reconnected
   * to, never "resumed" — see `findLiveSessionForTask`/the live sections).
   */
  claudeSessionId: string | null;
  createdAt: string;
  status: "active" | "ended";
  endedAt: string | null;
}

export interface ChooserLiveRow {
  sid: string;
  ideaId: string;
  ideaTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  machineLabel: string | null;
  cwd: string | null;
  createdAt: string;
  /** Design badge: this row is the sid this browser TAB last attached, even past the instant-continue freshness window. */
  wasOpenInThisTab: boolean;
}

export interface ChooserRecentRow {
  sid: string;
  ideaId: string;
  ideaTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  /** Null when the folder was never recorded (null-cwd fix above) — the row still appears, but the chooser UI must not offer Resume for it. */
  cwd: string | null;
  machineLabel: string | null;
  /** Exact-conversation Resume (rework 5) — see ChooserRegistryRow's doc. Null → the chooser falls back to the legacy `--continue` resume. */
  claudeSessionId: string | null;
  endedAt: string;
}

export interface ChooserSections {
  liveHere: ChooserLiveRow[];
  liveElsewhere: ChooserLiveRow[];
  recent: ChooserRecentRow[];
}

function withinRecentWindow(endedAt: string, nowMs: number): boolean {
  const t = Date.parse(endedAt);
  if (Number.isNaN(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age <= RECENT_WINDOW_MS;
}

/**
 * Split the registry's raw rows into the chooser's three sections (design
 * §3). `lastTabSid` (optional — this tab's own remembered sid, see
 * session-snapshot.ts's `readLastTabSid`) badges the matching LIVE row
 * `wasOpenInThisTab`, independent of snapshot freshness — a stale snapshot
 * still deserves the "was open in this tab" hint even once instant-continue
 * itself no longer applies. `storedMachineLabel` (this browser's own recorded
 * machine identity, see machine-identity.ts) filters the Recent section per
 * this module's MACHINE IDENTITY header comment — omit/pass null to show
 * every recent row unfiltered (the pre-this-card behaviour).
 */
export function deriveChooserSections(
  rows: ChooserRegistryRow[],
  currentIdeaId: string,
  nowMs: number = Date.now(),
  lastTabSid: string | null = null,
  storedMachineLabel: string | null = null,
): ChooserSections {
  const toLiveRow = (r: ChooserRegistryRow): ChooserLiveRow => ({
    sid: r.sid,
    ideaId: r.ideaId,
    ideaTitle: r.ideaTitle,
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    machineLabel: r.machineLabel,
    cwd: r.cwd,
    createdAt: r.createdAt,
    wasOpenInThisTab: !!lastTabSid && r.sid === lastTabSid,
  });

  const live = rows.filter((r) => r.status === "active");
  const liveHere = live.filter((r) => r.ideaId === currentIdeaId).map(toLiveRow);
  const liveElsewhere = live.filter((r) => r.ideaId !== currentIdeaId).map(toLiveRow);

  const recentCandidates = rows
    .filter((r): r is ChooserRegistryRow & { endedAt: string } => {
      if (r.status !== "ended") return false;
      // Null-cwd fix (bug 9fb9fced): no cwd check here any more — a row with
      // no recorded folder still belongs in Recent, just without Resume. See
      // this module's header comment.
      if (!r.endedAt) return false;
      if (!withinRecentWindow(r.endedAt, nowMs)) return false;
      // Machine identity: hide only when BOTH sides are known and disagree —
      // see this module's header comment.
      if (storedMachineLabel && r.machineLabel && r.machineLabel !== storedMachineLabel) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)); // newest-ended first

  // Rework 8b (see header comment): rows WITH a claudeSessionId are never
  // deduped against each other — each resumes its own exact conversation.
  // Rows WITHOUT one but WITH a recorded cwd still collapse to the single
  // newest per folder, since Resume can't tell them apart. A row with
  // NEITHER (null-cwd fix) has no folder to key a collapse on, so it's never
  // deduped away. `recentCandidates` is already sorted newest-ended-first, so
  // "first row seen per folder" is "newest per folder" for the id-less
  // collapse.
  const seenIdlessCwd = new Set<string>();
  const selected: (ChooserRegistryRow & { endedAt: string })[] = [];
  for (const r of recentCandidates) {
    if (r.claudeSessionId) {
      selected.push(r);
      continue;
    }
    const cwd = r.cwd ? r.cwd.trim() : null;
    if (!cwd) {
      selected.push(r); // no folder to dedupe against — always kept
      continue;
    }
    if (seenIdlessCwd.has(cwd)) continue; // one id-less row per project folder
    seenIdlessCwd.add(cwd);
    selected.push(r);
  }

  const recent: ChooserRecentRow[] = selected.slice(0, RECENT_MAX).map((r) => ({
    sid: r.sid,
    ideaId: r.ideaId,
    ideaTitle: r.ideaTitle,
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    cwd: r.cwd && r.cwd.trim() ? r.cwd.trim() : null, // blank/whitespace-only normalizes to null, same as the dedupe loop above
    machineLabel: r.machineLabel,
    claudeSessionId: r.claudeSessionId,
    endedAt: r.endedAt,
  }));

  return { liveHere, liveElsewhere, recent };
}

/** Header pill counts ("2 running here · 1 on another board · 2 recent") — a thin, testable view over the sections. */
export function chooserHeaderCounts(sections: ChooserSections): {
  here: number;
  elsewhere: number;
  recent: number;
} {
  return {
    here: sections.liveHere.length,
    elsewhere: sections.liveElsewhere.length,
    recent: sections.recent.length,
  };
}

/**
 * A task-scoped launch (task menu / task card) that already has a LIVE
 * session anywhere gets that row surfaced first with the "already running
 * for this task" dedupe badge (design: "made visible instead of automatic").
 * `here` rows take priority over `elsewhere` — reconnecting on THIS board is
 * the more direct action when both somehow exist.
 */
export function findLiveSessionForTask(
  sections: ChooserSections,
  taskId: string | null | undefined,
): ChooserLiveRow | null {
  if (!taskId) return null;
  return (
    sections.liveHere.find((r) => r.taskId === taskId) ??
    sections.liveElsewhere.find((r) => r.taskId === taskId) ??
    null
  );
}

/**
 * Task-launch-skip-chooser (Nick's explicit product decision, 2026-08-16):
 * clicking the per-task "Launch Claude Code" is unambiguous intent — it
 * should start a new session immediately, with NO chooser/interstitial,
 * UNLESS this EXACT task already has a live-or-recent (≤48h) session, in
 * which case a small task-scoped choice (reconnect/resume vs. start fresh)
 * replaces the full cross-board chooser. This is the single predicate that
 * decision keys on — it never looks at any OTHER task or board, unlike
 * `entryDecision`'s global "is there anything worth choosing between at
 * all" question that still governs board-level (no-taskId) launches.
 *
 * Priority mirrors `findLiveSessionForTask`: a live row here beats a live
 * row elsewhere beats a recent (ended, ≤48h) row — the most actionable
 * match for THIS task wins.
 */
export type TaskSessionMatch =
  | { kind: "live-here" | "live-elsewhere"; row: ChooserLiveRow }
  | { kind: "recent"; row: ChooserRecentRow };

export function findTaskSessionMatch(
  sections: ChooserSections,
  taskId: string | null | undefined,
): TaskSessionMatch | null {
  if (!taskId) return null;
  const here = sections.liveHere.find((r) => r.taskId === taskId);
  if (here) return { kind: "live-here", row: here };
  const elsewhere = sections.liveElsewhere.find((r) => r.taskId === taskId);
  if (elsewhere) return { kind: "live-elsewhere", row: elsewhere };
  const recent = sections.recent.find((r) => r.taskId === taskId);
  if (recent) return { kind: "recent", row: recent };
  return null;
}

/**
 * Card eaa55290 (Nick's field report, 2026-08-17 — two terminal tabs open on
 * the same board with no indication either existed): `liveHere` is every
 * ACTIVE session this user has on the CURRENT idea, which — because
 * `terminal_sessions` RLS is strictly owner-only (see the investigation step
 * on this card) — always means "this same person's tabs/windows", never a
 * collaborator. This is the "is another one of MY tabs already open here"
 * signal, i.e. `liveHere` minus whichever row(s) belong to the caller.
 *
 * A row counts as "ours" when either:
 *   - `wasOpenInThisTab` is set (this browser TAB's own `sessionStorage`-backed
 *     memory of the last session it attached — see session-snapshot.ts's
 *     `rememberLastTabSid`, genuinely per-tab, unlike `localStorage`), or
 *   - its `sid` is in `ownSessionIds` (the sessionIds this `TerminalDock`
 *     instance currently has mounted, via its own `summaries` state) — this
 *     second check covers a 2nd own tab inside the SAME dock (multi-session,
 *     where only the most-recently-connected sid wins the single
 *     `wasOpenInThisTab` slot) and the brief window right after a fresh mint,
 *     before that sessionStorage write has landed.
 *
 * Returns the remaining rows — an empty array means nothing to warn about
 * (0 or 1 live session here, and that one is ours).
 */
export function liveSessionsElsewhereOnThisBoard(
  sections: ChooserSections,
  ownSessionIds: ReadonlySet<string> = new Set(),
): ChooserLiveRow[] {
  return sections.liveHere.filter((r) => !r.wasOpenInThisTab && !ownSessionIds.has(r.sid));
}
