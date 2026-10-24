// In-app terminal — the board's agents for a Claude Code or Codex launch, fresh
// or resumed (tasks 59889027, e16d69e8, f4bbd75c — a resumed CLI does not keep
// the agents it was first started with, so the bridge asks again). Sibling of session/key/route.ts: the bridge calls
// this directly (never through the relay or the length-capped launch link)
// with the bridge token it already holds, and passes the result to
// `claude --agents` or writes it out as temporary Codex agent-role files, so
// each workflow step's persona runs as a real subagent's instructions at its
// tier's model and effort. See src/lib/terminal/session-agents.ts.
//
// AUTH: the same bridge-token check as session/key (authorizeAttach, role
// "bridge"), plus the token's owner must own the session row. Service-role
// client for the same reason as session/key — there is no Supabase user here.
//
// The same answer carries `autoCompactWindow` (the owner's memory limit for this
// CLI, task 5e654dd1) only when one resolves; a read error leaves it out.
//
// For a Claude session the answer also carries `stepUsageScript` ({ file, body },
// card 5e654dd1 stage 2b): the token-counting script the helper saves once, so a
// workflow hand-off can send a short line that runs it instead of the whole
// command. The bridge checks the name against the text before saving.
//
// Every "nothing to give" outcome is `{ agents: null }`, never an error the
// bridge has to handle: the session then launches exactly as it did before.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { authorizeAttach } from "../../../../../../terminal/shared/session-token.mjs";
import { isSessionExpired } from "@/lib/terminal/session-registry";
import { loadBoardSessionAgents } from "@/lib/terminal/board-session-agents";
import { loadSessionAutoCompactWindow } from "@/lib/terminal/session-auto-compact";
import { stepUsageScript } from "@/lib/step-cost/usage-command";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sid: z.string().min(1).max(128),
  token: z.string().min(1).max(4096),
  // Which CLI the session runs — picks whose tier models and efforts the
  // definitions carry. Bridges from before Codex support send none.
  agent: z.enum(["claude", "codex"]).default("claude"),
});

export async function POST(req: Request) {
  try {
    const secret = process.env.TERMINAL_SESSION_SECRET;
    if (!secret) {
      logger.error("Terminal session agents fetch failed: TERMINAL_SESSION_SECRET not configured");
      return NextResponse.json({ error: "Terminal sessions are not configured" }, { status: 503 });
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { sid, token, agent } = parsed.data;

    const auth = await authorizeAttach({ token, secret, session: sid, role: "bridge" });
    if (!auth.ok) {
      logger.warn("Terminal session agents fetch rejected (auth)", { sid, reason: auth.reason });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: session, error: sessionError } = await supabase
      .from("terminal_sessions")
      .select("user_id, idea_id, status, expires_at")
      .eq("sid", sid)
      .maybeSingle();
    if (sessionError) {
      logger.error("Terminal session agents fetch: registry read failed", { sid, error: sessionError.message });
      return NextResponse.json({ error: "Couldn't read the session registry" }, { status: 500 });
    }
    if (!session || session.status !== "active" || isSessionExpired(session.expires_at)) {
      return NextResponse.json({ agents: null });
    }
    if (auth.sub && auth.sub !== session.user_id) {
      logger.warn("Terminal session agents fetch rejected (owner mismatch)", { sid });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const agents = await loadBoardSessionAgents(supabase, {
      ideaId: session.idea_id,
      userId: session.user_id,
      agent,
      logContext: { sid },
    });
    // The owner's memory limit rides on this answer so the launch link stays
    // the same length (task 5e654dd1). Left out when nothing resolves.
    const autoCompactWindow = await loadSessionAutoCompactWindow(supabase, {
      userId: session.user_id,
      agent,
      logContext: { sid },
    });
    return NextResponse.json({
      agents,
      ...(autoCompactWindow === undefined ? {} : { autoCompactWindow }),
      ...(agent === "claude" ? { stepUsageScript: stepUsageScript() } : {}),
    });
  } catch (err) {
    logger.error("Terminal session agents fetch error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
