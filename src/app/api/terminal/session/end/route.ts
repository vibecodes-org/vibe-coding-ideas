// Terminal session END — multi-session stage 3 (C3/F5: per-tab End, My-sessions
// "End" and the "End all sessions" panic button).
//
// `POST { sid }` ends ONE of the caller's own sessions; `POST { all: true }`
// ends every one of them. Ownership is resolved via the `terminal_sessions`
// registry (RLS-scoped to the caller — never a raw sid trusted blind), then
// each target is closed at the relay via a short-lived, sid-bound CONTROL
// token (terminal/shared/session-token.mjs → mintControlToken/authorizeControl)
// before the registry row is marked ended.
//
// SKEW-SAFETY: if the relay can't confirm (old relay with no /end route,
// transient network failure), the registry row is marked ended ANYWAY — it is
// a best-effort record (design doc §9, R2), and a user who clicked "End" must
// see it reflected in "My sessions" even when the relay call itself failed.
// `relayConfirmed` on each result reports that partial-success case honestly
// instead of silently masking it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { mintControlToken } from "../../../../../../terminal/shared/session-token.mjs";
import { relayHttpBaseUrl } from "@/lib/terminal/relay-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.union([
  z.object({ sid: z.string().min(1).max(128) }),
  z.object({ all: z.literal(true) }),
]);

interface EndResult {
  sid: string;
  ended: boolean;
  /** Did the relay itself confirm the close, vs. a best-effort registry-only end? */
  relayConfirmed: boolean;
}

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session end failed: TERMINAL_SESSION_SECRET not configured");
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

    // Resolve targets — ALWAYS the caller's own active rows. RLS also enforces
    // this (owner-only policies), but the explicit filter keeps the query
    // honest even if this route ever runs under a different client.
    let query = supabase
      .from("terminal_sessions")
      .select("id, sid")
      .eq("user_id", user.id)
      .eq("status", "active");
    if ("sid" in parsed.data) query = query.eq("sid", parsed.data.sid);
    const { data: targets, error: targetsErr } = await query;
    if (targetsErr) {
      logger.error("Terminal session end: target lookup failed", { error: targetsErr.message });
      return NextResponse.json({ error: "Couldn't look up your sessions" }, { status: 500 });
    }

    if (!targets || targets.length === 0) {
      // Not an error — an already-ended/foreign sid, or "end all" with none
      // active. The caller (My sessions) treats an empty result list as a no-op.
      return NextResponse.json({ results: [] satisfies EndResult[] });
    }

    const httpBase = relayHttpBaseUrl();
    const results: EndResult[] = [];
    for (const target of targets) {
      let relayConfirmed = false;
      try {
        const control = await mintControlToken({ sub: user.id, sid: target.sid, secret });
        const res = await fetch(`${httpBase}/end?session=${encodeURIComponent(target.sid)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${control}` },
        });
        // Any response the relay actually sent (ended:true, or the honest
        // ended:false/"no-session") counts as CONFIRMED — the relay understood
        // the call. A thrown fetch (connection refused / DNS / old relay with
        // no route at all) is the "couldn't confirm" case handled below.
        relayConfirmed = res.ok;
        if (!res.ok) {
          logger.warn("Terminal session end: relay rejected the control call", {
            sid: target.sid,
            status: res.status,
          });
        }
      } catch (err) {
        logger.warn("Terminal session end: relay unreachable — ending registry-only (skew-safe)", {
          sid: target.sid,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const { error: updateErr } = await supabase
        .from("terminal_sessions")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", target.id);
      if (updateErr) {
        logger.error("Terminal session end: registry update failed", {
          sid: target.sid,
          error: updateErr.message,
        });
      }
      results.push({ sid: target.sid, ended: true, relayConfirmed });
    }

    logger.info("Ended terminal session(s)", { userId: user.id, count: results.length });
    return NextResponse.json({ results });
  } catch (err) {
    logger.error("Terminal session end error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
