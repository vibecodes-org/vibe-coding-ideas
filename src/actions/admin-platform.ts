"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  getPlatformModelDefaults,
  isValidPlatformModelDefaults,
  SEED_PLATFORM_MODEL_DEFAULTS,
  PLATFORM_MODEL_DEFAULTS_KEY,
  type PlatformModelDefaults,
} from "@/lib/platform-model-defaults";

// ── Admin-configurable platform model-tier defaults ─────────────────────
// Super-admin-only read-for-admin / write. Any authenticated user can read
// platform_settings via RLS (needed at claim time in both MCP modes), but
// only the admin "Platform" tab surfaces it, and only this action's explicit
// is_super_admin check (mirroring src/actions/admin.ts:19-26) — defence in
// depth alongside the RLS write policy — allows a save.

// Free text throughout (AC: a novel model family needs no schema change) —
// bounded only by length, never restricted to a known enum.
const modelAliasSchema = z.string().trim().min(1).max(40);

const platformModelDefaultsInputSchema = z.object({
  defaults: z.object({
    frontier: modelAliasSchema,
    standard: modelAliasSchema,
    cheap: modelAliasSchema,
  }),
  fallback: z.record(modelAliasSchema, modelAliasSchema),
});

export type PlatformModelDefaultsInput = z.infer<typeof platformModelDefaultsInputSchema>;

export type PlatformModelDefaultsAudit = {
  value: PlatformModelDefaults;
  updatedBy: { id: string; full_name: string | null } | null;
  updatedAt: string | null;
  /** True when there is no saved row yet — the UI shows the seed values with a "seed" pill. */
  isSeed: boolean;
};

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: profile } = await supabase
    .from("users")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_super_admin) throw new Error("Super admin access required");

  return { supabase, userId: user.id };
}

/** Any authenticated user can call this (client hook mirror for the profile /
 *  step-detail / model-tier-select UI surfaces) — read is allowed for
 *  everyone per RLS; only the write path is super-admin gated. */
export async function getPlatformModelDefaultsAction(): Promise<PlatformModelDefaults> {
  const supabase = await createClient();
  return getPlatformModelDefaults(supabase);
}

/** Admin "Platform" tab read — includes the audit line (who/when) and whether
 *  the row is unsaved (still on the seed). Super-admin-only surface, but the
 *  read itself doesn't need to be gated (RLS already allows any authenticated
 *  read, and getPlatformModelDefaultsAction() above proves that's intentional). */
export async function getPlatformModelDefaultsForAdmin(): Promise<PlatformModelDefaultsAudit> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value, updated_at, updated_by:users!platform_settings_updated_by_fkey(id, full_name)")
    .eq("key", PLATFORM_MODEL_DEFAULTS_KEY)
    .maybeSingle();

  if (!data) {
    return { value: SEED_PLATFORM_MODEL_DEFAULTS, updatedBy: null, updatedAt: null, isSeed: true };
  }

  const value = isValidPlatformModelDefaults(data.value) ? data.value : SEED_PLATFORM_MODEL_DEFAULTS;
  const updatedBy = Array.isArray(data.updated_by) ? data.updated_by[0] ?? null : data.updated_by ?? null;

  return { value, updatedBy, updatedAt: data.updated_at, isSeed: false };
}

/**
 * Save the platform model-tier defaults. Super-admin-only (checked here
 * AND by the platform_settings RLS write policy — defence in depth). Audit
 * fields (updated_by/updated_at) are always stamped server-side, never
 * trusted from the client.
 */
export async function updatePlatformModelDefaults(
  input: PlatformModelDefaultsInput
): Promise<PlatformModelDefaults> {
  const parsed = platformModelDefaultsInputSchema.parse(input);
  const { supabase, userId } = await requireSuperAdmin();

  const { error } = await supabase.from("platform_settings").upsert({
    key: PLATFORM_MODEL_DEFAULTS_KEY,
    value: parsed,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    logger.error("Failed to save platform model tier defaults", { error: error.message, userId });
    throw new Error("Failed to save platform model defaults — try again");
  }

  return parsed;
}
