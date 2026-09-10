import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logger } from "@/lib/logger";
import { isReasoningEffort, type ReasoningEffort } from "@/lib/platform-model-defaults";
import type { TerminalCodexModelPair } from "@/lib/terminal/model-resolution";

export const TERMINAL_CODEX_MODEL_DEFAULT_KEY = "terminal_codex_model_default";

export interface PlatformTerminalCodexModelDefault {
  model: string;
  effort: ReasoningEffort;
}

export function isValidPlatformTerminalCodexModelDefault(
  value: unknown
): value is PlatformTerminalCodexModelDefault {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).model === "string" &&
    ((value as Record<string, unknown>).model as string).trim().length > 0 &&
    isReasoningEffort((value as Record<string, unknown>).effort)
  );
}

/** Reads the independent, atomic platform default used only for fresh Codex terminals. */
export async function getPlatformTerminalCodexModelDefault(
  supabase: SupabaseClient<Database>
): Promise<TerminalCodexModelPair | null> {
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", TERMINAL_CODEX_MODEL_DEFAULT_KEY)
      .maybeSingle();

    if (error) {
      logger.warn("Failed to read platform Codex terminal default — using Standard fallback", {
        error: error.message,
      });
      return null;
    }
    if (!data) return null;
    if (!isValidPlatformTerminalCodexModelDefault(data.value)) {
      logger.warn("Invalid platform Codex terminal default — using Standard fallback", { value: data.value });
      return null;
    }
    return { model: data.value.model, effort: data.value.effort };
  } catch (err) {
    logger.warn("Unexpected error reading platform Codex terminal default — using Standard fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
