"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { logger } from "@/lib/logger";
import {
  AI_MODEL,
  logAiUsage,
  getPlatformAiCallsToday,
  PLATFORM_AI_DAILY_LIMIT,
} from "@/lib/ai-helpers";
import {
  validateTitle,
  validateOptionalDescription,
  validateBio,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  ValidationError,
} from "@/lib/validation";

export async function completeOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("users")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createIdeaFromOnboarding(data: {
  title: string;
  description?: string;
  tags: string[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const title = validateTitle(data.title);
  const description = data.description?.trim()
    ? validateOptionalDescription(data.description)
    : null;

  // Validate tags
  if (data.tags.length > MAX_TAGS) {
    throw new ValidationError(`Maximum ${MAX_TAGS} tags allowed`);
  }
  for (const tag of data.tags) {
    if (tag.length > MAX_TAG_LENGTH) {
      throw new ValidationError(
        `Tag "${tag}" exceeds ${MAX_TAG_LENGTH} characters`
      );
    }
  }

  const { data: idea, error } = await supabase
    .from("ideas")
    .insert({
      title,
      description: description || title,
      author_id: user.id,
      tags: data.tags,
      visibility: "public" as const,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return { ideaId: idea.id };
}

export async function updateProfileFromOnboarding(data: {
  full_name?: string;
  bio?: string;
  github_username?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const updates: Record<string, unknown> = {};

  if (data.full_name !== undefined) {
    updates.full_name = data.full_name.trim() || null;
  }

  if (data.bio !== undefined) {
    updates.bio = validateBio(data.bio || null);
  }

  if (data.github_username !== undefined) {
    updates.github_username = data.github_username.trim() || null;
  }

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

const ONBOARDING_ENHANCE_TIMEOUT_MS = 30_000;

export async function enhanceOnboardingDescription(data: {
  title: string;
  description: string;
}): Promise<{ enhanced: string }> {
  const platformKey = process.env.ANTHROPIC_API_KEY;
  if (!platformKey) {
    throw new Error("AI enhancement is not available right now");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Only allow during onboarding — user must not have completed it yet
  const { data: profile } = await supabase
    .from("users")
    .select("onboarding_completed_at")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_completed_at) {
    throw new Error("AI enhancement during onboarding is no longer available");
  }

  // Enforce platform AI daily limit (per user)
  if (PLATFORM_AI_DAILY_LIMIT > 0) {
    const todayCount = await getPlatformAiCallsToday(supabase, user.id);
    if (todayCount >= PLATFORM_AI_DAILY_LIMIT) {
      throw new Error(
        "AI enhancement is temporarily unavailable — daily limit reached. Please try again tomorrow."
      );
    }
  }

  const title = data.title.trim();
  if (!title) throw new Error("Title is required");

  const description = data.description.trim();

  const anthropic = createAnthropic({ apiKey: platformKey });

  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  try {
    const result = await generateText({
      model: anthropic(AI_MODEL),
      system:
        "You are a concise product writer. The user is creating their first idea on a project management platform. Expand their rough description into a clear, compelling 2-3 paragraph summary. Keep the original voice and intent — just make it clearer and more complete. Return ONLY the improved description, no preamble.",
      prompt: `**Title:** ${title}\n\n**Description:**\n${description || title}`,
      maxOutputTokens: 1000,
      abortSignal: AbortSignal.timeout(ONBOARDING_ENHANCE_TIMEOUT_MS),
    });
    text = result.text;
    usage = result.usage ?? {};
  } catch (err) {
    logger.error("Onboarding AI error", { error: err instanceof Error ? err.message : String(err) });
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("AI request timed out — please try again");
    }
    throw new Error("Failed to enhance description");
  }

  // Log platform AI usage for cost monitoring
  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "enhance_description",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId: null,
    keyType: "platform",
  });

  return { enhanced: text };
}
