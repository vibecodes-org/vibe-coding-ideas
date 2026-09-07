"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateBio, validateAvatarUrl } from "@/lib/validation";
import { encrypt } from "@/lib/encryption";
import { MODEL_ALIASES, modelTierLabel, capitalizeModelName, type ModelTierMap, type ModelAlias } from "@/lib/constants";
import { MACHINE_DEFAULT_TERMINAL_MODEL, validateTerminalModelValue } from "@/lib/terminal/model-resolution";
import { normalizeAgent, type LaunchAgent } from "@/lib/terminal/agent-launch";
import {
  normalizeUserModelTierMap,
  isReasoningEffort,
  type AgentAwareUserModelTierMap,
  type AgentKind,
  type AgentTierEntry,
} from "@/lib/platform-model-defaults";
import { validateCodexModelValue } from "@/lib/codex-models";

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

/**
 * Agent-aware read (Codex model-tier task, FR-7 UI slice) — routes the raw
 * `users.model_tier_map` column through normalizeUserModelTierMap so a
 * legacy flat row (a bare model alias string per tier), an already
 * agent-aware row, and a malformed/empty value all resolve consistently: the
 * legacy shape upgrades to a Claude-only override with no stored effort, an
 * agent-aware row passes through, and garbage degrades to "no override" ({}).
 * Never throws on shape — the DB round-trip itself can still throw/propagate.
 */
export async function getAgentAwareModelTierMap(): Promise<AgentAwareUserModelTierMap> {
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

  return normalizeUserModelTierMap(data?.model_tier_map ?? null);
}

/**
 * Legacy flat read (QA Bug 2 fix) — now derived from the agent-aware read
 * above instead of a narrow cast of the raw column, so a genuinely
 * agent-aware row (Codex-only override, or an override missing its effort)
 * degrades correctly to "no Claude override for this tier" instead of
 * surfacing raw agent-aware JSON through the legacy flat type. Kept for
 * existing flat-shape consumers (updateModelTierMap below still writes this
 * shape) — new UI should read getAgentAwareModelTierMap directly.
 */
export async function getModelTierMap(): Promise<ModelTierMap | null> {
  const agentAware = await getAgentAwareModelTierMap();
  const flat: ModelTierMap = {};

  for (const tier of ["frontier", "standard", "cheap"] as const) {
    const claudeModel = agentAware[tier]?.claude?.model;
    if (claudeModel) flat[tier] = claudeModel;
  }

  return Object.keys(flat).length > 0 ? flat : null;
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

/**
 * Agent-aware save (Codex model-tier task, FR-7 UI slice) — the Model Tiers
 * dialog's Save button calls this, not updateModelTierMap above. Validates
 * every model+effort server-side (never trust the client): a Claude model
 * must be one of MODEL_ALIASES, a Codex model must pass validateCodexModelValue
 * (shell-safety — it's later passed to `codex -m`), and an entry with a model
 * but no effort is rejected with a message naming the offending tier + agent
 * (AC-3 — "a tier entry with a model but no effort is invalid"). An
 * agent/tier with neither field set is simply omitted (== "platform
 * default"). Empty result (every tier reset) is stored as NULL, matching
 * updateModelTierMap's convention above.
 */
export async function updateAgentAwareModelTierMap(
  map: AgentAwareUserModelTierMap
): Promise<AgentAwareUserModelTierMap | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    throw new Error("Invalid model tier map");
  }

  const toStore: AgentAwareUserModelTierMap = {};

  for (const tier of ["frontier", "standard", "cheap"] as const) {
    const tierEntry = map[tier];
    if (tierEntry === undefined) continue;
    if (typeof tierEntry !== "object" || tierEntry === null || Array.isArray(tierEntry)) {
      throw new Error(`Invalid model tier map — the ${modelTierLabel(tier)} entry must be an object`);
    }

    const storedTier: Partial<Record<AgentKind, AgentTierEntry>> = {};

    for (const agent of ["claude", "codex"] as const) {
      const agentEntry = tierEntry[agent];
      if (agentEntry === undefined) continue;
      if (typeof agentEntry !== "object" || agentEntry === null || Array.isArray(agentEntry)) {
        throw new Error(`Invalid model tier map — the ${modelTierLabel(tier)} (${agent}) entry must be an object`);
      }

      const model = typeof agentEntry.model === "string" ? agentEntry.model.trim() : "";
      const effort = agentEntry.effort;

      // Neither field set for this agent — nothing to store, equivalent to
      // "platform default". Not an error: this is the staged-but-untouched state.
      if (!model && effort === undefined) continue;

      const agentLabel = agent === "claude" ? "Claude" : "Codex";

      if (!model) {
        throw new Error(
          `Invalid model tier map — ${modelTierLabel(tier)} (${agentLabel}) has a reasoning effort but no model. Choose a model, or clear the effort to use the platform default.`
        );
      }

      if (agent === "claude") {
        if (!(MODEL_ALIASES as readonly string[]).includes(model)) {
          throw new Error(
            `Invalid model tier map — ${modelTierLabel(tier)} (Claude) must be one of: ${MODEL_ALIASES.join(", ")}`
          );
        }
      } else {
        const validation = validateCodexModelValue(model);
        if (!validation.ok) {
          throw new Error(`Invalid model tier map — ${modelTierLabel(tier)} (Codex): ${validation.reason}`);
        }
      }

      if (effort === undefined || !isReasoningEffort(effort)) {
        const modelDisplay = agent === "claude" ? capitalizeModelName(model) : model;
        throw new Error(
          `Choose a reasoning effort for ${modelDisplay} — ${modelTierLabel(tier)} (${agentLabel}).`
        );
      }

      storedTier[agent] = { model: agent === "claude" ? (model as ModelAlias) : model, effort };
    }

    if (storedTier.claude || storedTier.codex) {
      toStore[tier] = storedTier;
    }
  }

  const hasAnyOverride = Object.keys(toStore).length > 0;
  const valueToSave = hasAnyOverride ? toStore : null;

  const { error } = await supabase
    .from("users")
    .update({ model_tier_map: valueToSave })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
  return valueToSave;
}

// ── Terminal starting model (task c4ca2d95) ─────────────────────────────
// Per-user override of the in-app terminal's starting model (users.terminal_model).
// Self-only: both actions operate on the authenticated user's own row. Lives
// alongside the model-tier actions above per Nick's binding approval-gate
// note: the setting stays inside the (unrenamed) Model Tiers dialog as a
// "Terminal sessions" group, not a separate settings surface.

export async function getTerminalModel(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("users")
    .select("terminal_model")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data?.terminal_model ?? null;
}

/**
 * `model: null` clears the override back to "platform default" (AC-6).
 * `model: MACHINE_DEFAULT_TERMINAL_MODEL` is the explicit opt-out sentinel
 * (AC-5) and is stored verbatim — it deliberately bypasses
 * validateTerminalModelValue below since it's a fixed, code-controlled
 * constant, never user-typed text.
 */
export async function updateTerminalModel(model: string | null): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  let toStore: string | null = null;
  if (model !== null) {
    const trimmed = model.trim();
    if (trimmed !== MACHINE_DEFAULT_TERMINAL_MODEL) {
      const validation = validateTerminalModelValue(trimmed);
      if (!validation.ok) throw new Error(validation.reason);
    }
    toStore = trimmed;
  }

  const { error } = await supabase
    .from("users")
    .update({ terminal_model: toStore })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
  return toStore;
}

// ── Terminal auto-accept mode (task d3de150c "Terminal mode") ──────────────
// Per-user opt-in: fresh in-app terminal sessions launch with
// `claude --permission-mode auto` when true. Self-only, same "lives
// inside the Model Tiers dialog's Terminal sessions group" posture as the
// starting-model actions above. Deliberately NO platform-wide default and
// NO admin action mirroring updatePlatformTerminalModelDefault — a safety
// toggle stays per-user only.

export async function getTerminalAutoAccept(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("users")
    .select("terminal_auto_accept")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data?.terminal_auto_accept ?? false;
}

export async function updateTerminalAutoAccept(autoAccept: boolean): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("users")
    .update({ terminal_auto_accept: autoAccept })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
  return autoAccept;
}

// ── Terminal remembered agent (docs/codex-terminal-requirements.md FR-4a,
// implementation slice 2) ───────────────────────────────────────────────────
// Per-account remembered pick for the in-app terminal's agent picker
// (users.terminal_agent, migration 00170) — mirrors terminal_model's exact
// storage mechanism above: self-only, read/write the caller's own row,
// revalidate the same path. `normalizeAgent` (agent-launch.ts) is the single
// whitelist for "codex" vs. everything-else-means-"claude", so a malformed
// value can never even reach the CHECK-constrained column.

export async function getTerminalAgent(): Promise<LaunchAgent> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("users")
    .select("terminal_agent")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return normalizeAgent(data?.terminal_agent);
}

export async function updateTerminalAgent(agent: LaunchAgent): Promise<LaunchAgent> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const toStore = normalizeAgent(agent);

  const { error } = await supabase
    .from("users")
    .update({ terminal_agent: toStore })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath(`/profile/${user.id}`);
  return toStore;
}
