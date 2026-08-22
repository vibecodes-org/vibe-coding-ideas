import { describe, it, expect, vi } from "vitest";
import {
  getPlatformTerminalModelDefault,
  isValidPlatformTerminalModelDefault,
  TERMINAL_MODEL_DEFAULT_KEY,
} from "./platform-terminal-model";

/** Minimal Supabase-shaped mock: `.from(table).select().eq().maybeSingle()`. */
function makeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof getPlatformTerminalModelDefault>[0];
}

describe("isValidPlatformTerminalModelDefault", () => {
  it("accepts a valid shape, including a novel free-text family", () => {
    expect(isValidPlatformTerminalModelDefault({ model: "opus" })).toBe(true);
    expect(isValidPlatformTerminalModelDefault({ model: "claude-opus-5-20260101" })).toBe(true);
  });

  it("rejects non-objects, arrays, and null", () => {
    expect(isValidPlatformTerminalModelDefault(null)).toBe(false);
    expect(isValidPlatformTerminalModelDefault(undefined)).toBe(false);
    expect(isValidPlatformTerminalModelDefault("opus")).toBe(false);
    expect(isValidPlatformTerminalModelDefault([])).toBe(false);
  });

  it("rejects a missing or empty model field", () => {
    expect(isValidPlatformTerminalModelDefault({})).toBe(false);
    expect(isValidPlatformTerminalModelDefault({ model: "" })).toBe(false);
    expect(isValidPlatformTerminalModelDefault({ model: "   " })).toBe(false);
    expect(isValidPlatformTerminalModelDefault({ model: 5 })).toBe(false);
  });
});

describe("getPlatformTerminalModelDefault (binding: NO seed — absent means omit)", () => {
  it("returns null when the row is missing — nothing saved yet, no warning-worthy condition", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    const result = await getPlatformTerminalModelDefault(supabase);
    expect(result).toBeNull();
  });

  it("returns null (never a hardcoded seed) on a query error", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "connection reset" } });
    const result = await getPlatformTerminalModelDefault(supabase);
    expect(result).toBeNull();
  });

  it("returns null when the stored value is structurally invalid, never crashes", async () => {
    const supabase = makeSupabase({ data: { value: { notModel: "opus" } }, error: null });
    const result = await getPlatformTerminalModelDefault(supabase);
    expect(result).toBeNull();
  });

  it("returns the live stored model when valid", async () => {
    const supabase = makeSupabase({ data: { value: { model: "opus" } }, error: null });
    const result = await getPlatformTerminalModelDefault(supabase);
    expect(result).toBe("opus");
  });

  it("returns a novel/custom model family verbatim", async () => {
    const supabase = makeSupabase({ data: { value: { model: "opus-5.5" } }, error: null });
    const result = await getPlatformTerminalModelDefault(supabase);
    expect(result).toBe("opus-5.5");
  });

  it("queries by the documented settings key", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    await getPlatformTerminalModelDefault(supabase);
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(supabase.from).toHaveBeenCalledWith("platform_settings");
    expect(chain.eq).toHaveBeenCalledWith("key", TERMINAL_MODEL_DEFAULT_KEY);
  });

  it("never throws even if the client itself throws synchronously (AC-2: never block a launch)", async () => {
    const throwingSupabase = {
      from: () => {
        throw new Error("client not configured");
      },
    } as unknown as Parameters<typeof getPlatformTerminalModelDefault>[0];

    await expect(getPlatformTerminalModelDefault(throwingSupabase)).resolves.toBeNull();
  });
});
