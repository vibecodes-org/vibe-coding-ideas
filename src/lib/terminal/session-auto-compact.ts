import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import { resolveTerminalAutoCompact, type AutoCompactAgent } from "./auto-compact";
import { getPlatformTerminalAutoCompactDefault } from "./platform-terminal-auto-compact";

/**
 * The memory limit (auto-compact window) a launch of `agent` should carry for
 * the session owner: their own saved value, else the site default, else
 * undefined (send nothing). Fail-soft: any read error logs a warning and
 * leaves the value out, so it can never fail the agents answer.
 */
export async function loadSessionAutoCompactWindow(
  supabase: SupabaseClient<Database>,
  { userId, agent, logContext }: { userId: string; agent: AutoCompactAgent; logContext?: Record<string, unknown> }
): Promise<number | undefined> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("terminal_auto_compact, terminal_codex_auto_compact")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      logger.warn("Terminal session memory limit: user read failed — omitting it", {
        ...logContext,
        error: error.message,
      });
      return undefined;
    }
    const userValue = agent === "claude" ? data?.terminal_auto_compact : data?.terminal_codex_auto_compact;
    const platformValue = await getPlatformTerminalAutoCompactDefault(supabase, agent);
    return resolveTerminalAutoCompact({ userValue, platformValue }).window;
  } catch (err) {
    logger.warn("Terminal session memory limit: unexpected error — omitting it", {
      ...logContext,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
