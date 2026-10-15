/**
 * Hierarchical fuzzy role matching for workflow steps.
 *
 * 3 tiers (stop at first match):
 * 1. Exact (case-insensitive, trimmed)
 * 2. Substring (bidirectional, min 2 chars)
 * 3. Word overlap (prefix match on tokenized words, min 3 chars)
 */

export interface AgentCandidate {
  botId: string;
  role: string;
}

export type MatchTier = "manual" | "exact" | "ai" | "substring" | "word-overlap" | "none";

export interface RoleMatchResult {
  botId: string | null;
  tier: MatchTier;
}

/** Numeric ranking for tier comparison — higher is better. */
export const MATCH_TIER_RANK: Record<string, number> = {
  manual: 5,
  exact: 4,
  ai: 3,
  substring: 2,
  "word-overlap": 1,
  none: 0,
};

/** Get numeric rank for a tier string (null/unknown = 0). */
export function tierRank(tier: string | null | undefined): number {
  return tier ? (MATCH_TIER_RANK[tier] ?? 0) : 0;
}

const SEPARATOR_RE = /[\s/&]+/;
const MIN_TOKEN_LENGTH = 3;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(SEPARATOR_RE)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

interface ProcessedAgent {
  botId: string;
  normalized: string;
  tokens: string[];
}

export function matchRoleToAgent(
  stepRole: string,
  agents: AgentCandidate[]
): RoleMatchResult {
  return buildRoleMatcher(agents)(stepRole);
}

export function buildRoleMatcher(
  agents: AgentCandidate[]
): (stepRole: string) => RoleMatchResult {
  const processed: ProcessedAgent[] = agents
    .filter((a) => a.role.trim().length > 0)
    .map((a) => ({
      botId: a.botId,
      normalized: normalize(a.role),
      tokens: tokenize(a.role),
    }));

  return (stepRole: string): RoleMatchResult => {
    const role = normalize(stepRole);
    if (role.length === 0) return { botId: null, tier: "none" };

    // Tier 1: Exact match
    for (const agent of processed) {
      if (agent.normalized === role) {
        return { botId: agent.botId, tier: "exact" };
      }
    }

    // Tier 2: Substring (bidirectional, min 2 chars)
    if (role.length >= 2) {
      for (const agent of processed) {
        if (agent.normalized.length >= 2) {
          if (
            agent.normalized.includes(role) ||
            role.includes(agent.normalized)
          ) {
            return { botId: agent.botId, tier: "substring" };
          }
        }
      }
    }

    // Tier 3: Word overlap with prefix matching
    const roleTokens = tokenize(stepRole);
    if (roleTokens.length > 0) {
      for (const agent of processed) {
        if (agent.tokens.length === 0) continue;
        const hasOverlap = roleTokens.some((rt) =>
          agent.tokens.some(
            (at) => at.startsWith(rt) || rt.startsWith(at)
          )
        );
        if (hasOverlap) {
          return { botId: agent.botId, tier: "word-overlap" };
        }
      }
    }

    return { botId: null, tier: "none" };
  };
}

/** True when two roles are equal the way exact matching sees them (trimmed, case-insensitive). */
export function sameRole(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalize(a ?? "") === normalize(b ?? "");
}

export interface StepRematchInput {
  step: { agent_role: string | null; bot_id: string | null; match_tier: string | null };
  /** Best match for the step's role from the current agent pool. */
  newBotId: string | null;
  newTier: string;
  /** Current role of the agent assigned to the step; undefined when unknown (e.g. no longer in the pool). */
  assignedAgentRole: string | undefined;
}

export type StepRematchDecision =
  | { action: "keep" }
  | { action: "assign"; botId: string; tier: string }
  | { action: "clear" };

/**
 * Decide what a rematch does to one pending step.
 * - Hand-picked ("manual") agents are never touched.
 * - A stored "exact" tier only counts while the assigned agent's role still equals
 *   the step's role. Otherwise it is stale: treated as no match (rank 0), replaced
 *   by the new match, or cleared when nothing matches (a wrong agent is worse than none).
 */
export function decideStepRematch(input: StepRematchInput): StepRematchDecision {
  const { step, newBotId, newTier, assignedAgentRole } = input;
  if (step.match_tier === "manual") return { action: "keep" };

  const stale =
    step.match_tier === "exact" &&
    step.bot_id !== null &&
    assignedAgentRole !== undefined &&
    !sameRole(assignedAgentRole, step.agent_role);

  const hasAgent = step.bot_id !== null && !stale;
  const currentRank = hasAgent ? tierRank(step.match_tier) : 0;

  if (newBotId) {
    return !hasAgent || tierRank(newTier) > currentRank
      ? { action: "assign", botId: newBotId, tier: newTier }
      : { action: "keep" };
  }
  return stale ? { action: "clear" } : { action: "keep" };
}
