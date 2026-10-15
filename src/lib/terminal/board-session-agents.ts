// The board → Claude Code/Codex subagent definitions, lifted out of the
// bridge's session/agents route so the sync (cards 7939ee17, b9205d04) builds
// the exact same definitions from the exact same reads. The caller passes the
// client and has already authorised the user for this idea.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import {
  buildSessionAgents,
  sessionAgentName,
  type ClaudeCodeAgentDefinition,
  type SessionAgentInput,
  type SessionAgentTier,
} from "@/lib/terminal/session-agents";
import {
  selectSessionAgentPairs,
  type AllocatedAgent,
  type CachedRoleMatches,
  type SessionAgentPair,
} from "@/lib/terminal/session-agent-selection";
import { fetchAgentSkills } from "@/lib/fetch-agent-skills";
import { getAgentAwarePlatformModelDefaults, resolveModelTier } from "@/lib/platform-model-defaults";
import type { Database } from "@/types/database";

/** Steps a session might still claim. */
const CLAIMABLE_STATUSES = ["pending", "in_progress", "failed"] as const;
const STEP_PAGE_SIZE = 1000;
/** A board with 20,000 claimable steps has bigger problems; stop and say so. */
const STEP_MAX_PAGES = 20;

/**
 * Every claimable step that has a bot, paged by id. One unordered
 * `.limit(1000)` used to hand back an arbitrary sample on a board with more
 * (one real board has ~1,900), so a waiting agent could silently drop out.
 */
async function fetchClaimableSteps(supabase: SupabaseClient<Database>, ideaId: string, logContext: Record<string, unknown>) {
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
      logger.error("Terminal session agents fetch: claimable steps read failed", { ...logContext, page, error: error.message });
      break;
    }
    steps.push(...(data ?? []));
    if ((data ?? []).length < STEP_PAGE_SIZE) return steps;
  }
  logger.warn("Terminal session agents fetch: claimable steps hit the page cap", { ...logContext, rows: steps.length });
  return steps;
}


type InputBuilder = (pairs: SessionAgentPair[]) => SessionAgentInput[];

/**
 * Reads what turning (bot, tier) pairs into agent inputs needs: the bots, their
 * skills, the user's tier map and the platform defaults. Null when the skills
 * can't be read (agents built without them would never match a claim).
 */
async function loadInputBuilder(
  supabase: SupabaseClient<Database>,
  opts: { botIds: string[]; userId: string; agent: "claude" | "codex"; logContext: Record<string, unknown> },
): Promise<InputBuilder | null> {
  const { botIds, userId, agent, logContext } = opts;
  const [{ data: bots }, skillsByBot, { data: owner }, platformDefaults] = await Promise.all([
    supabase.from("bot_profiles").select("id, name, role, system_prompt, tool_access").in("id", botIds),
    // Same read claim_next_step uses, so both build the same Skills text. A
    // failed read gives nothing rather than agents that would never match.
    fetchAgentSkills(supabase, botIds).catch((err: unknown) => {
      logger.error("Terminal session agents fetch: skills read failed", {
        ...logContext,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }),
    supabase.from("users").select("model_tier_map").eq("id", userId).maybeSingle(),
    getAgentAwarePlatformModelDefaults(supabase),
  ]);

  if (!skillsByBot) return null;

  const botsById = new Map((bots ?? []).map((b) => [b.id, b]));
  return (pairs) => {
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
}

/**
 * The board's agent definitions for one user and idea, or null when there is
 * nothing to define. `logContext` is spread into every log line (the bridge
 * route passes its sid).
 */
export async function loadBoardSessionAgents(
  supabase: SupabaseClient<Database>,
  opts: { ideaId: string; userId: string; agent: "claude" | "codex"; logContext?: Record<string, unknown> },
): Promise<Record<string, ClaudeCodeAgentDefinition> | null> {
  const { ideaId, userId, agent } = opts;
  const logContext = opts.logContext ?? { ideaId };
  const steps = await fetchClaimableSteps(supabase, ideaId, logContext);

  // Agents the board's templates would hand a step to, so adding a card or
  // applying a template mid-session needs no resume. Any failure here just
  // means no optional agents; the waiting ones are unaffected.
  const [templatesRes, poolRes, cacheRes] = await Promise.all([
    supabase.from("workflow_templates").select("steps").eq("idea_id", ideaId),
    supabase
      .from("idea_agents")
      .select("bot_id, bot:bot_profiles!idea_agents_bot_id_fkey(id, role)")
      .eq("idea_id", ideaId),
    supabase.from("idea_role_match_cache").select("matches").eq("idea_id", ideaId).maybeSingle(),
  ]);
  const optionalReadsOk = !templatesRes.error && !poolRes.error;
  if (!optionalReadsOk) {
    logger.warn("Terminal session agents fetch: template reads failed, sending waiting agents only", {
      ...logContext,
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
  if (waiting.length === 0 && optional.length === 0) return null;

  const toInputs = await loadInputBuilder(supabase, {
    botIds: [...new Set([...waiting, ...optional].map((p) => p.botId))],
    userId,
    agent,
    logContext,
  });
  if (!toInputs) return null;
  const waitingInputs = toInputs(waiting);
  const optionalInputs = toInputs(optional);

  const agents = buildSessionAgents(waitingInputs, undefined, { optional: optionalInputs });
  const delivered = agents ? Object.keys(agents) : [];
  const waitingDelivered = waitingInputs.filter((i) => delivered.includes(sessionAgentName(i.bot, i.tier))).length;
  const optionalDelivered = optionalInputs.filter((i) => delivered.includes(sessionAgentName(i.bot, i.tier))).length;
  logger.info("Terminal session agents built", {
    ...logContext,
    agent,
    agents: delivered.length,
    waiting: waitingInputs.length,
    optional: optionalDelivered,
    optionalDropped: optionalInputs.length - optionalDelivered,
  });
  if (waitingDelivered < waitingInputs.length) {
    logger.warn("Terminal session agents: waiting agents dropped to fit the size limit", {
      ...logContext,
      dropped: waitingInputs.length - waitingDelivered,
    });
  }
  return agents;
}

/**
 * The one agent a claimed step names: its bot at the step's tier, built exactly
 * as the `--agents` payload and the claim hint build it (so the name and tag
 * agree). Null when the step isn't on this idea, has no bot, or the bot has no
 * persona text; throws nothing for those, the caller says so.
 */
export async function loadStepSessionAgent(
  supabase: SupabaseClient<Database>,
  opts: { stepId: string; ideaId: string; userId: string },
): Promise<{ name: string; def: ClaudeCodeAgentDefinition } | null> {
  const { stepId, ideaId, userId } = opts;
  const logContext = { idea: ideaId };
  const { data: step } = await supabase
    .from("task_workflow_steps")
    .select("bot_id, model_tier")
    .eq("id", stepId)
    .eq("idea_id", ideaId)
    .maybeSingle();
  if (!step?.bot_id) return null;
  const tier = (step.model_tier ?? null) as SessionAgentTier | null;
  const toInputs = await loadInputBuilder(supabase, { botIds: [step.bot_id], userId, agent: "claude", logContext });
  if (!toInputs) return null;
  const inputs = toInputs([{ botId: step.bot_id, tier, uses: 1 }]);
  if (inputs.length === 0) return null;
  const agents = buildSessionAgents(inputs);
  const name = sessionAgentName(inputs[0].bot, tier);
  const def = agents?.[name];
  return def ? { name, def } : null;
}

/**
 * Whether `userId` is on the idea's team as its author or a collaborator.
 * (is_idea_team_member() also counts allocated agents, which are bots that
 * never sync agent files.) Two keyed reads, so no large `.in()`.
 */
export async function isBoardMember(
  supabase: SupabaseClient<Database>,
  ideaId: string,
  userId: string,
): Promise<boolean> {
  const [{ data: idea }, { data: collab }] = await Promise.all([
    supabase.from("ideas").select("id").eq("id", ideaId).eq("author_id", userId).maybeSingle(),
    supabase.from("collaborators").select("user_id").eq("idea_id", ideaId).eq("user_id", userId).maybeSingle(),
  ]);
  return Boolean(idea || collab);
}
