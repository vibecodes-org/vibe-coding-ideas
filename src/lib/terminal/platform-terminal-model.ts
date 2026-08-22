import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";

/**
 * Admin-configurable platform default for the in-app terminal's starting
 * model (task c4ca2d95). Mirrors platform-model-defaults.ts's STORAGE
 * pattern (one platform_settings row) but NOT its seed posture — see the
 * BINDING note on getPlatformTerminalModelDefault below.
 */

export const TERMINAL_MODEL_DEFAULT_KEY = "terminal_model_default";

export interface PlatformTerminalModelDefault {
  /** Free-text family alias or model id, passed verbatim as `claude --model <value>`. */
  model: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural validation only — free-text models are allowed by design, so
 *  this checks shape, never the model string's contents (that's
 *  validateTerminalModelValue's job, applied at save time). */
export function isValidPlatformTerminalModelDefault(value: unknown): value is PlatformTerminalModelDefault {
  return isPlainObject(value) && typeof value.model === "string" && value.model.trim().length > 0;
}

/**
 * Reads the platform-wide terminal starting-model default.
 *
 * BINDING (Nick, design-review approval gate): UNLIKE getPlatformModelDefaults(),
 * there is deliberately NO seed fallback here. Missing row, malformed value,
 * and a query error all degrade to `null` — omit the model, exactly today's
 * behaviour — never a hardcoded value. `logger.warn` fires only for the
 * genuinely abnormal cases (malformed value / query error); a missing row
 * ("nothing saved yet", the expected state until an admin opts in) is silent.
 *
 * Read at session-mint time — per-request, no cache, so an admin's edit
 * applies to the very next launch. Never throws (AC-2: a resolution failure
 * must degrade gracefully, never block a launch).
 */
export async function getPlatformTerminalModelDefault(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", TERMINAL_MODEL_DEFAULT_KEY)
      .maybeSingle();

    if (error) {
      logger.warn("Failed to read platform_settings.terminal_model_default — omitting model", {
        error: error.message,
      });
      return null;
    }

    if (!data) {
      // Missing row (nothing saved yet, or an admin cleared it back to unset)
      // -> omit, no warning (this is the expected default state, not an error).
      return null;
    }

    if (!isValidPlatformTerminalModelDefault(data.value)) {
      logger.warn("Invalid platform_settings.terminal_model_default value — omitting model", {
        value: data.value,
      });
      return null;
    }

    return data.value.model;
  } catch (err) {
    logger.warn("Unexpected error reading platform_settings.terminal_model_default — omitting model", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
