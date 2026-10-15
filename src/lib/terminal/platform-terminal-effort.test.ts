import { describe, it, expect, vi } from "vitest";
import {
  getPlatformTerminalEffortDefault,
  isValidPlatformTerminalEffortDefault,
  TERMINAL_EFFORT_DEFAULT_KEY,
} from "./platform-terminal-effort";

function makeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof getPlatformTerminalEffortDefault>[0];
}

describe("isValidPlatformTerminalEffortDefault", () => {
  it("accepts every Claude level, including max", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      expect(isValidPlatformTerminalEffortDefault({ effort })).toBe(true);
    }
  });
  it("rejects Codex-only, unknown, missing and non-object values", () => {
    for (const v of [{ effort: "minimal" }, { effort: "ultracode" }, { effort: "" }, { effort: 5 }, {}, null, undefined, "high", []]) {
      expect(isValidPlatformTerminalEffortDefault(v)).toBe(false);
    }
  });
});

describe("getPlatformTerminalEffortDefault (no seed: absent means send nothing)", () => {
  it("returns null for a missing row", async () => {
    expect(await getPlatformTerminalEffortDefault(makeSupabase({ data: null, error: null }))).toBeNull();
  });
  it("returns null on a query error", async () => {
    expect(await getPlatformTerminalEffortDefault(makeSupabase({ data: null, error: { message: "boom" } }))).toBeNull();
  });
  it("returns null for a malformed value", async () => {
    expect(await getPlatformTerminalEffortDefault(makeSupabase({ data: { value: { effort: "minimal" } }, error: null }))).toBeNull();
  });
  it("returns the stored level, max included", async () => {
    expect(await getPlatformTerminalEffortDefault(makeSupabase({ data: { value: { effort: "high" } }, error: null }))).toBe("high");
    expect(await getPlatformTerminalEffortDefault(makeSupabase({ data: { value: { effort: "max" } }, error: null }))).toBe("max");
  });
  it("queries the documented key", async () => {
    const supabase = makeSupabase({ data: null, error: null });
    await getPlatformTerminalEffortDefault(supabase);
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(supabase.from).toHaveBeenCalledWith("platform_settings");
    expect(chain.eq).toHaveBeenCalledWith("key", TERMINAL_EFFORT_DEFAULT_KEY);
    expect(TERMINAL_EFFORT_DEFAULT_KEY).toBe("terminal_effort_default");
  });
  it("never throws", async () => {
    const s = { from: () => { throw new Error("x"); } } as unknown as Parameters<typeof getPlatformTerminalEffortDefault>[0];
    await expect(getPlatformTerminalEffortDefault(s)).resolves.toBeNull();
  });
});
