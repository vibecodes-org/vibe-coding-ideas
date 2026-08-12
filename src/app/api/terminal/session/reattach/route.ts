// Terminal session REATTACH — session entry chooser + reload-reattach (card
// cbe60db5, design item 4). A SIBLING to the mint route (POST /api/terminal/
// session), not a variant of it: this mints a fresh BROWSER-role token for a
// session id that's ALREADY LIVE — the chooser's Reconnect, instant-continue,
// and the popped-window reload's own reconnect panel all call this instead
// of the mint route, because none of them are starting a NEW session.
//
// Deliberately exempt from the cap (E1) and the mint rate limit (E2) — F2:
// "no new registry row, exempt from the session cap and the mint rate limit
// (recovering capacity, not consuming it)". Auth + ownership mirror the mint
// route exactly (a member-scoped Supabase client; RLS also enforces
// user_id-scoping on the read below, same belt-and-braces pattern as every
// other route in this feature).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { mintSessionTokens } from "../../../../../../terminal/shared/session-token.mjs";
import { decideReattach } from "@/lib/terminal/session-registry";
import { reapExpiredSessions } from "@/lib/terminal/session-reap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sid: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session reattach failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sid } = parsed.data;
    const nowMs = Date.now();

    // Reap this user's own expired-but-still-"active" rows first (same R2
    // mitigation as the mint route, now shared via session-reap.ts — rework
    // 8) — mirrors that route's reap step so the registry never drifts
    // further behind just because reattach reads never triggered it, and so
    // a reaped row's ended_at is backdated to its own expires_at the same
    // way everywhere. Best-effort: a failed reap never blocks the decision
    // below (decideReattach checks expires_at itself either way).
    await reapExpiredSessions(supabase, user.id, nowMs, "Terminal session reattach");

    // Ownership: the row must belong to THIS user (RLS also scopes this, but
    // the explicit filter keeps the query honest regardless of client).
    const { data: row, error: rowErr } = await supabase
      .from("terminal_sessions")
      .select("sid, idea_id, status, expires_at")
      .eq("sid", sid)
      .eq("user_id", user.id)
      .maybeSingle();
    if (rowErr) {
      logger.error("Terminal session reattach: row lookup failed", { sid, error: rowErr.message });
      return NextResponse.json({ error: "Couldn't look up that session" }, { status: 500 });
    }

    const decision = decideReattach(row, nowMs);
    if (!decision.ok || !row) {
      const status = !decision.ok && decision.reason !== "not-found" ? 409 : 404;
      const reason = !decision.ok ? decision.reason : "not-found";
      const error =
        reason === "not-found"
          ? "Session not found"
          : reason === "ended"
            ? "This session has ended — start a new one or resume it."
            : "This session has expired — start a new one.";
      return NextResponse.json({ error, code: `reattach_${reason}` }, { status });
    }

    // Mint a fresh BROWSER token for the SAME sid. No registry insert (F2:
    // not a new session), no cap/rate-limit bookkeeping to touch.
    const tokens = await mintSessionTokens({ sub: user.id, idea: row.idea_id, sid, secret });

    logger.info("Reattached terminal session (fresh browser token)", { userId: user.id, sid });

    return NextResponse.json({
      sessionId: tokens.sid,
      ideaId: tokens.idea,
      expiresAt: tokens.exp,
      browserToken: tokens.browser,
    });
  } catch (err) {
    logger.error("Terminal session reattach error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
