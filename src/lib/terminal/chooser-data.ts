// Session entry chooser (card cbe60db5, Option A) — PURE derivation of the
// chooser's three sections from the registry's raw rows, so the component
// itself never has to reason about dedupe/48h/null-cwd rules.
//
// The registry list route (GET /api/terminal/session/list) returns every one
// of the caller's rows that's either still ACTIVE or ENDED within the last
// 48h (extended for this card — see that route's doc) — this module turns
// that flat list into "Running now · this board", "Running now · other
// boards", and "Recent · ended in the last 48h", applying the design's exact
// rules (docs/design-terminal-session-entry-options.html §3):
//   - Recent = ended ≤48h ago, max 5, ONE per project folder (`cwd`), rows
//     with a null `cwd` hidden entirely (F4: "Resume is hidden entirely when
//     the project folder wasn't recorded — no disabled ghost button").
//   - Live sessions split by whether they belong to the board currently open
//     (`currentIdeaId`) or another one.
//
// MACHINE IDENTITY (Nick's sign-off change 2 — "hide conversations that
// aren't on the machine that you're running vibecodes on"): Recent rows also
// get filtered against `storedMachineLabel` (this browser's own recorded
// identity — see machine-identity.ts). A row is hidden ONLY when BOTH sides
// are known and disagree (`row.machineLabel` set AND differs from the stored
// one) — a row with no recorded machine label stays visible (honest
// omission, not assumed foreign), and when this browser has never recorded
// an identity at all, nothing is filtered (F4-style: never a silently empty
// section over data we simply don't have an opinion on yet). "Running now"
// sections are NEVER filtered — a live session is unambiguously reachable
// regardless of which machine it's on.

export const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RECENT_MAX = 5;

/** One row as the (extended) list route returns it — active or recently-ended. */
export interface ChooserRegistryRow {
  sid: string;
  ideaId: string;
  ideaTitle: string | null;
  taskId: string | null;
  taskTitle: string | null;
  machineLabel: string | null;
  cwd: string | null;
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
  /** Never null/empty — rows without a recorded folder never reach this list (F4). */
  cwd: string;
  machineLabel: string | null;
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
    .filter((r): r is ChooserRegistryRow & { cwd: string; endedAt: string } => {
      if (r.status !== "ended") return false;
      if (!r.cwd || !r.cwd.trim()) return false; // F4: no recorded folder → never shown
      if (!r.endedAt) return false;
      if (!withinRecentWindow(r.endedAt, nowMs)) return false;
      // Machine identity: hide only when BOTH sides are known and disagree —
      // see this module's header comment.
      if (storedMachineLabel && r.machineLabel && r.machineLabel !== storedMachineLabel) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)); // newest-ended first

  const seenCwd = new Set<string>();
  const recent: ChooserRecentRow[] = [];
  for (const r of recentCandidates) {
    const cwd = r.cwd.trim();
    if (seenCwd.has(cwd)) continue; // one per project folder
    seenCwd.add(cwd);
    recent.push({
      sid: r.sid,
      ideaId: r.ideaId,
      ideaTitle: r.ideaTitle,
      taskId: r.taskId,
      taskTitle: r.taskTitle,
      cwd,
      machineLabel: r.machineLabel,
      endedAt: r.endedAt,
    });
    if (recent.length >= RECENT_MAX) break;
  }

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
