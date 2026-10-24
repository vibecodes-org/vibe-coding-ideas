import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import { isValidAutoCompactWindow, type AutoCompactAgent } from "./auto-compact";

/**
 * Admin-configurable site-wide default for the in-app terminal's memory limit
 * (task 5e654dd1). One platform_settings row PER AGENT, so Clear on one can
 * never wipe the other, and kept separate from the model and effort rows.
 */

export const TERMINAL_AUTO_COMPACT_DEFAULT_KEYS: Record<AutoCompactAgent, string> = {
  claude: "terminal_auto_compact_default",
  codex: "terminal_codex_auto_compact_default",
};

export interface PlatformTerminalAutoCompactDefault {
  window: number;
}

export function isValidPlatformAutoCompactDefault(value: unknown): value is PlatformTerminalAutoCompactDefault {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isValidAutoCompactWindow((value as Record<string, unknown>).window)
  );
}

/**
 * Reads the site-wide memory limit for one agent. A missing row (silent), a
 * malformed value or a query error (both warn) all mean null, so nothing is
 * sent: today's behaviour. Read per request, no cache, never throws.
 */
export async function getPlatformTerminalAutoCompactDefault(
  supabase: SupabaseClient<Database>,
  agent: AutoCompactAgent
): Promise<number | null> {
  const key = TERMINAL_AUTO_COMPACT_DEFAULT_KEYS[agent];
  try {
    const { data, error } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
    if (error) {
      logger.warn("Failed to read platform memory limit default — omitting it", { key, error: error.message });
      return null;
    }
    if (!data) return null;
    if (!isValidPlatformAutoCompactDefault(data.value)) {
      logger.warn("Invalid platform memory limit default value — omitting it", { key, value: data.value });
      return null;
    }
    return data.value.window;
  } catch (err) {
    logger.warn("Unexpected error reading platform memory limit default — omitting it", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
