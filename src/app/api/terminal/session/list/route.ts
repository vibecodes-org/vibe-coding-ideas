// Terminal session LIST — multi-session stage 3 (C3/C4: the "My sessions" panel).
//
// GET returns every one of the caller's ACTIVE sessions, across all ideas,
// newest first — the registry row plus the idea title (a second query; small
// N per user, not worth a join). RLS scopes this to the caller's own rows
// regardless; the explicit `.eq("user_id", ...)` keeps the query itself honest.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

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

    const { data: rows, error } = await supabase
      .from("terminal_sessions")
      .select("sid, idea_id, task_id, task_title, machine_label, cwd, created_at")
      .eq("user_id", user.id)
      .eq("status", "active")
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
      createdAt: row.created_at,
    }));

    return NextResponse.json({ sessions });
  } catch (err) {
    logger.error("Terminal session list error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
