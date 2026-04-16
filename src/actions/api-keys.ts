"use server";

import { createHash, randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ApiKeyRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/**
 * Generate a new API key for the current user.
 * Returns the plaintext key — this is the ONLY time it is available.
 * Only the SHA-256 hash is stored in the database.
 */
export async function generateApiKey(name: string): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  if (trimmed.length > 100) throw new Error("Name must be 100 characters or fewer");

  // Generate key: prefix + 32 random bytes as hex = "vbc_" + 64 chars
  const rawBytes = randomBytes(32).toString("hex");
  const plaintextKey = `vbc_${rawBytes}`;
  const keyHash = createHash("sha256").update(plaintextKey).digest("hex");

  const { error } = await supabase.from("user_api_keys").insert({
    user_id: user.id,
    name: trimmed,
    key_hash: keyHash,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
  return plaintextKey;
}

/**
 * List all API keys for the current user (no hashes returned).
 */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_api_keys")
    .select("id, name, created_at, last_used_at, expires_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Revoke (delete) an API key by ID.
 * Only the key owner can revoke it (enforced by RLS).
 */
export async function revokeApiKey(id: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_api_keys")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
}
