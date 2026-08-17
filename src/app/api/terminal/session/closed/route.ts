// Terminal session CLOSED — server-to-server callback FROM the relay (card
// 9fb9fced, Fix 2: real-time relay→app closure notification).
//
// `POST { sid, reason }` — called by the Cloudflare relay's DO alarm the
// instant it force-closes a session (idle-timeout or max-duration; see
// terminal/relay/src/index.js's `notifyAppSessionClosed`), so the Supabase
// registry learns the session died IN REAL TIME instead of the app having to
// separately guess an expiry at mint time and reconcile it lazily on
// whichever request (mint/reattach/list) happened to run next. That lazy-
// guess window was the exact race behind bug 9fb9fced: a client's page
// refresh could land inside it and read a stale "still active" row for a
// session that had, in fact, already ended a moment earlier — the refresh
// then found nothing live and nothing recognizably resumable, and silently
// launched a brand-new session with no "your session ended" messaging at
// all.
//
// AUTH: no user session exists for this call — it's server-to-server from the
// relay, not a browser request. Authorized instead by a short-lived "notify"
// token (terminal/shared/session-token.mjs → authorizeNotify), signed by the
// relay with the SAME TERMINAL_SESSION_SECRET both sides already hold. A
// service-role Supabase client is required for the same reason (mirrors
// src/app/api/notifications/email/route.ts, the other webhook with no user
// session in this codebase) — RLS has no authenticated user to scope to here.
//
// SKEW-SAFETY: the write carries the mandated `.eq("status", "active")`
// concurrency guard (CLAUDE.md's Concurrency Guards) — if the row already
// ended (the user's own "End", or a reap that raced this callback) this is
// an honest no-op, never a double-write clobbering a real ended_at.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { authorizeNotify } from "../../../../../../terminal/shared/session-token.mjs";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sid: z.string().min(1).max(128),
  reason: z.enum(["idle_timeout", "time_limit"]).optional(),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session closed callback failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sid, reason } = parsed.data;

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const auth = await authorizeNotify({ token, secret, session: sid });
    if (!auth.ok) {
      logger.warn("Terminal session closed callback rejected (auth)", { sid, reason: auth.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("terminal_sessions")
      .update({ status: "ended", ended_at: nowIso })
      .eq("sid", sid)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) {
      logger.error("Terminal session closed callback: registry update failed", { sid, error: error.message });
      return NextResponse.json({ error: "Couldn't update the session registry" }, { status: 500 });
    }

    if (!data) {
      // Not an error: the row may already be ended (a user's own "End", or a
      // reap that raced this callback) — an honest no-op, not a failure.
      logger.info("Terminal session closed callback: no active row to update", {
        sid,
        reason: reason ?? null,
      });
      return NextResponse.json({ updated: false });
    }

    logger.info("Terminal session closed callback: registry updated in real time", {
      sid,
      reason: reason ?? null,
      endedAt: nowIso,
    });
    return NextResponse.json({ updated: true });
  } catch (err) {
    logger.error("Terminal session closed callback error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
