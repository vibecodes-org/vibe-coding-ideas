// Terminal session token minting — SLICE 2 (auth + ownership).
//
// Mints the short-lived, owner-bound tokens the in-app terminal relay requires.
// The authenticated VibeCodes user gets a token PER LEG (browser + bridge) for one
// session id; both carry the same `sub` so the relay can prove the two legs belong
// to the same human and refuse a cross-user attach.
//
// Signing lives in the SHARED module (terminal/shared/session-token.mjs) so the
// exact same code verifies on the Cloudflare relay. The secret comes from the
// TERMINAL_SESSION_SECRET env var — never hard-coded.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
// One shared implementation of the token scheme — also imported by the relay.
import { mintSessionTokens } from "../../../../../terminal/shared/session-token.mjs";
import {
  getServerTerminalSessionCap,
  getTerminalMintRateLimit,
  capRefusalMessage,
  RATE_LIMIT_MESSAGE,
  CAP_REFUSAL_CODE,
  RATE_LIMIT_CODE,
} from "@/lib/terminal/session-cap";
import {
  computeSessionExpiresAt,
  decideCap,
  decideRateLimit,
  isSessionExpired,
  rateLimitWindowStart,
} from "@/lib/terminal/session-registry";

// Pin the runtime: this handler mints per-request, auth-bound tokens and must never
// be statically optimized or flipped to the Edge runtime. The pin stays as hygiene,
// but NOTE: the "No response is returned from route handler" 500s this route suffered
// (card b6e5c728) were NOT a runtime-flip problem. Root cause: mcp-handler@1.0.7's
// transport (@hono/node-server getRequestListener) replaced globalThis.Response when
// the MCP route loaded in the same function instance, so Next's `res instanceof
// Response` check rejected this route's NextResponse.json() — fixed by bumping
// mcp-handler to 1.1.0 (web-standard transport, no global mutation).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  ideaId: z.string().uuid(),
  // Multi-session stage 3 (C1/C4): carried through to the terminal_sessions
  // registry row so "My sessions" can show a task-scoped label. Both optional
  // — a board-level launch (toolbar "In the browser") carries neither.
  taskId: z.string().uuid().optional(),
  taskTitle: z.string().trim().min(1).max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session mint failed: TERMINAL_SESSION_SECRET not configured");
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
    const { ideaId, taskId, taskTitle } = parsed.data;

    // Only a member of the idea (author or collaborator) may open a terminal on it.
    const { data: idea } = await supabase
      .from("ideas")
      .select("id, author_id")
      .eq("id", ideaId)
      .maybeSingle();
    if (!idea) {
      return NextResponse.json({ error: "Idea not found" }, { status: 404 });
    }
    if (idea.author_id !== user.id) {
      const { data: collab } = await supabase
        .from("collaborators")
        .select("id")
        .eq("idea_id", ideaId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!collab) {
        return NextResponse.json(
          { error: "Only team members can open a terminal for this idea" },
          { status: 403 },
        );
      }
    }

    // ── (a) REAP: mark this user's own expired-but-still-"active" rows ended
    // BEFORE trusting any count below (R2 mitigation) — the registry is
    // best-effort and can drift from the relay (e.g. a max-duration close the
    // registry was never told about), so an unreaped stale row would wrongly
    // count against the cap/rate-limit forever.
    const nowMs = Date.now();
    const { data: activeRows, error: activeErr } = await supabase
      .from("terminal_sessions")
      .select("id, expires_at")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (activeErr) {
      logger.error("Terminal session registry read failed", { error: activeErr.message });
    }
    const staleIds = (activeRows ?? [])
      .filter((row) => isSessionExpired(row.expires_at, nowMs))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      const { error: reapErr } = await supabase
        .from("terminal_sessions")
        .update({ status: "ended", ended_at: new Date(nowMs).toISOString() })
        .in("id", staleIds);
      if (reapErr) {
        logger.error("Terminal session reap failed", { error: reapErr.message, count: staleIds.length });
      } else {
        logger.info("Reaped expired terminal session rows", { userId: user.id, count: staleIds.length });
      }
    }
    const activeCount = (activeRows?.length ?? 0) - staleIds.length;

    // ── (b) CAP (E1) — refuse before minting anything. ──────────────────────
    const cap = getServerTerminalSessionCap();
    const capDecision = decideCap(activeCount, cap);
    if (!capDecision.ok) {
      const { data: activeSummaries } = await supabase
        .from("terminal_sessions")
        .select("sid, idea_id, task_title, created_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      return NextResponse.json(
        {
          error: capRefusalMessage(cap),
          code: CAP_REFUSAL_CODE,
          cap,
          active: (activeSummaries ?? []).map((row) => ({
            sid: row.sid,
            idea_id: row.idea_id,
            task_title: row.task_title,
            created_at: row.created_at,
          })),
        },
        { status: 409 },
      );
    }

    // ── (c) RATE LIMIT (E2) — distinct state, distinct copy (binding note: NO
    // mention of ending a session — this refusal isn't about the cap). ──────
    const rateLimit = getTerminalMintRateLimit();
    const { count: recentCount, error: recentErr } = await supabase
      .from("terminal_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", rateLimitWindowStart(nowMs));
    if (recentErr) {
      logger.error("Terminal session rate-limit read failed", { error: recentErr.message });
    }
    const rateDecision = decideRateLimit(recentCount ?? 0, rateLimit);
    if (!rateDecision.ok) {
      return NextResponse.json({ error: RATE_LIMIT_MESSAGE, code: RATE_LIMIT_CODE }, { status: 429 });
    }

    // ── (d) MINT + register. ────────────────────────────────────────────────
    const tokens = await mintSessionTokens({ sub: user.id, idea: ideaId, secret });

    const { error: insertErr } = await supabase.from("terminal_sessions").insert({
      sid: tokens.sid,
      user_id: user.id,
      idea_id: ideaId,
      task_id: taskId ?? null,
      task_title: taskTitle ?? null,
      status: "active",
      expires_at: computeSessionExpiresAt(nowMs),
    });
    if (insertErr) {
      // The registry is best-effort (R2) — never fail an otherwise-successful
      // mint just because its bookkeeping row didn't write; the relay session
      // is real either way. My-sessions / the cap count simply undercount this
      // one session until the next reap or mint self-corrects.
      logger.error("Terminal session registry insert failed", {
        error: insertErr.message,
        sid: tokens.sid,
      });
    }

    logger.info("Minted terminal session tokens", {
      userId: user.id,
      ideaId,
      sid: tokens.sid,
      exp: tokens.exp,
    });

    // Return both leg tokens + the session id. The browser token is for the in-app
    // panel; the bridge token is handed to the local helper (slice 3 wiring).
    return NextResponse.json({
      sessionId: tokens.sid,
      ideaId: tokens.idea,
      expiresAt: tokens.exp,
      browserToken: tokens.browser,
      bridgeToken: tokens.bridge,
    });
  } catch (err) {
    logger.error("Terminal session mint error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
