import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";

/**
 * Admin-configurable platform model-tier defaults (frontier -> Opus now —
 * stop hard-coding tier models). Shared by both the Next.js app (SSR mirror
 * for the profile / step-detail / admin UI) and mcp-server (claim-time
 * resolution in both MCP modes — stdio service-role and remote per-user RLS).
 *
 * This module is imported by mcp-server via a relative path
 * ("../../../src/lib/platform-model-defaults"), same convention as
 * workflow-helpers.ts and ai-helpers.ts — keep it framework-agnostic (no
 * "use server", no Next.js-only imports) so it works in both runtimes.
 */

export type ModelTierKey = "frontier" | "standard" | "cheap";

export interface PlatformModelDefaults {
  /** Platform-wide Task-tool `model` alias for each tier, e.g. { frontier: "opus", standard: "sonnet", cheap: "haiku" }. Free text — a new model family needs no schema change. */
  defaults: Record<ModelTierKey, string>;
  /** Single-hop alias->alias fallback chain used when the resolved model is unavailable on the caller's plan/session. */
  fallback: Record<string, string>;
}

export const PLATFORM_MODEL_DEFAULTS_KEY = "model_tier_defaults";

/**
 * Seed / typed fallback — the safe floor "Reset to seed" restores, and what
 * getPlatformModelDefaults() returns when the platform_settings row is
 * missing or malformed. The LIVE, admin-editable value lives in the
 * platform_settings table; this constant is never mutated at runtime.
 *
 * Immediate required outcome (frontier -> Opus): frontier's default is the
 * "opus" family alias (resolves to Opus 5 today, and to whatever Opus ships
 * next). standard/cheap and the fallback chain are unchanged from the
 * pre-existing hard-coded MODEL_TIER_TO_SUBAGENT_MODEL / MODEL_TIER_FALLBACK
 * constants they replace.
 */
export const SEED_PLATFORM_MODEL_DEFAULTS: PlatformModelDefaults = {
  defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
  fallback: { fable: "opus", opus: "fable", sonnet: "opus", haiku: "sonnet" },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation only — free-text model families are allowed by
 * design (AC: new model families need no schema change), so this checks
 * *shape*, never the model strings' contents. Invalid shape -> caller falls
 * back to the seed constants and logs a warning; it never throws.
 */
export function isValidPlatformModelDefaults(value: unknown): value is PlatformModelDefaults {
  if (!isPlainObject(value)) return false;
  const { defaults, fallback } = value;
  if (!isPlainObject(defaults) || !isPlainObject(fallback)) return false;

  for (const tier of ["frontier", "standard", "cheap"] as const) {
    if (typeof defaults[tier] !== "string" || defaults[tier].trim().length === 0) return false;
  }
  for (const [key, val] of Object.entries(fallback)) {
    if (typeof key !== "string" || typeof val !== "string" || val.trim().length === 0) return false;
  }
  return true;
}

/**
 * Reads the platform-wide model-tier defaults (super-admin configurable via
 * the admin "Platform" tab). Missing row, malformed value, or a query error
 * ALL degrade to the seed constants + a logger.warn — this is read on the
 * claim_next_step/complete_step/fail_step hot path and must never throw or
 * crash a claim. Per-request, no cache (correctness over staleness — a
 * super-admin's edit must apply on the very next claim).
 */
export async function getPlatformModelDefaults(
  supabase: SupabaseClient<Database>
): Promise<PlatformModelDefaults> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", PLATFORM_MODEL_DEFAULTS_KEY)
      .maybeSingle();

    if (error) {
      logger.warn("Failed to read platform_settings.model_tier_defaults — using seed defaults", {
        error: error.message,
      });
      return SEED_PLATFORM_MODEL_DEFAULTS;
    }

    if (!data) {
      // Missing row (first boot / not yet saved) -> seed constants, no warning
      // (this is an expected, documented state, not an error).
      return SEED_PLATFORM_MODEL_DEFAULTS;
    }

    if (!isValidPlatformModelDefaults(data.value)) {
      logger.warn("Invalid platform_settings.model_tier_defaults value — using seed defaults", {
        value: data.value,
      });
      return SEED_PLATFORM_MODEL_DEFAULTS;
    }

    return data.value;
  } catch (err) {
    logger.warn("Unexpected error reading platform_settings.model_tier_defaults — using seed defaults", {
      error: err instanceof Error ? err.message : String(err),
    });
    return SEED_PLATFORM_MODEL_DEFAULTS;
  }
}

// ============================================================
// Agent-aware model tiers (Codex model-tier task, FR-1/FR-2/FR-6)
//
// "Make Codex run each workflow step at its configured model, not just
// Claude." A step's tier now resolves to BOTH a Claude entry (Task-tool
// alias + effort) and a Codex entry (model id + effort) — this section adds
// that agent-aware representation ON TOP of the flat PlatformModelDefaults
// above rather than replacing it, so the existing admin "Platform" tab
// action/UI (src/actions/admin-platform.ts, model-tier-settings.tsx — a
// later FR-7 slice rebuilds those for agent-awareness) keeps compiling and
// keeps writing the flat Claude-only shape unchanged. Since
// platform_settings.value and users.model_tier_map are both JSONB, the same
// column transparently accepts either shape: normalizeToAgentAwarePlatformModelDefaults
// / normalizeUserModelTierMap upgrade an old flat row into the Claude block
// of the agent-aware shape, and pass an already-agent-aware row through
// unchanged. Read here at claim/complete/fail time
// (mcp-server/src/tools/workflows.ts); never throws — malformed input
// degrades to the seed, same posture as getPlatformModelDefaults above.
// ============================================================

export type AgentKind = "claude" | "codex";

/**
 * Shared reasoning-effort ladder for BOTH agents (Nick's approval-gate note
 * 2: effort is a separate stored field for both, not just Codex). Codex's
 * real `-c model_reasoning_effort=` values observed locally (`codex doctor` /
 * `~/.codex/config.toml` on this machine) include at least "high" — OpenAI's
 * documented ladder for the underlying reasoning API is
 * minimal/low/medium/high. This module ships the 3-level low/medium/high
 * subset as a PLACEHOLDER pending Nick's confirmation of the exact ladder
 * (and whether "minimal" should be included) for both agents; widening this
 * array is not a breaking change to any stored value.
 */
export const REASONING_EFFORT_LEVELS = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORT_LEVELS as readonly string[]).includes(value);
}

/** One agent's resolved model + effort for a tier. Both fields are required
 *  once resolved — FR-6: "a tier entry with a model but no effort is invalid." */
export interface AgentTierEntry {
  model: string;
  effort: ReasoningEffort;
}

export interface AgentAwareTierEntry {
  claude: AgentTierEntry;
  codex: AgentTierEntry;
}

export interface AgentAwarePlatformModelDefaults {
  defaults: Record<ModelTierKey, AgentAwareTierEntry>;
  fallback: {
    claude: Record<string, string>;
    codex: Record<string, string>;
  };
}

/**
 * Seed Codex model ids — PLACEHOLDERS PENDING NICK'S CONFIRMATION (FR-1).
 * `codex --help` (installed locally, v0.153.4) documents `-m/--model` and
 * `-c model_reasoning_effort=<level>` but does not enumerate a model catalogue;
 * this repo has no access to OpenAI's live model list. "gpt-5.1-codex" /
 * "gpt-5.1-codex-mini" are realistic-shaped ids (Codex CLI's own model-family
 * naming convention) standing in for a strong/small pair until Nick confirms
 * the actual ids to ship. Free text is always accepted regardless (FR-1) — a
 * wrong seed here never blocks a real model id from being configured.
 */
export const SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS: AgentAwarePlatformModelDefaults = {
  defaults: {
    frontier: {
      claude: { model: SEED_PLATFORM_MODEL_DEFAULTS.defaults.frontier, effort: "high" },
      codex: { model: "gpt-5.1-codex", effort: "high" },
    },
    standard: {
      claude: { model: SEED_PLATFORM_MODEL_DEFAULTS.defaults.standard, effort: "medium" },
      codex: { model: "gpt-5.1-codex-mini", effort: "medium" },
    },
    cheap: {
      claude: { model: SEED_PLATFORM_MODEL_DEFAULTS.defaults.cheap, effort: "low" },
      codex: { model: "gpt-5.1-codex-mini", effort: "low" },
    },
  },
  fallback: {
    claude: SEED_PLATFORM_MODEL_DEFAULTS.fallback,
    codex: { "gpt-5.1-codex": "gpt-5.1-codex-mini", "gpt-5.1-codex-mini": "gpt-5.1-codex" },
  },
};

function isValidAgentTierEntry(value: unknown): value is AgentTierEntry {
  if (!isPlainObject(value)) return false;
  return typeof value.model === "string" && value.model.trim().length > 0 && isReasoningEffort(value.effort);
}

/** Structural validation of the full agent-aware shape (both agents, all 3 tiers, effort required). */
export function isValidAgentAwarePlatformModelDefaults(value: unknown): value is AgentAwarePlatformModelDefaults {
  if (!isPlainObject(value)) return false;
  const { defaults, fallback } = value;
  if (!isPlainObject(defaults) || !isPlainObject(fallback)) return false;

  for (const tier of ["frontier", "standard", "cheap"] as const) {
    const entry = defaults[tier];
    if (!isPlainObject(entry)) return false;
    if (!isValidAgentTierEntry(entry.claude) || !isValidAgentTierEntry(entry.codex)) return false;
  }

  const { claude: claudeFallback, codex: codexFallback } = fallback;
  if (!isPlainObject(claudeFallback) || !isPlainObject(codexFallback)) return false;
  for (const map of [claudeFallback, codexFallback]) {
    for (const [key, val] of Object.entries(map)) {
      if (typeof key !== "string" || typeof val !== "string" || val.trim().length === 0) return false;
    }
  }
  return true;
}

/**
 * Upgrades a stored `model_tier_defaults` row to the agent-aware shape.
 * BACKWARD-COMPATIBLE (FR-2): an already agent-aware row passes through
 * unchanged; an old flat row (isValidPlatformModelDefaults) reads as the
 * Claude block, with the seed effort per tier and the seed Codex block
 * (nothing else is knowable about Codex from a pre-Codex row); anything else
 * malformed degrades to the full seed. Never throws — read on the claim hot
 * path.
 */
export function normalizeToAgentAwarePlatformModelDefaults(value: unknown): AgentAwarePlatformModelDefaults {
  if (isValidAgentAwarePlatformModelDefaults(value)) return value;

  if (isValidPlatformModelDefaults(value)) {
    const upgraded: AgentAwarePlatformModelDefaults = {
      defaults: {
        frontier: {
          claude: { model: value.defaults.frontier, effort: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier.claude.effort },
          codex: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier.codex,
        },
        standard: {
          claude: { model: value.defaults.standard, effort: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.standard.claude.effort },
          codex: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.standard.codex,
        },
        cheap: {
          claude: { model: value.defaults.cheap, effort: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap.claude.effort },
          codex: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap.codex,
        },
      },
      fallback: {
        claude: value.fallback,
        codex: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.fallback.codex,
      },
    };
    return upgraded;
  }

  return SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS;
}

/**
 * Agent-aware counterpart of getPlatformModelDefaults — same read (single
 * `platform_settings` row, key `model_tier_defaults`), normalized to the
 * agent-aware shape. This is what mcp-server/src/tools/workflows.ts reads at
 * claim/complete/fail time going forward; getPlatformModelDefaults above is
 * kept for the existing flat-shape admin action/UI. Never throws.
 */
export async function getAgentAwarePlatformModelDefaults(
  supabase: SupabaseClient<Database>
): Promise<AgentAwarePlatformModelDefaults> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", PLATFORM_MODEL_DEFAULTS_KEY)
      .maybeSingle();

    if (error) {
      logger.warn("Failed to read platform_settings.model_tier_defaults (agent-aware) — using seed defaults", {
        error: error.message,
      });
      return SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS;
    }
    if (!data) return SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS;

    return normalizeToAgentAwarePlatformModelDefaults(data.value);
  } catch (err) {
    logger.warn("Unexpected error reading platform_settings.model_tier_defaults (agent-aware) — using seed defaults", {
      error: err instanceof Error ? err.message : String(err),
    });
    return SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS;
  }
}

/** One tier's per-agent user override — every field optional; a user may
 *  override just the model, just the effort, one agent only, etc. */
export type AgentAwareUserModelTierMap = Partial<
  Record<ModelTierKey, Partial<Record<AgentKind, Partial<AgentTierEntry>>>>
>;

/**
 * Normalizes a raw `users.model_tier_map` value (old flat `{frontier?: string,
 * standard?: string, cheap?: string}` shape, the new agent-aware shape, or
 * anything malformed) into the agent-aware shape. A legacy flat value's
 * string is a Claude-only model override with no stored effort (the
 * platform default's effort for that tier applies — see resolveModelTier).
 * Never throws; unrecognised shapes degrade to "no override" ({}).
 */
export function normalizeUserModelTierMap(raw: unknown): AgentAwareUserModelTierMap {
  if (!isPlainObject(raw)) return {};
  const result: AgentAwareUserModelTierMap = {};

  for (const tier of ["frontier", "standard", "cheap"] as const) {
    const tierValue = raw[tier];
    if (typeof tierValue === "string" && tierValue.trim().length > 0) {
      // Legacy flat shape: a bare model alias string is a Claude-only override.
      result[tier] = { claude: { model: tierValue } };
      continue;
    }
    if (!isPlainObject(tierValue)) continue;

    const entry: Partial<Record<AgentKind, Partial<AgentTierEntry>>> = {};
    for (const agent of ["claude", "codex"] as const) {
      const agentValue = tierValue[agent];
      if (!isPlainObject(agentValue)) continue;
      const model = typeof agentValue.model === "string" && agentValue.model.trim().length > 0 ? agentValue.model : undefined;
      const effort = isReasoningEffort(agentValue.effort) ? agentValue.effort : undefined;
      if (model !== undefined || effort !== undefined) {
        entry[agent] = { ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) };
      }
    }
    if (entry.claude || entry.codex) result[tier] = entry;
  }

  return result;
}
