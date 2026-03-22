/**
 * AI-powered workflow role matching with fuzzy matching fallback.
 *
 * Uses Claude to semantically match workflow step roles to available agents,
 * falling back to the existing `buildRoleMatcher()` when AI is unavailable.
 */

import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { AI_MODEL, resolveAiProvider, logAiUsage, decrementStarterCredit } from "@/lib/ai-helpers";
import { buildRoleMatcher } from "@/lib/role-matching";
import { logger } from "@/lib/logger";

const AI_TIMEOUT_MS = 90_000;

const roleMatchSchema = z.object({
  matches: z.array(
    z.object({
      stepRole: z.string(),
      botId: z.string().nullable(),
    })
  ),
});

export interface AiRoleMatchAgent {
  botId: string;
  name: string;
  role: string;
}

/**
 * Match workflow step roles to agents using Claude AI for semantic understanding.
 *
 * Returns a mapping of step role → botId, or `null` if AI is unavailable or errors.
 * The caller should fall back to fuzzy matching when this returns `null`.
 */
export async function matchRolesWithAi(
  supabase: SupabaseClient<Database>,
  userId: string,
  stepRoles: string[],
  agents: AiRoleMatchAgent[]
): Promise<Record<string, string | null> | null> {
  if (stepRoles.length === 0 || agents.length === 0) {
    return null;
  }

  try {
    const resolved = await resolveAiProvider(supabase, userId);
    if (!resolved.ok) {
      return null;
    }

    const agentList = agents
      .map((a) => `- ID: ${a.botId}, Name: "${a.name}", Role: "${a.role}"`)
      .join("\n");

    const roleList = stepRoles.map((r) => `- "${r}"`).join("\n");

    const { object, usage } = await generateObject({
      model: resolved.anthropic(AI_MODEL),
      system:
        "You are matching workflow step roles to the most appropriate agent based on semantic similarity. " +
        "Consider synonyms, related concepts, and role hierarchies. " +
        "For example, 'Frontend Developer' should match an agent with role 'UI Engineer'. " +
        "If no agent is a good semantic match for a role, set botId to null for that role. " +
        "Only use bot IDs from the provided agent list.",
      prompt: `Match each workflow step role to the most appropriate agent.\n\nAvailable agents:\n${agentList}\n\nStep roles to match:\n${roleList}`,
      schema: roleMatchSchema,
      maxOutputTokens: 1000,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    await logAiUsage(supabase, {
      userId,
      actionType: "role_matching",
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      model: AI_MODEL,
      ideaId: null,
      keyType: resolved.keyType,
    });

    if (resolved.keyType === "platform") {
      await decrementStarterCredit(supabase, userId);
    }

    // Convert array of matches to Record<stepRole, botId>
    const result: Record<string, string | null> = {};

    // Validate that returned botIds actually exist in our agent list
    const validBotIds = new Set(agents.map((a) => a.botId));

    for (const match of object.matches) {
      const botId = match.botId && validBotIds.has(match.botId) ? match.botId : null;
      result[match.stepRole] = botId;
    }

    // Ensure all requested roles have an entry
    for (const role of stepRoles) {
      if (!(role in result)) {
        result[role] = null;
      }
    }

    return result;
  } catch (err) {
    logger.error("AI role matching failed, will fall back to fuzzy matching", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Match roles using exact match first, then AI for remaining, then fuzzy fallback.
 *
 * 1. Exact match (case-insensitive) — free, no AI needed
 * 2. AI semantic matching for unmatched roles — only if user has API key/credits
 * 3. Fuzzy matching for any still unmatched — if AI unavailable or errors
 */
export async function matchRolesWithAiOrFuzzy(
  supabase: SupabaseClient<Database>,
  userId: string,
  stepRoles: string[],
  agents: AiRoleMatchAgent[]
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};

  // Tier 1: Exact match (case-insensitive) — no AI cost
  const agentsByRole = new Map(
    agents.map((a) => [a.role.trim().toLowerCase(), a.botId])
  );
  const unmatchedRoles: string[] = [];

  for (const role of stepRoles) {
    const exactMatch = agentsByRole.get(role.trim().toLowerCase());
    if (exactMatch) {
      result[role] = exactMatch;
    } else {
      unmatchedRoles.push(role);
    }
  }

  // All matched exactly — no need for AI or fuzzy
  if (unmatchedRoles.length === 0) {
    return result;
  }

  // Tier 2: AI matching for unmatched roles only
  const aiResult = await matchRolesWithAi(supabase, userId, unmatchedRoles, agents);
  if (aiResult) {
    for (const role of unmatchedRoles) {
      result[role] = aiResult[role] ?? null;
    }
    return result;
  }

  // Tier 3: Fuzzy matching fallback for unmatched roles
  const fuzzyMatcher = buildRoleMatcher(
    agents.map((a) => ({ botId: a.botId, role: a.role }))
  );
  for (const role of unmatchedRoles) {
    result[role] = fuzzyMatcher(role).botId;
  }
  return result;
}
