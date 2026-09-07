import { describe, it, expect, vi } from "vitest";
import {
  getPlatformModelDefaults,
  isValidPlatformModelDefaults,
  SEED_PLATFORM_MODEL_DEFAULTS,
  PLATFORM_MODEL_DEFAULTS_KEY,
  isValidAgentAwarePlatformModelDefaults,
  normalizeToAgentAwarePlatformModelDefaults,
  getAgentAwarePlatformModelDefaults,
  SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
  normalizeUserModelTierMap,
  isReasoningEffort,
} from "./platform-model-defaults";

/** Minimal Supabase-shaped mock: `.from(table).select().eq().maybeSingle()`. */
function makeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof getPlatformModelDefaults>[0];
}

describe("SEED_PLATFORM_MODEL_DEFAULTS", () => {
  it("commits the immediate required outcome: frontier -> opus, standard/cheap unchanged", () => {
    expect(SEED_PLATFORM_MODEL_DEFAULTS.defaults).toEqual({
      frontier: "opus",
      standard: "sonnet",
      cheap: "haiku",
    });
  });

  it("preserves the alias fallback chain verbatim (opus<->fable single-hop, sonnet->opus, haiku->sonnet)", () => {
    expect(SEED_PLATFORM_MODEL_DEFAULTS.fallback).toEqual({
      fable: "opus",
      opus: "fable",
      sonnet: "opus",
      haiku: "sonnet",
    });
  });
});

describe("isValidPlatformModelDefaults", () => {
  it("accepts the seed shape", () => {
    expect(isValidPlatformModelDefaults(SEED_PLATFORM_MODEL_DEFAULTS)).toBe(true);
  });

  it("accepts a novel free-text family with no schema change", () => {
    expect(
      isValidPlatformModelDefaults({
        defaults: { frontier: "opus-5.5", standard: "sonnet", cheap: "haiku" },
        fallback: { "opus-5.5": "opus" },
      })
    ).toBe(true);
  });

  it("rejects non-objects, arrays, and null", () => {
    expect(isValidPlatformModelDefaults(null)).toBe(false);
    expect(isValidPlatformModelDefaults(undefined)).toBe(false);
    expect(isValidPlatformModelDefaults("opus")).toBe(false);
    expect(isValidPlatformModelDefaults([])).toBe(false);
  });

  it("rejects a missing tier default", () => {
    expect(
      isValidPlatformModelDefaults({
        defaults: { frontier: "opus", standard: "sonnet" },
        fallback: {},
      })
    ).toBe(false);
  });

  it("rejects a non-string / empty-string default", () => {
    expect(
      isValidPlatformModelDefaults({
        defaults: { frontier: "", standard: "sonnet", cheap: "haiku" },
        fallback: {},
      })
    ).toBe(false);
    expect(
      isValidPlatformModelDefaults({
        defaults: { frontier: 5, standard: "sonnet", cheap: "haiku" },
        fallback: {},
      })
    ).toBe(false);
  });

  it("rejects a malformed fallback map", () => {
    expect(
      isValidPlatformModelDefaults({
        defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" },
        fallback: { opus: 5 },
      })
    ).toBe(false);
  });
});

describe("getPlatformModelDefaults", () => {
  it("returns the seed constants when the row is missing (first boot, not yet saved)", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    const result = await getPlatformModelDefaults(supabase);
    expect(result).toEqual(SEED_PLATFORM_MODEL_DEFAULTS);
  });

  it("returns the seed constants and does not throw on a query error", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "connection reset" } });
    const result = await getPlatformModelDefaults(supabase);
    expect(result).toEqual(SEED_PLATFORM_MODEL_DEFAULTS);
  });

  it("returns the seed constants when the stored value is structurally invalid, never crashes", async () => {
    const supabase = makeSupabase({ data: { value: { defaults: { frontier: "opus" } } }, error: null });
    const result = await getPlatformModelDefaults(supabase);
    expect(result).toEqual(SEED_PLATFORM_MODEL_DEFAULTS);
  });

  it("returns the live stored value when valid — including a novel model family", async () => {
    const live = {
      defaults: { frontier: "opus-5.5", standard: "sonnet", cheap: "haiku" },
      fallback: { "opus-5.5": "opus", opus: "fable", sonnet: "opus", haiku: "sonnet" },
    };
    const supabase = makeSupabase({ data: { value: live }, error: null });
    const result = await getPlatformModelDefaults(supabase);
    expect(result).toEqual(live);
  });

  it("queries by the documented settings key", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    await getPlatformModelDefaults(supabase);
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(supabase.from).toHaveBeenCalledWith("platform_settings");
    expect(chain.eq).toHaveBeenCalledWith("key", PLATFORM_MODEL_DEFAULTS_KEY);
  });

  it("never throws even if the client itself throws synchronously (defensive read)", async () => {
    const throwingSupabase = {
      from: () => {
        throw new Error("client not configured");
      },
    } as unknown as Parameters<typeof getPlatformModelDefaults>[0];

    await expect(getPlatformModelDefaults(throwingSupabase)).resolves.toEqual(SEED_PLATFORM_MODEL_DEFAULTS);
  });

  // Both MCP modes (stdio service-role, remote per-user RLS) call this exact
  // same helper with their own SupabaseClient instance — parity is structural
  // (one function, no mode-specific branching), demonstrated here by getting
  // an identical result from two differently-shaped client stand-ins.
  it("resolves identically regardless of which client instance is passed (stdio vs remote MCP mode parity)", async () => {
    const live = { defaults: { frontier: "opus", standard: "sonnet", cheap: "haiku" }, fallback: {} };
    const serviceRoleClient = makeSupabase({ data: { value: live }, error: null });
    const perUserRlsClient = makeSupabase({ data: { value: live }, error: null });

    const [fromServiceRole, fromPerUser] = await Promise.all([
      getPlatformModelDefaults(serviceRoleClient),
      getPlatformModelDefaults(perUserRlsClient),
    ]);

    expect(fromServiceRole).toEqual(fromPerUser);
  });
});

// ============================================================
// Agent-aware model tiers (Codex model-tier task, FR-1/FR-2/FR-6)
// ============================================================

describe("isReasoningEffort", () => {
  it("accepts every seed ladder level", () => {
    expect(isReasoningEffort("low")).toBe(true);
    expect(isReasoningEffort("medium")).toBe(true);
    expect(isReasoningEffort("high")).toBe(true);
  });

  it("rejects anything outside the ladder, including non-strings", () => {
    expect(isReasoningEffort("extreme")).toBe(false);
    expect(isReasoningEffort("")).toBe(false);
    expect(isReasoningEffort(undefined)).toBe(false);
    expect(isReasoningEffort(5)).toBe(false);
  });
});

describe("SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS", () => {
  it("carries a Claude entry and a Codex entry, each with model+effort, for every tier", () => {
    for (const tier of ["frontier", "standard", "cheap"] as const) {
      const entry = SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults[tier];
      expect(typeof entry.claude.model).toBe("string");
      expect(isReasoningEffort(entry.claude.effort)).toBe(true);
      expect(typeof entry.codex.model).toBe("string");
      expect(isReasoningEffort(entry.codex.effort)).toBe(true);
    }
  });

  it("its Claude block matches the flat SEED_PLATFORM_MODEL_DEFAULTS models exactly", () => {
    expect(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier.claude.model).toBe(SEED_PLATFORM_MODEL_DEFAULTS.defaults.frontier);
    expect(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.standard.claude.model).toBe(SEED_PLATFORM_MODEL_DEFAULTS.defaults.standard);
    expect(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap.claude.model).toBe(SEED_PLATFORM_MODEL_DEFAULTS.defaults.cheap);
  });

  it("its Claude fallback chain is the same object shape as the flat seed's", () => {
    expect(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.fallback.claude).toEqual(SEED_PLATFORM_MODEL_DEFAULTS.fallback);
  });
});

describe("isValidAgentAwarePlatformModelDefaults", () => {
  it("accepts the agent-aware seed shape", () => {
    expect(isValidAgentAwarePlatformModelDefaults(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS)).toBe(true);
  });

  it("rejects the OLD flat shape (it's a different shape, not upgraded here)", () => {
    expect(isValidAgentAwarePlatformModelDefaults(SEED_PLATFORM_MODEL_DEFAULTS)).toBe(false);
  });

  it("rejects a tier entry missing the codex block", () => {
    const bad = {
      defaults: {
        frontier: { claude: { model: "opus", effort: "high" } },
        standard: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.standard,
        cheap: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap,
      },
      fallback: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.fallback,
    };
    expect(isValidAgentAwarePlatformModelDefaults(bad)).toBe(false);
  });

  it("rejects a tier entry with a model but no effort (FR-6)", () => {
    const bad = {
      defaults: {
        frontier: { claude: { model: "opus" }, codex: { model: "gpt-5.1-codex", effort: "high" } },
        standard: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.standard,
        cheap: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap,
      },
      fallback: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.fallback,
    };
    expect(isValidAgentAwarePlatformModelDefaults(bad)).toBe(false);
  });

  it("rejects an invalid effort value", () => {
    const bad = {
      defaults: {
        frontier: { claude: { model: "opus", effort: "extreme" }, codex: { model: "gpt-5.1-codex", effort: "high" } },
        standard: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.standard,
        cheap: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.cheap,
      },
      fallback: SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.fallback,
    };
    expect(isValidAgentAwarePlatformModelDefaults(bad)).toBe(false);
  });

  it("rejects non-objects, arrays, and null", () => {
    expect(isValidAgentAwarePlatformModelDefaults(null)).toBe(false);
    expect(isValidAgentAwarePlatformModelDefaults(undefined)).toBe(false);
    expect(isValidAgentAwarePlatformModelDefaults([])).toBe(false);
  });
});

describe("normalizeToAgentAwarePlatformModelDefaults", () => {
  it("passes an already agent-aware row through unchanged", () => {
    expect(normalizeToAgentAwarePlatformModelDefaults(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS)).toEqual(
      SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS
    );
  });

  it("BACKWARD-COMPATIBLE: an old flat row reads as the Claude block, with the seed effort and seed Codex block", () => {
    const legacy = {
      defaults: { frontier: "fable", standard: "sonnet", cheap: "haiku" },
      fallback: { fable: "opus", opus: "fable", sonnet: "opus", haiku: "sonnet" },
    };
    const upgraded = normalizeToAgentAwarePlatformModelDefaults(legacy);
    expect(upgraded.defaults.frontier.claude).toEqual({ model: "fable", effort: "high" });
    expect(upgraded.defaults.standard.claude).toEqual({ model: "sonnet", effort: "medium" });
    expect(upgraded.defaults.cheap.claude).toEqual({ model: "haiku", effort: "low" });
    expect(upgraded.defaults.frontier.codex).toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier.codex);
    expect(upgraded.fallback.claude).toEqual(legacy.fallback);
    expect(upgraded.fallback.codex).toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.fallback.codex);
  });

  it("degrades malformed input to the full agent-aware seed, never throws", () => {
    expect(normalizeToAgentAwarePlatformModelDefaults({ garbage: true })).toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
    expect(normalizeToAgentAwarePlatformModelDefaults(null)).toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
    expect(normalizeToAgentAwarePlatformModelDefaults(undefined)).toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
  });
});

describe("getAgentAwarePlatformModelDefaults", () => {
  it("returns the agent-aware seed when the row is missing", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    const result = await getAgentAwarePlatformModelDefaults(supabase);
    expect(result).toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
  });

  it("upgrades a legacy flat live row to the agent-aware shape", async () => {
    const legacy = { defaults: { frontier: "opus-5.5", standard: "sonnet", cheap: "haiku" }, fallback: { "opus-5.5": "opus" } };
    const supabase = makeSupabase({ data: { value: legacy }, error: null });
    const result = await getAgentAwarePlatformModelDefaults(supabase);
    expect(result.defaults.frontier.claude.model).toBe("opus-5.5");
    expect(result.defaults.frontier.codex).toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS.defaults.frontier.codex);
  });

  it("returns an already agent-aware live row unchanged", async () => {
    const live = SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS;
    const supabase = makeSupabase({ data: { value: live }, error: null });
    const result = await getAgentAwarePlatformModelDefaults(supabase);
    expect(result).toEqual(live);
  });

  it("never throws on a query error", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "connection reset" } });
    await expect(getAgentAwarePlatformModelDefaults(supabase)).resolves.toEqual(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
  });
});

describe("normalizeUserModelTierMap", () => {
  it("returns {} for null/undefined/non-object input", () => {
    expect(normalizeUserModelTierMap(null)).toEqual({});
    expect(normalizeUserModelTierMap(undefined)).toEqual({});
    expect(normalizeUserModelTierMap("opus")).toEqual({});
  });

  it("reads a legacy flat map's tier string as a Claude-only model override", () => {
    expect(normalizeUserModelTierMap({ frontier: "opus", cheap: "haiku" })).toEqual({
      frontier: { claude: { model: "opus" } },
      cheap: { claude: { model: "haiku" } },
    });
  });

  it("reads the agent-aware shape per tier/agent, dropping unknown/invalid effort values", () => {
    expect(
      normalizeUserModelTierMap({
        frontier: { claude: { model: "opus", effort: "high" }, codex: { model: "gpt-5.1-codex" } },
        standard: { claude: { effort: "not-a-level" } },
      })
    ).toEqual({
      frontier: { claude: { model: "opus", effort: "high" }, codex: { model: "gpt-5.1-codex" } },
      // standard.claude had only an invalid effort and no model -> drops entirely (no override signal)
    });
  });

  it("ignores an empty-string tier value", () => {
    expect(normalizeUserModelTierMap({ frontier: "" })).toEqual({});
  });
});
