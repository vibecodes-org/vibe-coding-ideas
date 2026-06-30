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

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
// One shared implementation of the token scheme — also imported by the relay.
import { mintSessionTokens } from "../../../../../terminal/shared/session-token.mjs";

const BodySchema = z.object({
  ideaId: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session mint failed: TERMINAL_SESSION_SECRET not configured");
      return Response.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { ideaId } = parsed.data;

    // Only a member of the idea (author or collaborator) may open a terminal on it.
    const { data: idea } = await supabase
      .from("ideas")
      .select("id, author_id")
      .eq("id", ideaId)
      .maybeSingle();
    if (!idea) {
      return Response.json({ error: "Idea not found" }, { status: 404 });
    }
    if (idea.author_id !== user.id) {
      const { data: collab } = await supabase
        .from("collaborators")
        .select("id")
        .eq("idea_id", ideaId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!collab) {
        return Response.json(
          { error: "Only team members can open a terminal for this idea" },
          { status: 403 },
        );
      }
    }

    const tokens = await mintSessionTokens({ sub: user.id, idea: ideaId, secret });

    logger.info("Minted terminal session tokens", {
      userId: user.id,
      ideaId,
      sid: tokens.sid,
      exp: tokens.exp,
    });

    // Return both leg tokens + the session id. The browser token is for the in-app
    // panel; the bridge token is handed to the local helper (slice 3 wiring).
    return Response.json({
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
    return Response.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
