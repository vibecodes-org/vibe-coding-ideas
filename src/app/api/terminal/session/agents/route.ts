// In-app terminal — the board's agents for a fresh Claude Code launch (task
// 59889027). Sibling of session/key/route.ts: the bridge calls this directly
// (never through the relay or the length-capped launch link) with the bridge
// token it already holds, and passes the result to `claude --agents`, so each
// workflow step's persona runs as a real subagent system prompt at its tier's
// model and effort. See src/lib/terminal/session-agents.ts.
//
// AUTH: the same bridge-token check as session/key (authorizeAttach, role
// "bridge"), plus the token's owner must own the session row. Service-role
// client for the same reason as session/key — there is no Supabase user here.
//
// Every "nothing to give" outcome is `{ agents: null }`, never an error the
// bridge has to handle: the session then launches exactly as it did before.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { authorizeAttach } from "../../../../../../terminal/shared/session-token.mjs";
import { isSessionExpired } from "@/lib/terminal/session-registry";
import { buildSessionAgents, type SessionAgentInput, type SessionAgentTier } from "@/lib/terminal/session-agents";
import { getAgentAwarePlatformModelDefaults, resolveModelTier } from "@/lib/platform-model-defaults";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sid: z.string().min(1).max(128),
  token: z.string().min(1).max(4096),
});

/** Steps a session might still claim. */
const CLAIMABLE_STATUSES = ["pending", "in_progress", "failed"] as const;
const TIERS = new Set<string>(["frontier", "standard", "cheap"]);

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
    const { sid, token } = parsed.data;

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

    const { data: steps } = await supabase
      .from("task_workflow_steps")
      .select("bot_id, model_tier")
      .eq("idea_id", session.idea_id)
      .in("status", [...CLAIMABLE_STATUSES])
      .not("bot_id", "is", null)
      .limit(1000);

    const pairs = new Map<string, { botId: string; tier: SessionAgentTier | null }>();
    for (const step of steps ?? []) {
      if (!step.bot_id) continue;
      const tier = step.model_tier && TIERS.has(step.model_tier) ? (step.model_tier as SessionAgentTier) : null;
      pairs.set(`${step.bot_id}:${tier ?? "auto"}`, { botId: step.bot_id, tier });
    }
    if (pairs.size === 0) return NextResponse.json({ agents: null });

    const botIds = [...new Set([...pairs.values()].map((p) => p.botId))];
    const [{ data: bots }, { data: skills }, { data: owner }, platformDefaults] = await Promise.all([
      supabase.from("bot_profiles").select("id, name, role, system_prompt").in("id", botIds),
      supabase
        .from("agent_skills")
        .select("bot_id, name, content")
        .in("bot_id", botIds)
        .order("created_at", { ascending: true }),
      supabase.from("users").select("model_tier_map").eq("id", session.user_id).maybeSingle(),
      getAgentAwarePlatformModelDefaults(supabase),
    ]);

    const botsById = new Map((bots ?? []).map((b) => [b.id, b]));
    const inputs: SessionAgentInput[] = [];
    for (const { botId, tier } of pairs.values()) {
      const bot = botsById.get(botId);
      if (!bot?.system_prompt) continue;
      // Resolved exactly as claim_next_step resolves it, so the definition's
      // model/effort match the step's MANDATORY MODEL directive.
      const resolution = tier ? resolveModelTier(tier, "claude", owner?.model_tier_map ?? null, platformDefaults) : null;
      inputs.push({
        bot: { id: bot.id, name: bot.name, role: bot.role, system_prompt: bot.system_prompt },
        tier,
        model: resolution?.resolved ?? null,
        effort: resolution?.effort ?? null,
        skills: (skills ?? []).filter((s) => s.bot_id === botId).map((s) => ({ name: s.name, content: s.content })),
      });
    }

    const agents = buildSessionAgents(inputs);
    logger.info("Terminal session agents delivered to bridge", {
      sid,
      agents: agents ? Object.keys(agents).length : 0,
    });
    return NextResponse.json({ agents });
  } catch (err) {
    logger.error("Terminal session agents fetch error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
