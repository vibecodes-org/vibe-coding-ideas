// Terminal session USAGE — the bridge sends the main window's own usage
// totals for its Claude conversation (card f2a563ca).
//
// `POST { sid, token, conversationId, hours, stepIds, firstCallAt, lastCallAt }`,
// sent hourly while a session runs and once when it ends. Each send carries the
// whole conversation's figures for the last 35 days, so writes replace: the
// hour rows upsert on (user_id, conversation_id, hour, model), and sending the same
// totals twice changes nothing. Rows this conversation has in that window but
// the send no longer carries (hours that dropped to zero once a step closed) are
// deleted, so usage a step has since taken over is not counted twice.
//
// AUTH: the bridge's own session token (authorizeBridgeSession). An ended row
// is accepted (the last send happens as the row ends); a missing row is 409.
// The board and owner come from the session row, never from the request, and
// when the row names a conversation the request's must match it (403). Figures
// are keyed by user as well as conversation, so a second user sending the same
// conversation id gets their own rows and can neither read nor change the
// first user's; every write and delete is scoped by the owner.
//
// PRIVACY: numbers, model names, times, step ids and the conversation id only.
// The schema is strict, so any extra key is refused.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { authorizeBridgeSession } from "@/lib/terminal/bridge-session-auth";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 35;
const CHUNK = 500;
const count = z.number().int().min(0).max(1e13);

const HourSchema = z
  .object({
    hour: z.string().datetime(),
    model: z.string().min(1).max(80),
    calls: z.number().min(0).max(1e9),
    input_tokens: count,
    output_tokens: count,
    cache_read_tokens: count,
    cache_write_5m_tokens: count,
    cache_write_1h_tokens: count,
  })
  .strict();

const BodySchema = z
  .object({
    sid: z.string().min(1).max(128),
    token: z.string().min(1).max(4096),
    conversationId: z.string().uuid(),
    hours: z.array(HourSchema).max(2000),
    stepIds: z.array(z.string().uuid()).max(2000),
    firstCallAt: z.string().datetime().nullable(),
    lastCallAt: z.string().datetime().nullable(),
  })
  .strict();

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal usage record failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sid, token, conversationId, hours, stepIds, firstCallAt, lastCallAt } = parsed.data;

    const since = Date.now() - WINDOW_DAYS * 86_400_000;
    const future = Date.now() + 3_600_000;
    if (hours.some((h) => Date.parse(h.hour) < since || Date.parse(h.hour) > future)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const auth = await authorizeBridgeSession(supabase, { sid, token, secret });
    if (!auth.ok) {
      if (auth.status === 500) {
        logger.error("Terminal usage record: registry read failed", { sid });
        return NextResponse.json({ error: "Couldn't read the session registry" }, { status: 500 });
      }
      logger.warn("Terminal usage record rejected (auth)", { sid, reason: auth.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!auth.row) {
      return NextResponse.json({ error: "session-not-found" }, { status: 409 });
    }
    const { user_id: ownerId, idea_id: ideaId } = auth.row;

    const { data: extra, error: extraErr } = await supabase
      .from("terminal_sessions")
      .select("claude_session_id, machine_label")
      .eq("sid", sid)
      .maybeSingle();
    if (extraErr) {
      logger.error("Terminal usage record: session read failed", { sid, error: extraErr.message });
      return NextResponse.json({ error: "Couldn't read the session registry" }, { status: 500 });
    }
    if (extra?.claude_session_id && extra.claude_session_id.toLowerCase() !== conversationId.toLowerCase()) {
      logger.warn("Terminal usage record refused: conversation mismatch", { sid, ideaId });
      return NextResponse.json({ error: "conversation-mismatch" }, { status: 403 });
    }

    const updatedAt = new Date().toISOString();
    for (let i = 0; i < hours.length; i += CHUNK) {
      const { error } = await supabase.from("session_main_usage_hours").upsert(
        hours.slice(i, i + CHUNK).map((h) => ({
          conversation_id: conversationId,
          user_id: ownerId,
          idea_id: ideaId,
          ...h,
          updated_at: updatedAt,
        })),
        { onConflict: "user_id,conversation_id,hour,model" },
      );
      if (error) {
        logger.error("Terminal usage record: hour upsert failed", { sid, ideaId, error: error.message });
        return NextResponse.json({ error: "Couldn't save the usage" }, { status: 500 });
      }
    }

    // Every hour this conversation has inside the window the send covers (a
    // little inside its edge, as the bridge cuts at its own clock) that this
    // request did not just write is stale: delete it.
    // A send at the bridge's cap (2000 rows) has cut its oldest hours off, so those are left alone.
    const windowStart = new Date(since + 3_600_000).getTime();
    const deleteFrom =
      hours.length >= 2000 ? Math.max(windowStart, Math.min(...hours.map((h) => Date.parse(h.hour)))) : windowStart;
    const { error: staleErr } = await supabase
      .from("session_main_usage_hours")
      .delete()
      .eq("conversation_id", conversationId)
      .eq("user_id", ownerId)
      .gte("hour", new Date(deleteFrom).toISOString())
      .lt("updated_at", updatedAt);
    if (staleErr) {
      logger.error("Terminal usage record: stale hour delete failed", { sid, ideaId, error: staleErr.message });
      return NextResponse.json({ error: "Couldn't save the usage" }, { status: 500 });
    }

    const { error: convErr } = await supabase.from("session_main_usage").upsert(
      {
        conversation_id: conversationId,
        user_id: ownerId,
        idea_id: ideaId,
        machine_label: extra?.machine_label ?? null,
        first_call_at: firstCallAt,
        last_call_at: lastCallAt,
        step_ids: stepIds,
        reported_at: updatedAt,
      },
      { onConflict: "user_id,conversation_id" },
    );
    if (convErr) {
      logger.error("Terminal usage record: conversation upsert failed", { sid, ideaId, error: convErr.message });
      return NextResponse.json({ error: "Couldn't save the usage" }, { status: 500 });
    }

    logger.info("Terminal main-window usage recorded", { sid, ideaId, hours: hours.length });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("Terminal usage record error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
