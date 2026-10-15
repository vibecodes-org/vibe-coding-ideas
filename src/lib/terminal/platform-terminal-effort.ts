import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import { isClaudeEffort, type ClaudeEffort } from "./claude-effort";

/**
 * Admin-configurable site-wide default for the in-app terminal's Claude
 * starting effort (task 18a37612). One platform_settings row, kept SEPARATE
 * from terminal_model_default: the model row's validator needs a non-empty
 * model, and the model card's Clear deletes the whole row.
 */

export const TERMINAL_EFFORT_DEFAULT_KEY = "terminal_effort_default";

export interface PlatformTerminalEffortDefault {
  effort: ClaudeEffort;
}

export function isValidPlatformTerminalEffortDefault(value: unknown): value is PlatformTerminalEffortDefault {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isClaudeEffort((value as Record<string, unknown>).effort);
}

/**
 * Reads the site-wide Claude starting effort. NO seed: a missing row (silent),
 * a malformed value or a query error (both warn) all mean null, so nothing is
 * sent: today's behaviour. Read per request, no cache, never throws.
 */
export async function getPlatformTerminalEffortDefault(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", TERMINAL_EFFORT_DEFAULT_KEY)
      .maybeSingle();

    if (error) {
      logger.warn("Failed to read platform_settings.terminal_effort_default — omitting effort", {
        error: error.message,
      });
      return null;
    }
    if (!data) return null;
    if (!isValidPlatformTerminalEffortDefault(data.value)) {
      logger.warn("Invalid platform_settings.terminal_effort_default value — omitting effort", {
        value: data.value,
      });
      return null;
    }
    return data.value.effort;
  } catch (err) {
    logger.warn("Unexpected error reading platform_settings.terminal_effort_default — omitting effort", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
