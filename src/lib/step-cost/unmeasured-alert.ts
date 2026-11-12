// Card fe1896ee: warn when finished workflow steps have no cost recorded.
// Pure logic: which runs count as "flagged", and which reason to quote.

import { unmeasuredGroupKey, unmeasuredLabel, type UnmeasuredKind, type UnmeasuredLabel } from "./unmeasured";

/** One finished attempt with no cost (a row of workflow_step_unmeasured). */
export interface UnmeasuredAlertRow {
  run_id: string | null;
  kind: UnmeasuredKind;
  reason: string | null;
  created_at: string;
}

/** Even one qualifying record flags a run (Nick, 12 Nov 2026). */
export const UNMEASURED_ALERT_THRESHOLD = 1;
/** How far back the board strip looks. */
export const UNMEASURED_ALERT_DAYS = 14;

/**
 * A step the session deliberately did not hand to a helper ("No helper ran:
 * ...", "No subagent was run: ...", "review skipped ...") carries a written
 * reason. Those are choices, not lost costs, so they never raise the warning.
 * The table has no separate flag for them, so this reads the reason text.
 */
const DELIBERATE_SKIP = /^\s*no[\s-]+(helper|sub-?agent)s?\b|\breview (was )?skipped\b/i;

export function isDeliberateSkip(row: Pick<UnmeasuredAlertRow, "kind" | "reason">): boolean {
  return row.kind === "unavailable" && !!row.reason && DELIBERATE_SKIP.test(row.reason);
}

/** Rows that can raise the warning. */
export function countsTowardAlert(row: UnmeasuredAlertRow): boolean {
  return row.kind !== "codex" && !!row.run_id && !isDeliberateSkip(row);
}

export interface FlaggedReason {
  label: UnmeasuredLabel;
  /** The session's own text of the newest record in the group (null when none was given). */
  reason: string | null;
  kind: UnmeasuredKind;
  count: number;
}

export interface FlaggedRun {
  runId: string;
  count: number;
  lastAt: string;
  topReason: FlaggedReason;
  /** How many other distinct reasons the run's records gave. */
  otherReasons: number;
}

interface Group {
  kind: UnmeasuredKind;
  reason: string | null;
  count: number;
  lastAt: string;
}

function groupReasons(rows: UnmeasuredAlertRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = unmeasuredGroupKey(r.kind, r.reason);
    const g = groups.get(key);
    if (!g) groups.set(key, { kind: r.kind, reason: r.reason, count: 1, lastAt: r.created_at });
    else {
      g.count += 1;
      if (r.created_at > g.lastAt) {
        g.lastAt = r.created_at;
        g.reason = r.reason; // keep the newest record's wording
        g.kind = r.kind;
      }
    }
  }
  return [...groups.values()];
}

function pickTop(groups: Group[]): Group {
  return [...groups].sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1))[0];
}

function toReason(g: Group): FlaggedReason {
  return { label: unmeasuredLabel(g.kind, g.reason), reason: g.reason, kind: g.kind, count: g.count };
}

/** Runs with at least `threshold` qualifying records, newest record first. */
export function flaggedRuns(
  rows: UnmeasuredAlertRow[],
  threshold: number = UNMEASURED_ALERT_THRESHOLD
): FlaggedRun[] {
  const byRun = new Map<string, UnmeasuredAlertRow[]>();
  for (const r of rows) {
    if (!countsTowardAlert(r)) continue;
    const list = byRun.get(r.run_id as string);
    if (list) list.push(r);
    else byRun.set(r.run_id as string, [r]);
  }
  const out: FlaggedRun[] = [];
  for (const [runId, list] of byRun) {
    if (list.length < threshold) continue;
    const groups = groupReasons(list);
    out.push({
      runId,
      count: list.length,
      lastAt: list.reduce((m, r) => (r.created_at > m ? r.created_at : m), list[0].created_at),
      topReason: toReason(pickTop(groups)),
      otherReasons: groups.length - 1,
    });
  }
  return out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** The most common reason across all flagged runs, weighted by record count. */
export function boardTopReason(rows: UnmeasuredAlertRow[], flagged: FlaggedRun[]): FlaggedReason | null {
  const ids = new Set(flagged.map((f) => f.runId));
  const groups = groupReasons(rows.filter((r) => countsTowardAlert(r) && ids.has(r.run_id as string)));
  return groups.length ? toReason(pickTop(groups)) : null;
}

/** ISO timestamp for the start of the board strip's look-back window. */
export function alertWindowStart(now: Date = new Date()): string {
  return new Date(now.getTime() - UNMEASURED_ALERT_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// ---- Board strip payload (serialisable: built on the server, shown by the client) ----

export interface UnmeasuredAlertCard {
  /** Null when the card is archived or gone: counted, but no Open link. */
  taskId: string | null;
  title: string | null;
  count: number;
  lastAt: string;
  reasonText: string;
  reasonQuote: string | null;
}

export interface UnmeasuredAlert {
  cards: UnmeasuredAlertCard[];
  topReasonText: string;
  topReasonQuote: string | null;
}

/**
 * Build the strip payload. `cardsByRun` maps a run id to its card (a missing
 * entry or null means the card is archived or deleted).
 */
export function buildUnmeasuredAlert(
  rows: UnmeasuredAlertRow[],
  cardsByRun: Map<string, { taskId: string; title: string } | null>
): UnmeasuredAlert | null {
  const flagged = flaggedRuns(rows);
  if (flagged.length === 0) return null;
  const top = boardTopReason(rows, flagged);
  if (!top) return null;
  return {
    cards: flagged.map((f) => {
      const card = cardsByRun.get(f.runId) ?? null;
      return {
        taskId: card?.taskId ?? null,
        title: card?.title ?? null,
        count: f.count,
        lastAt: f.lastAt,
        reasonText: f.topReason.label.text,
        reasonQuote: f.topReason.label.quote ?? null,
      };
    }),
    topReasonText: top.label.text,
    topReasonQuote: top.label.quote ?? null,
  };
}
