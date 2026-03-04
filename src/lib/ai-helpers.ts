import { createAnthropic } from "@ai-sdk/anthropic";
import { decrypt } from "@/lib/encryption";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const AI_MODEL = "claude-sonnet-4-6";

export type AiAccess = {
  hasApiKey: boolean;
  starterCredits: number;
  canUseAi: boolean;
};

export type AiActionType =
  | "enhance_description"
  | "generate_questions"
  | "enhance_with_context"
  | "generate_board_tasks"
  | "enhance_task_description"
  | "enhance_discussion_body";

/** Create an Anthropic provider using the user's BYOK key. */
export function getAnthropicProvider(encryptedKey: string | null) {
  if (!encryptedKey) {
    throw new Error("No API key configured — add your Anthropic key in your profile settings");
  }
  let apiKey: string;
  try {
    apiKey = decrypt(encryptedKey);
  } catch {
    throw new Error("Failed to decrypt API key — please re-save your key in profile settings");
  }
  return createAnthropic({ apiKey });
}

/** Create an Anthropic provider using the platform API key. */
export function getPlatformAnthropicProvider() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Platform AI is not configured");
  }
  return createAnthropic({ apiKey });
}

/** Shared AI access resolution: BYOK key → platform key with credits → error.
 *  Used by both server actions (requireAiAccess) and streaming API routes. */
export type ResolvedAiAccess =
  | { ok: true; anthropic: ReturnType<typeof createAnthropic>; keyType: "byok" | "platform" }
  | { ok: false; error: string; status: number };

export async function resolveAiProvider(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<ResolvedAiAccess> {
  const { data: profile } = await supabase
    .from("users")
    .select("encrypted_anthropic_key, ai_starter_credits")
    .eq("id", userId)
    .single();

  if (!profile) return { ok: false, error: "User profile not found", status: 404 };

  // Path 1: User has their own API key (BYOK)
  if (profile.encrypted_anthropic_key) {
    return { ok: true, anthropic: getAnthropicProvider(profile.encrypted_anthropic_key), keyType: "byok" };
  }

  // Path 2: User has starter credits — use platform key
  if (profile.ai_starter_credits > 0) {
    if (PLATFORM_AI_DAILY_LIMIT > 0) {
      const todayCount = await getPlatformAiCallsToday(supabase, userId);
      if (todayCount >= PLATFORM_AI_DAILY_LIMIT) {
        return { ok: false, error: "Daily AI safety limit reached. Please try again tomorrow.", status: 429 };
      }
    }
    return { ok: true, anthropic: getPlatformAnthropicProvider(), keyType: "platform" };
  }

  // Path 3: No key and no credits
  return {
    ok: false,
    error: "You've used all your free AI credits. Add your API key in profile settings for unlimited use.",
    status: 403,
  };
}

/** Read remaining starter credits for a user. */
export async function getStarterCreditsRemaining(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { data } = await supabase
    .from("users")
    .select("ai_starter_credits")
    .eq("id", userId)
    .single();
  return data?.ai_starter_credits ?? 0;
}

/** Atomically decrement a starter credit. Returns remaining count. */
export async function decrementStarterCredit(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const { data, error } = await supabase.rpc("decrement_starter_credit", {
    p_user_id: userId,
  });
  if (error) {
    console.error("[AI Starter Credits] Failed to decrement:", error.message);
    return 0;
  }
  return data ?? 0;
}

export async function logAiUsage(
  supabase: SupabaseClient<Database>,
  params: {
    userId: string;
    actionType: AiActionType;
    inputTokens: number;
    outputTokens: number;
    model: string;
    ideaId: string | null;
    keyType?: "platform" | "byok";
  }
) {
  const { error } = await supabase.from("ai_usage_log").insert({
    user_id: params.userId,
    action_type: params.actionType,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    model: params.model,
    key_type: params.keyType ?? "byok",
    idea_id: params.ideaId,
  });
  if (error) {
    console.error("[AI Usage Log] Failed to log usage:", error.message, {
      actionType: params.actionType,
      keyType: params.keyType ?? "byok",
      userId: params.userId,
    });
  }
}

/** Daily platform AI usage limit (0 = unlimited) */
export const PLATFORM_AI_DAILY_LIMIT = parseInt(
  process.env.PLATFORM_AI_DAILY_LIMIT ?? "50",
  10
);

/** Check how many platform AI calls a specific user has made today. */
export async function getPlatformAiCallsToday(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("key_type", "platform")
    .eq("user_id", userId)
    .gte("created_at", todayStart.toISOString());

  return count ?? 0;
}
