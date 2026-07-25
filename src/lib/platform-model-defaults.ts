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
