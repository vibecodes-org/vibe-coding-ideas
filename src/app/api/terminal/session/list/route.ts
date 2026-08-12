// Terminal session LIST — multi-session stage 3 (C3/C4: the "My sessions"
// panel) EXTENDED for the session entry chooser (card cbe60db5, design F1):
// the chooser needs to know about recently-ended sessions too (its "Recent ·
// ended in the last 48h" section), not just active ones, so this route now
// returns BOTH — every active row, plus every row that ended within the last
// 48h — each carrying `status`/`endedAt` so a caller that only wants
// "Running" (the My-sessions panel) can filter client-side.
//
// GET returns every one of the caller's active-or-recently-ended sessions,
// across all ideas, newest-created first — the registry row plus the idea
// title (a second query; small N per user, not worth a join). RLS scopes
// this to the caller's own rows regardless; the explicit `.eq("user_id", ...)`
// keeps the query itself honest. `claudeSessionId` (rework 5, card cbe60db5)
// is the exact-conversation Resume field — chooser-data.ts consumes it to
// decide whether a Recent row can offer an exact `--resume <id>` or falls
// back to the legacy `--continue`.
//
// REAP-BEFORE-LIST (card cbe60db5 rework 7): the mint route and the reattach
// route already reap this user's own expired-but-still-"active" rows before
// trusting them (R2 mitigation), but this route never did — a session that
// died past its `expires_at` (relay's TERMINAL_MAX_MS hard cap) with no
// browser ever calling mint/reattach again stayed "active" in the registry
// forever, and the chooser presented it as "Running now" (Nick's field
// evidence, 2026-08-12: an 8h32m-old row with no live helper/bridge/claude
// process on his machine). Reap first, using the exact same staleness rule
// those routes use (`selectExpiredSessionIds`, built on `isSessionExpired`),
// so a reaped row is returned as a "recent · ended" row in the same response
// instead of a stale "active" one.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { RECENT_WINDOW_MS } from "@/lib/terminal/chooser-data";
import { selectExpiredSessionIds } from "@/lib/terminal/session-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const nowMs = Date.now();

    // ── REAP: mark this user's own expired-but-still-"active" rows ended
    // BEFORE the list read below, so a ghost never renders as "Running now".
    // Same fields the mint/reattach routes write (status: "ended", ended_at:
    // now) — Resume still works on the reaped row since claude_session_id is
    // untouched. The update is guarded by `.eq("status", "active")` (on top
    // of the `.in("id", ...)` from this user's own just-read active rows) so
    // a session ending normally (POST .../end) at the same instant is never
    // double-written — the codebase's `.eq("status", expected)` concurrency
    // pattern (see CLAUDE.md's Concurrency Guards).
    const { data: activeRows, error: activeErr } = await supabase
      .from("terminal_sessions")
      .select("id, status, expires_at")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (activeErr) {
      logger.error("Terminal session list: registry read for reap failed", { error: activeErr.message });
    }
    const staleIds = selectExpiredSessionIds(activeRows ?? [], nowMs);
    if (staleIds.length > 0) {
      const { error: reapErr } = await supabase
        .from("terminal_sessions")
        .update({ status: "ended", ended_at: new Date(nowMs).toISOString() })
        .in("id", staleIds)
        .eq("status", "active");
      if (reapErr) {
        logger.error("Terminal session list: reap failed", { error: reapErr.message, count: staleIds.length });
      } else {
        logger.info("Reaped expired terminal session rows before list", {
          userId: user.id,
          count: staleIds.length,
        });
      }
    }

    const recentSince = new Date(nowMs - RECENT_WINDOW_MS).toISOString();
    const { data: rows, error } = await supabase
      .from("terminal_sessions")
      .select("sid, idea_id, task_id, task_title, machine_label, cwd, claude_session_id, created_at, status, ended_at")
      .eq("user_id", user.id)
      .or(`status.eq.active,ended_at.gte.${recentSince}`)
      .order("created_at", { ascending: false });
    if (error) {
      logger.error("Terminal session list failed", { error: error.message });
      return NextResponse.json({ error: "Couldn't load your sessions" }, { status: 500 });
    }

    const ideaIds = Array.from(new Set((rows ?? []).map((r) => r.idea_id)));
    let ideaTitles: Record<string, string> = {};
    if (ideaIds.length > 0) {
      const { data: ideas } = await supabase.from("ideas").select("id, title").in("id", ideaIds);
      ideaTitles = Object.fromEntries((ideas ?? []).map((i) => [i.id, i.title]));
    }

    const sessions = (rows ?? []).map((row) => ({
      sid: row.sid,
      ideaId: row.idea_id,
      ideaTitle: ideaTitles[row.idea_id] ?? null,
      taskId: row.task_id,
      taskTitle: row.task_title,
      machineLabel: row.machine_label,
      cwd: row.cwd,
      claudeSessionId: row.claude_session_id,
      createdAt: row.created_at,
      status: row.status,
      endedAt: row.ended_at,
    }));

    return NextResponse.json({ sessions });
  } catch (err) {
    logger.error("Terminal session list error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
