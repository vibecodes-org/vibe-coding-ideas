"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateBio, validateAvatarUrl } from "@/lib/validation";
import { encrypt } from "@/lib/encryption";
import { MODEL_ALIASES, type ModelTierMap } from "@/lib/constants";

export async function updateProfile(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const fullName = (formData.get("full_name") as string)?.trim() || null;
  const bio = validateBio((formData.get("bio") as string) || null);
  const githubUsername = (formData.get("github_username") as string)?.trim() || null;
  const contactInfo = (formData.get("contact_info") as string)?.trim() || null;

  const updates: Record<string, unknown> = {
    full_name: fullName,
    bio,
    github_username: githubUsername,
    contact_info: contactInfo,
  };

  if (formData.has("avatar_url")) {
    updates.avatar_url = validateAvatarUrl(
      (formData.get("avatar_url") as string) || null
    );
  }

  const { error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/profile/${user.id}`);
}

export async function updateDefaultBoardColumns(
  columns: { title: string; is_done_column: boolean }[] | null
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  // Validate: at least 1 column, max 10, at least 1 done column if set
  if (columns !== null) {
    if (columns.length === 0) throw new Error("At least one column is required");
    if (columns.length > 10) throw new Error("Maximum 10 columns allowed");
    if (!columns.some((c) => c.is_done_column)) {
      throw new Error("At least one column must be marked as done");
    }
    for (const col of columns) {
      if (!col.title.trim()) throw new Error("Column titles cannot be empty");
      if (col.title.length > 100) throw new Error("Column titles must be under 100 characters");
    }
  }

  const { error } = await supabase
    .from("users")
    .update({ default_board_columns: columns })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
}

// ── API Key Management (BYOK) ──────────────────────────────────────────

export async function saveApiKey(apiKey: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key cannot be empty");
  if (!trimmed.startsWith("sk-ant-")) {
    throw new Error("Invalid Anthropic API key format (should start with sk-ant-)");
  }

  const encrypted = encrypt(trimmed);

  const { error } = await supabase
    .from("users")
    .update({ encrypted_anthropic_key: encrypted })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
}

export async function removeApiKey() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("users")
    .update({ encrypted_anthropic_key: null })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
}

// ── Model Tier Mapping (P2b) ────────────────────────────────────────────
// Per-user override of the platform model-tier defaults (users.model_tier_map).
// Self-only: both actions operate on the authenticated user's own row.

const ModelTierMapSchema = z
  .object({
    frontier: z.enum(MODEL_ALIASES).optional(),
    standard: z.enum(MODEL_ALIASES).optional(),
    cheap: z.enum(MODEL_ALIASES).optional(),
  })
  .strict();

export async function getModelTierMap(): Promise<ModelTierMap | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("users")
    .select("model_tier_map")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data?.model_tier_map ?? null;
}

export async function updateModelTierMap(map: ModelTierMap): Promise<ModelTierMap | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const parsed = ModelTierMapSchema.safeParse(map);
  if (!parsed.success) {
    throw new Error("Invalid model tier map — keys must be frontier/standard/cheap and values fable/opus/sonnet/haiku");
  }

  // Empty map (all tiers reset to platform default) is stored as NULL, not "{}".
  const toStore = Object.keys(parsed.data).length > 0 ? parsed.data : null;

  const { error } = await supabase
    .from("users")
    .update({ model_tier_map: toStore })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
  return toStore;
}
