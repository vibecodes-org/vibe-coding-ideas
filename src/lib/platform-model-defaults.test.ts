import { describe, it, expect, vi } from "vitest";
import {
  getPlatformModelDefaults,
  isValidPlatformModelDefaults,
  SEED_PLATFORM_MODEL_DEFAULTS,
  PLATFORM_MODEL_DEFAULTS_KEY,
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
