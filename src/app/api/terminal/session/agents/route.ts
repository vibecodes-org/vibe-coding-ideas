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
// Every "nothing to give" outcome is `{ agents: null }`, never an error the
// bridge has to handle: the session then launches exactly as it did before.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { authorizeAttach } from "../../../../../../terminal/shared/session-token.mjs";
import { isSessionExpired } from "@/lib/terminal/session-registry";
import { buildSessionAgents, sessionAgentName, type SessionAgentInput } from "@/lib/terminal/session-agents";
import {
  selectSessionAgentPairs,
  type AllocatedAgent,
  type CachedRoleMatches,
  type SessionAgentPair,
} from "@/lib/terminal/session-agent-selection";
import { fetchAgentSkills } from "@/lib/fetch-agent-skills";
import { getAgentAwarePlatformModelDefaults, resolveModelTier } from "@/lib/platform-model-defaults";
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

/** Steps a session might still claim. */
const CLAIMABLE_STATUSES = ["pending", "in_progress", "failed"] as const;
const STEP_PAGE_SIZE = 1000;
/** A board with 20,000 claimable steps has bigger problems; stop and say so. */
const STEP_MAX_PAGES = 20;

/**
 * Every claimable step that has a bot, paged by id. One unordered
 * `.limit(1000)` used to hand back an arbitrary sample on a board with more
 * (Balla Bot has ~1,900), so a waiting agent could silently drop out.
 */
async function fetchClaimableSteps(supabase: SupabaseClient<Database>, ideaId: string, sid: string) {
  const steps: { bot_id: string | null; model_tier: string | null }[] = [];
  for (let page = 0; page < STEP_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("task_workflow_steps")
      .select("bot_id, model_tier")
      .eq("idea_id", ideaId)
      .in("status", [...CLAIMABLE_STATUSES])
      .not("bot_id", "is", null)
      .order("id")
      .range(page * STEP_PAGE_SIZE, (page + 1) * STEP_PAGE_SIZE - 1);
    if (error) {
      logger.error("Terminal session agents fetch: claimable steps read failed", { sid, page, error: error.message });
      break;
    }
    steps.push(...(data ?? []));
    if ((data ?? []).length < STEP_PAGE_SIZE) return steps;
  }
  logger.warn("Terminal session agents fetch: claimable steps hit the page cap", { sid, rows: steps.length });
  return steps;
}

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

    const steps = await fetchClaimableSteps(supabase, session.idea_id, sid);

    // Agents the board's templates would hand a step to, so adding a card or
    // applying a template mid-session needs no resume. Any failure here just
    // means no optional agents; the waiting ones are unaffected.
    const [templatesRes, poolRes, cacheRes] = await Promise.all([
      supabase.from("workflow_templates").select("steps").eq("idea_id", session.idea_id),
      supabase
        .from("idea_agents")
        .select("bot_id, bot:bot_profiles!idea_agents_bot_id_fkey(id, role)")
        .eq("idea_id", session.idea_id),
      supabase.from("idea_role_match_cache").select("matches").eq("idea_id", session.idea_id).maybeSingle(),
    ]);
    const optionalReadsOk = !templatesRes.error && !poolRes.error;
    if (!optionalReadsOk) {
      logger.warn("Terminal session agents fetch: template reads failed, sending waiting agents only", {
        sid,
        error: templatesRes.error?.message ?? poolRes.error?.message,
      });
    }
    const pool: AllocatedAgent[] = optionalReadsOk
      ? (poolRes.data ?? []).flatMap((entry) =>
          entry.bot?.role && entry.bot_id ? [{ botId: entry.bot_id, role: entry.bot.role }] : [],
        )
      : [];
    const { waiting, optional } = selectSessionAgentPairs({
      claimableSteps: steps,
      templates: optionalReadsOk ? (templatesRes.data ?? []) : [],
      pool,
      cachedMatches: cacheRes.error ? null : ((cacheRes.data?.matches ?? null) as CachedRoleMatches | null),
    });
    if (waiting.length === 0 && optional.length === 0) return NextResponse.json({ agents: null });

    const botIds = [...new Set([...waiting, ...optional].map((p) => p.botId))];
    const [{ data: bots }, skillsByBot, { data: owner }, platformDefaults] = await Promise.all([
      supabase.from("bot_profiles").select("id, name, role, system_prompt, tool_access").in("id", botIds),
      // Same read claim_next_step uses, so both build the same Skills text. A
      // failed read gives nothing rather than agents that would never match.
      fetchAgentSkills(supabase, botIds).catch((err: unknown) => {
        logger.error("Terminal session agents fetch: skills read failed", {
          sid,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }),
      supabase.from("users").select("model_tier_map").eq("id", session.user_id).maybeSingle(),
      getAgentAwarePlatformModelDefaults(supabase),
    ]);

    if (!skillsByBot) return NextResponse.json({ agents: null });

    const botsById = new Map((bots ?? []).map((b) => [b.id, b]));
    const toInputs = (pairs: SessionAgentPair[]): SessionAgentInput[] => {
      const inputs: SessionAgentInput[] = [];
      for (const { botId, tier } of pairs) {
        const bot = botsById.get(botId);
        if (!bot?.system_prompt) continue;
        // Resolved exactly as claim_next_step resolves it, so the definition's
        // model/effort match the step's MANDATORY MODEL directive.
        const resolution = tier ? resolveModelTier(tier, agent, owner?.model_tier_map ?? null, platformDefaults) : null;
        inputs.push({
          bot: {
            id: bot.id,
            name: bot.name,
            role: bot.role,
            system_prompt: bot.system_prompt,
            tool_access: bot.tool_access,
          },
          tier,
          model: resolution?.resolved ?? null,
          effort: resolution?.effort ?? null,
          skills: skillsByBot.get(botId) ?? [],
        });
      }
      return inputs;
    };
    const waitingInputs = toInputs(waiting);
    const optionalInputs = toInputs(optional);

    const agents = buildSessionAgents(waitingInputs, undefined, { optional: optionalInputs });
    const delivered = agents ? Object.keys(agents) : [];
    const waitingDelivered = waitingInputs.filter((i) => delivered.includes(sessionAgentName(i.bot, i.tier))).length;
    const optionalDelivered = optionalInputs.filter((i) => delivered.includes(sessionAgentName(i.bot, i.tier))).length;
    logger.info("Terminal session agents delivered to bridge", {
      sid,
      agent,
      agents: delivered.length,
      waiting: waitingInputs.length,
      optional: optionalDelivered,
      optionalDropped: optionalInputs.length - optionalDelivered,
    });
    if (waitingDelivered < waitingInputs.length) {
      logger.warn("Terminal session agents: waiting agents dropped to fit the size limit", {
        sid,
        dropped: waitingInputs.length - waitingDelivered,
      });
    }
    return NextResponse.json({ agents });
  } catch (err) {
    logger.error("Terminal session agents fetch error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
