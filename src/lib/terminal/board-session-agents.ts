// The board → Claude Code/Codex subagent definitions, lifted out of the
// bridge's session/agents route so the sync (cards 7939ee17, b9205d04) builds
// the exact same definitions from the exact same reads. The caller passes the
// client and has already authorised the user for this idea.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { BOARD_AGENT_AUTO_COMPACT_WINDOW } from "@/lib/terminal/auto-compact";
import {
  buildSessionAgents,
  sessionAgentName,
  type ClaudeCodeAgentDefinition,
  type SessionAgentInput,
  type SessionAgentTier,
} from "@/lib/terminal/session-agents";
import {
  normalizeStepEffort,
  selectSessionAgentPairs,
  type AllocatedAgent,
  type CachedRoleMatches,
  type SessionAgentPair,
} from "@/lib/terminal/session-agent-selection";
import { renderAgentFile } from "@/lib/terminal/session-agent-files";
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
  const steps: { bot_id: string | null; model_tier: string | null; effort_override: string | null }[] = [];
  for (let page = 0; page < STEP_MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("task_workflow_steps")
      .select("bot_id, model_tier, effort_override")
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
    for (const { botId, tier, effort: stepEffort } of pairs) {
      const bot = botsById.get(botId);
      if (!bot?.system_prompt) continue;
      // Resolved exactly as claim_next_step resolves it, so the definition's
      // model/effort match the step's MANDATORY MODEL directive.
      const resolution = tier ? resolveModelTier(tier, agent, owner?.model_tier_map ?? null, platformDefaults, stepEffort) : null;
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
        stepEffort,
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

  // Claude board agents get their own memory limit whatever the session's own
  // limit is (task 5e654dd1). Codex role files never carry it.
  const agents = buildSessionAgents(waitingInputs, undefined, {
    optional: optionalInputs,
    ...(agent === "claude" ? { autoCompactWindow: BOARD_AGENT_AUTO_COMPACT_WINDOW } : {}),
  });
  const delivered = agents ? Object.keys(agents) : [];
  const waitingDelivered = waitingInputs.filter((i) => delivered.includes(sessionAgentName(i.bot, i.tier, i.stepEffort))).length;
  const optionalDelivered = optionalInputs.filter((i) => delivered.includes(sessionAgentName(i.bot, i.tier, i.stepEffort))).length;
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
    .select("bot_id, model_tier, effort_override")
    .eq("id", stepId)
    .eq("idea_id", ideaId)
    .maybeSingle();
  if (!step?.bot_id) return null;
  const tier = (step.model_tier ?? null) as SessionAgentTier | null;
  const toInputs = await loadInputBuilder(supabase, { botIds: [step.bot_id], userId, agent: "claude", logContext });
  if (!toInputs) return null;
  const effort = normalizeStepEffort(tier, step.effort_override);
  const inputs = toInputs([{ botId: step.bot_id, tier, effort, uses: 1 }]);
  if (inputs.length === 0) return null;
  const agents = buildSessionAgents(inputs, undefined, { autoCompactWindow: BOARD_AGENT_AUTO_COMPACT_WINDOW });
  const name = sessionAgentName(inputs[0].bot, tier, effort);
  const def = agents?.[name];
  return def ? { name, def } : null;
}

/**
 * Total size a run-wide sync may put in one command (card 0b5656a5). It keeps
 * the tool result under the 25k-token MCP limit and the copy cost bounded; an
 * agent that doesn't fit is synced at its own claim.
 */
export const RUN_AGENTS_MAX_TOTAL_BYTES = 60_000;

/** Steps of a run that a session may still claim (never completed, skipped or awaiting approval). */
const RUN_SYNC_STATUSES = ["pending", "in_progress", "failed"] as const;
/** A run with more steps than this has bigger problems; the rest sync at their own claim. */
const RUN_STEP_LIMIT = 200;

/**
 * The agents of the claimed step's whole run, so one sync makes every step's
 * native subagent available (card 0b5656a5). The claimed step's agent comes
 * first, then the run's other claimable steps in step order, deduped by name,
 * persona text only. Each is built exactly as loadStepSessionAgent builds it,
 * so names and tags match what each step's claim names. Others are added while
 * the rendered files stay within `maxTotalBytes`; one that doesn't fit is
 * counted in `omitted` and synced at its own claim. Null when the claimed step
 * itself has no agent (not on this idea, no bot, no persona text).
 */
export async function loadRunSessionAgents(
  supabase: SupabaseClient<Database>,
  opts: { stepId: string; ideaId: string; userId: string; maxTotalBytes?: number },
): Promise<{ agents: { name: string; def: ClaudeCodeAgentDefinition }[]; omitted: number } | null> {
  const { stepId, ideaId, userId } = opts;
  const maxTotalBytes = opts.maxTotalBytes ?? RUN_AGENTS_MAX_TOTAL_BYTES;
  const logContext = { idea: ideaId };
  const { data: claimed } = await supabase
    .from("task_workflow_steps")
    .select("bot_id, model_tier, effort_override, run_id")
    .eq("id", stepId)
    .eq("idea_id", ideaId)
    .maybeSingle();
  if (!claimed?.bot_id) return null;

  let others: { bot_id: string | null; model_tier: string | null; effort_override: string | null }[] = [];
  if (claimed.run_id) {
    const { data, error } = await supabase
      .from("task_workflow_steps")
      .select("id, bot_id, model_tier, effort_override, step_order")
      .eq("idea_id", ideaId)
      .eq("run_id", claimed.run_id)
      .in("status", [...RUN_SYNC_STATUSES])
      .not("bot_id", "is", null)
      .neq("id", stepId)
      .order("step_order")
      .limit(RUN_STEP_LIMIT);
    if (error) {
      // The claimed step's own agent still syncs; the others sync at their claims.
      logger.warn("Run session agents: run steps read failed", { ...logContext, error: error.message });
    } else {
      others = data ?? [];
    }
  }

  const pairs: SessionAgentPair[] = [claimed, ...others].flatMap((s) => {
    if (!s.bot_id) return [];
    const tier = (s.model_tier ?? null) as SessionAgentTier | null;
    return [{ botId: s.bot_id, tier, effort: normalizeStepEffort(tier, s.effort_override), uses: 1 }];
  });
  const toInputs = await loadInputBuilder(supabase, {
    botIds: [...new Set(pairs.map((p) => p.botId))],
    userId,
    agent: "claude",
    logContext,
  });
  if (!toInputs) return null;

  const agents: { name: string; def: ClaudeCodeAgentDefinition }[] = [];
  const seen = new Set<string>();
  let total = 0;
  let omitted = 0;
  for (const [index, pair] of pairs.entries()) {
    const [input] = toInputs([pair]);
    if (!input) {
      if (index === 0) return null;
      continue;
    }
    const name = sessionAgentName(input.bot, pair.tier, pair.effort);
    if (seen.has(name)) continue;
    seen.add(name);
    // One agent per build, like a single claim, so the size packing of a
    // many-agent payload can never change a tag.
    const def = buildSessionAgents([input], undefined, { autoCompactWindow: BOARD_AGENT_AUTO_COMPACT_WINDOW })?.[name];
    if (!def) {
      if (index === 0) return null;
      continue;
    }
    const bytes = Buffer.byteLength(renderAgentFile(name, def, { synced: true }), "utf8");
    if (index > 0 && total + bytes > maxTotalBytes) {
      omitted++;
      continue;
    }
    total += bytes;
    agents.push({ name, def });
  }
  return { agents, omitted };
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
