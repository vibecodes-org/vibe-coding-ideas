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
import {
  getPlatformTerminalModelDefault,
  isValidPlatformTerminalModelDefault,
  TERMINAL_MODEL_DEFAULT_KEY,
} from "@/lib/terminal/platform-terminal-model";
import { validateTerminalModelValue } from "@/lib/terminal/model-resolution";

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

// ── Admin-configurable terminal starting-model default (task c4ca2d95) ─────
// Same super-admin-only read-for-admin / write posture as the model-tier
// defaults above, but a SEPARATE platform_settings key (own Save/audit/
// error boundary — design decision, docs/terminal-starting-model-design.html
// §0) and, per Nick's binding approval-gate note, NO seed: an admin can
// clear this back to "unset", at which point resolution omits the model
// entirely (see resolveEffectiveTerminalModel in
// src/lib/terminal/model-resolution.ts).

export type PlatformTerminalModelAudit = {
  /** null = no platform default set — resolution omits the model entirely. */
  value: string | null;
  updatedBy: { id: string; full_name: string | null } | null;
  updatedAt: string | null;
};

/** Any authenticated user can call this (mirrors getPlatformModelDefaultsAction —
 *  read is allowed for everyone per RLS; only the write path is super-admin gated).
 *  Used by the session-mint route and the chooser/launch-dialog launch-surface hooks. */
export async function getPlatformTerminalModelDefaultAction(): Promise<string | null> {
  const supabase = await createClient();
  return getPlatformTerminalModelDefault(supabase);
}

/** Admin "Platform" tab read — includes the audit line (who/when). Super-admin-only
 *  surface, but (like the tier-defaults read above) the read itself doesn't need to
 *  be gated — RLS already allows any authenticated read. */
export async function getPlatformTerminalModelDefaultForAdmin(): Promise<PlatformTerminalModelAudit> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value, updated_at, updated_by:users!platform_settings_updated_by_fkey(id, full_name)")
    .eq("key", TERMINAL_MODEL_DEFAULT_KEY)
    .maybeSingle();

  if (!data) {
    return { value: null, updatedBy: null, updatedAt: null };
  }

  const value = isValidPlatformTerminalModelDefault(data.value) ? data.value.model : null;
  const updatedBy = Array.isArray(data.updated_by) ? data.updated_by[0] ?? null : data.updated_by ?? null;

  return { value, updatedBy, updatedAt: data.updated_at };
}

/**
 * Save (or clear) the platform terminal starting-model default. Super-admin-only
 * (checked here AND by the platform_settings RLS write policy — defence in depth).
 * `model: null` clears the platform default back to unset (DELETEs the row) — this
 * is a legitimate, meaningful choice here (unlike the tier defaults, which always
 * have a seed to fall back to), not an error case.
 */
export async function updatePlatformTerminalModelDefault(model: string | null): Promise<string | null> {
  const { supabase, userId } = await requireSuperAdmin();

  if (model === null) {
    const { error } = await supabase.from("platform_settings").delete().eq("key", TERMINAL_MODEL_DEFAULT_KEY);
    if (error) {
      logger.error("Failed to clear platform terminal model default", { error: error.message, userId });
      throw new Error("Failed to clear the terminal starting model — try again");
    }
    return null;
  }

  const trimmed = model.trim();
  const validation = validateTerminalModelValue(trimmed);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const { error } = await supabase.from("platform_settings").upsert({
    key: TERMINAL_MODEL_DEFAULT_KEY,
    value: { model: trimmed },
    updated_by: userId,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    logger.error("Failed to save platform terminal model default", { error: error.message, userId });
    throw new Error("Failed to save the terminal starting model — try again");
  }

  return trimmed;
}
