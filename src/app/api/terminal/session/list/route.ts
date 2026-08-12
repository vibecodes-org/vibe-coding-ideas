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
// process on his machine). Reap first, so a reaped row is returned as a
// "recent · ended" row in the same response instead of a stale "active" one.
//
// TRUE END TIME (rework 8): the reap write is now shared with the mint and
// reattach routes (session-reap.ts) — a reaped row's `ended_at` is backdated
// to its OWN `expires_at`, not the moment this route happened to notice it.
// Nick's follow-up field evidence (2026-08-12): a row created 19:01,
// expires_at 23:01, reaped 03:58 the next day previously showed "ended 0m
// ago" instead of the true "ended ~5h ago". One consequence worth flagging:
// the 48h Recent window (RECENT_WINDOW_MS below) now ages a reaped row from
// its TRUE death time, so a ghost first noticed more than 48h after it
// actually died correctly won't appear in Recent at all — that's desired
// honesty, not a bug.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { RECENT_WINDOW_MS } from "@/lib/terminal/chooser-data";
import { reapExpiredSessions } from "@/lib/terminal/session-reap";

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
    // Shared with the mint/reattach routes (session-reap.ts, rework 8) — each
    // reaped row's ended_at is backdated to its own expires_at, and the write
    // still carries the mandated `.eq("status", "active")` per-row guard so a
    // session ending normally (POST .../end) at the same instant is never
    // double-written — the codebase's `.eq("status", expected)` concurrency
    // pattern (see CLAUDE.md's Concurrency Guards). Resume still works on a
    // reaped row since claude_session_id is untouched.
    await reapExpiredSessions(supabase, user.id, nowMs, "Terminal session list");

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
