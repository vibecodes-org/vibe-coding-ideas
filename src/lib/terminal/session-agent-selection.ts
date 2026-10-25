// In-app terminal — which (agent, tier) pairs a session defines (task 3a579815).
//
// A session used to get only the agents with a claimable step on the board at
// that moment, so an agent whose steps were all finished (the Planner, say)
// dropped out and its next step needed a resume. Now it also gets every agent
// the board's workflow templates would hand a step to. Pure; the route does
// the reads. No AI call here on purpose: the bridge waits 5 s for this answer,
// and a missed or extra optional agent is harmless (tags are exact per bot and
// tier) while a timed-out fetch loses every agent.

import { buildRoleMatcher } from "../role-matching";
import { isStepEffort } from "../platform-model-defaults";
import type { SessionAgentTier } from "./session-agents";

export type SessionAgentPair = {
  botId: string;
  tier: SessionAgentTier | null;
  /** The step's own effort level (a tiered step only), else null: the tier's setting applies. */
  effort: string | null;
  /** How many steps (waiting, or in templates) want this pair — packing order. */
  uses: number;
};

export type AllocatedAgent = { botId: string; role: string };
/** `idea_role_match_cache.matches`: role -> the bot it resolved to. */
export type CachedRoleMatches = Record<string, { botId: string | null } | undefined>;

const TIERS = new Set<string>(["frontier", "standard", "cheap"]);

/** Anything but frontier/standard/cheap is an untiered ("Auto") step, as on the claim side. */
export function normalizeStepTier(tier: unknown): SessionAgentTier | null {
  return typeof tier === "string" && TIERS.has(tier) ? (tier as SessionAgentTier) : null;
}

/** A step's own effort level; only a tiered step can carry one (Auto promises no model). */
export function normalizeStepEffort(tier: SessionAgentTier | null, effort: unknown): string | null {
  return tier && isStepEffort(effort) ? effort : null;
}

function pairKey(botId: string, tier: SessionAgentTier | null, effort: string | null): string {
  return `${botId}:${tier ?? "auto"}${effort ? `:${effort}` : ""}`;
}

function tally(entries: { botId: string; tier: SessionAgentTier | null; effort: string | null }[]): Map<string, SessionAgentPair> {
  const pairs = new Map<string, SessionAgentPair>();
  for (const { botId, tier, effort } of entries) {
    const key = pairKey(botId, tier, effort);
    const existing = pairs.get(key);
    if (existing) existing.uses += 1;
    else pairs.set(key, { botId, tier, effort, uses: 1 });
  }
  return pairs;
}

/** Most-used first; ties broken by bot id then tier so the order is stable. */
function sortPairs(pairs: Iterable<SessionAgentPair>): SessionAgentPair[] {
  return [...pairs].sort(
    (a, b) =>
      b.uses - a.uses ||
      a.botId.localeCompare(b.botId) ||
      (a.tier ?? "").localeCompare(b.tier ?? "") ||
      (a.effort ?? "").localeCompare(b.effort ?? ""),
  );
}

/**
 * Role -> allocated bots without any AI call: every agent with exactly that
 * role, else the board's cached match if that bot is still allocated, else the
 * fuzzy matcher. A role nothing resolves is absent from the result.
 */
export function resolveRolesWithoutAi(
  roles: string[],
  pool: AllocatedAgent[],
  cachedMatches: CachedRoleMatches | null,
): Map<string, string[]> {
  const poolIds = new Set(pool.map((a) => a.botId));
  const fuzzy = buildRoleMatcher(pool.filter((a) => a.role.trim()));
  const resolved = new Map<string, string[]>();
  for (const role of roles) {
    const wanted = role.trim().toLowerCase();
    if (!wanted) continue;
    const exact = pool.filter((a) => a.role.trim().toLowerCase() === wanted).map((a) => a.botId);
    if (exact.length > 0) {
      resolved.set(role, exact);
      continue;
    }
    const cachedBot = cachedMatches?.[role]?.botId;
    if (cachedBot && poolIds.has(cachedBot)) {
      resolved.set(role, [cachedBot]);
      continue;
    }
    const match = fuzzy(role);
    if (match.botId) resolved.set(role, [match.botId]);
  }
  return resolved;
}

export function selectSessionAgentPairs(input: {
  /** Claimable (pending / in_progress / failed) steps that have a bot. */
  claimableSteps: { bot_id: string | null; model_tier: string | null; effort_override?: string | null }[];
  /** `workflow_templates.steps` of every template on the board. */
  templates: { steps: unknown }[];
  pool: AllocatedAgent[];
  cachedMatches: CachedRoleMatches | null;
}): { waiting: SessionAgentPair[]; optional: SessionAgentPair[] } {
  const waitingMap = tally(
    input.claimableSteps
      .filter((s): s is { bot_id: string; model_tier: string | null; effort_override?: string | null } => !!s.bot_id)
      .map((s) => {
        const tier = normalizeStepTier(s.model_tier);
        return { botId: s.bot_id, tier, effort: normalizeStepEffort(tier, s.effort_override) };
      }),
  );

  const templateSteps: { role: string; tier: SessionAgentTier | null; effort: string | null }[] = [];
  for (const template of input.templates) {
    if (!Array.isArray(template.steps)) continue;
    for (const step of template.steps as Record<string, unknown>[]) {
      const role = step && typeof step.role === "string" ? step.role.trim() : "";
      if (role) {
        const tier = normalizeStepTier(step.model_tier);
        templateSteps.push({ role, tier, effort: normalizeStepEffort(tier, step.effort) });
      }
    }
  }
  const resolved = resolveRolesWithoutAi([...new Set(templateSteps.map((s) => s.role))], input.pool, input.cachedMatches);
  const optionalEntries: { botId: string; tier: SessionAgentTier | null; effort: string | null }[] = [];
  for (const { role, tier, effort } of templateSteps) {
    for (const botId of resolved.get(role) ?? []) optionalEntries.push({ botId, tier, effort });
  }
  const optionalMap = tally(optionalEntries);
  for (const key of waitingMap.keys()) optionalMap.delete(key);

  return { waiting: sortPairs(waitingMap.values()), optional: sortPairs(optionalMap.values()) };
}
