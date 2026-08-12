// Terminal session reap — SHARED write helper (card cbe60db5, rework 8).
//
// The mint route (POST /api/terminal/session), the reattach route, and the
// list route (rework 7) each independently read this user's own "active"
// rows and mark the expired ones ended — previously three near-identical
// inline copies that all wrote `ended_at: now()`. Nick's field evidence
// (2026-08-12) showed that's a lie: a ghost session's row read "ended 0m
// ago" when it actually died hours earlier, at its own `expires_at` (the
// relay's 4h ceiling). This is now the ONE place any route reaps, so the
// timestamp truth (session-registry.ts's `selectReapUpdates`: ended_at =
// the row's OWN expires_at) can never drift back out of sync between call
// sites.
//
// Per-row `.update()` calls rather than one batched `.in()` update: a batch
// can contain rows with DIFFERENT `expires_at` values, and PostgREST has no
// single-query way to write a different value per row. Session counts per
// user are capped low (session-cap.ts), so N small updates is the honest,
// unsurprising choice — each still carries the mandated `.eq("status",
// "active")` concurrency guard (CLAUDE.md Concurrency Guards) so a session
// ending normally (POST .../end) at the same instant is never double-written.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { selectReapUpdates, type ReapCandidateRow } from "./session-registry";

export interface ReapResult {
  /** How many of the caller's rows were "active" before this call ran. */
  activeBefore: number;
  /** Ids just marked ended because their own expires_at had passed. */
  reapedIds: string[];
}

/**
 * Reads this user's own active rows and marks any expired ones ended, each
 * backdated to its own `expires_at`. Best-effort throughout, matching every
 * other registry read/write in this feature (design doc §9, R2): a failed
 * read or write never blocks the caller — it just leaves the registry a
 * little more stale until the next reap self-corrects.
 *
 * `logLabel` prefixes this call's log lines so a specific route (mint /
 * reattach / list) stays identifiable in structured logs without each route
 * re-implementing the write.
 */
export async function reapExpiredSessions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  nowMs: number = Date.now(),
  logLabel: string = "Terminal session reap",
): Promise<ReapResult> {
  const { data: activeRows, error: activeErr } = await supabase
    .from("terminal_sessions")
    .select("id, status, expires_at")
    .eq("user_id", userId)
    .eq("status", "active");
  if (activeErr) {
    logger.error(`${logLabel}: registry read failed`, { error: activeErr.message });
    return { activeBefore: 0, reapedIds: [] };
  }

  const rows: ReapCandidateRow[] = activeRows ?? [];
  const updates = selectReapUpdates(rows, nowMs);

  if (updates.length > 0) {
    const results = await Promise.all(
      updates.map(({ id, endedAt }) =>
        supabase
          .from("terminal_sessions")
          .update({ status: "ended", ended_at: endedAt })
          .eq("id", id)
          .eq("status", "active"),
      ),
    );
    const failed = results.filter((result) => result.error);
    if (failed.length > 0) {
      logger.error(`${logLabel}: reap write failed`, {
        count: failed.length,
        error: failed[0]?.error?.message,
      });
    } else {
      logger.info(`${logLabel}: reaped expired terminal session rows`, {
        userId,
        count: updates.length,
      });
    }
  }

  return { activeBefore: rows.length, reapedIds: updates.map((update) => update.id) };
}
