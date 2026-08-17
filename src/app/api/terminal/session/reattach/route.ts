// Terminal session REATTACH — session entry chooser + reload-reattach (card
// cbe60db5, design item 4). A SIBLING to the mint route (POST /api/terminal/
// session), not a variant of it: this mints fresh browser/bridge/helper
// tokens for a session id that's ALREADY LIVE — the chooser's Reconnect,
// instant-continue, "My sessions" Reconnect, and the popped-window reload's
// own reconnect panel all call this instead of the mint route, because none
// of them are starting a NEW session. Reconnect-relaunch fix: it used to mint
// ONLY the browser token, which left nothing able to fire the vibecodes://
// deep link that relaunches the local helper — see the bridge/helper minting
// below.
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
import { mintSessionTokens, mintHelperToken } from "../../../../../../terminal/shared/session-token.mjs";
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
      .select("sid, idea_id, status, expires_at, cwd, claude_session_id")
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
      // Fix 3 (card 9fb9fced): the specific failure path a reconnect/reattach
      // hits when the target session turns out to already be closed — the
      // suspected root cause of the original bug, and previously silent
      // server-side (the client only ever saw a toast). `reason` distinguishes
      // a genuinely unknown sid ("not-found") from a session this registry
      // already knows died ("ended"/"expired") — the latter two are exactly
      // the race this card's Fix 2 (relay session-closed callback) targets.
      logger.warn("Terminal session reattach: target already unreachable", { sid, reason });
      const error =
        reason === "not-found"
          ? "Session not found"
          : reason === "ended"
            ? "This session has ended — start a new one or resume it."
            : "This session has expired — start a new one.";
      return NextResponse.json({ error, code: `reattach_${reason}` }, { status });
    }

    // Mint a fresh BROWSER token for the SAME sid — plus a fresh BRIDGE token
    // (mintSessionTokens mints both off the same sid/claims) and a fresh
    // HELPER token, exactly like the mint route does. Reconnect-relaunch fix:
    // a reattach used to hand back ONLY the browser token, so nothing could
    // ever fire the vibecodes:// deep link that relaunches the local helper —
    // the browser leg would open and then wait forever for a bridge that had
    // no way to know it should attach (the helper auto-quits when idle, so in
    // the common case there's no bridge running at all). These two extra
    // tokens are exactly what `fireLaunchDeepLink` needs to relaunch it, the
    // same way the initial mint does for a fresh `connect({autoLaunch:true})`.
    const [tokens, helperToken] = await Promise.all([
      mintSessionTokens({ sub: user.id, idea: row.idea_id, sid, secret }),
      mintHelperToken({ sub: user.id, secret }),
    ]);

    logger.info("Reattached terminal session (fresh browser/bridge/helper tokens)", { userId: user.id, sid });

    return NextResponse.json({
      sessionId: tokens.sid,
      ideaId: tokens.idea,
      expiresAt: tokens.exp,
      browserToken: tokens.browser,
      bridgeToken: tokens.bridge,
      helperToken,
      // Bug cbe60db5-followup: the registry row already knows the folder/
      // conversation this session was running — forward it so the reattached
      // browser leg can seed its own cwd/claudeSessionId (attachToExisting),
      // exactly like a fresh connect() seeds them from the launch prompt.
      // Without this, a session that ends AFTER a reload-reattach / instant-
      // continue / chooser-Reconnect / pop-out bring-back never offers
      // "Resume this conversation" (canResume requires sessionCwd), even
      // though the server has known the folder the whole time.
      cwd: row.cwd,
      claudeSessionId: row.claude_session_id,
    });
  } catch (err) {
    logger.error("Terminal session reattach error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
