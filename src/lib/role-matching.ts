/**
 * Hierarchical fuzzy role matching for workflow steps.
 *
 * 3 tiers (stop at first match):
 * 1. Exact (case-insensitive, trimmed)
 * 2. Substring (bidirectional, min 3 chars)
 * 3. Word overlap (prefix match on tokenized words, min 3 chars)
 */

export interface AgentCandidate {
  botId: string;
  role: string;
}

export interface RoleMatchResult {
  botId: string | null;
  tier: "exact" | "substring" | "word-overlap" | "none";
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

    // Tier 2: Substring (bidirectional, min 3 chars)
    if (role.length >= MIN_TOKEN_LENGTH) {
      for (const agent of processed) {
        if (agent.normalized.length >= MIN_TOKEN_LENGTH) {
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
