import { describe, it, expect, vi } from "vitest";
import {
  getPlatformTerminalAutoCompactDefault,
  isValidPlatformAutoCompactDefault,
  TERMINAL_AUTO_COMPACT_DEFAULT_KEYS,
} from "./platform-terminal-auto-compact";

function makeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof getPlatformTerminalAutoCompactDefault>[0];
}

describe("isValidPlatformAutoCompactDefault", () => {
  it("accepts a window in range", () => {
    expect(isValidPlatformAutoCompactDefault({ window: 300_000 })).toBe(true);
  });
  it("rejects bad shapes and values", () => {
    for (const v of [{ window: 5 }, { window: "300000" }, { window: 1.5 }, {}, null, undefined, 300000, []]) {
      expect(isValidPlatformAutoCompactDefault(v)).toBe(false);
    }
  });
});

describe("getPlatformTerminalAutoCompactDefault (no seed in code: absent means send nothing)", () => {
  it("returns null for a missing row, an error and a malformed value", async () => {
    expect(await getPlatformTerminalAutoCompactDefault(makeSupabase({ data: null, error: null }), "claude")).toBeNull();
    expect(await getPlatformTerminalAutoCompactDefault(makeSupabase({ data: null, error: { message: "boom" } }), "claude")).toBeNull();
    expect(await getPlatformTerminalAutoCompactDefault(makeSupabase({ data: { value: { window: 7 } }, error: null }), "codex")).toBeNull();
  });
  it("returns the stored window", async () => {
    expect(await getPlatformTerminalAutoCompactDefault(makeSupabase({ data: { value: { window: 300_000 } }, error: null }), "claude")).toBe(300_000);
  });
  it("never throws", async () => {
    const supabase = { from: () => { throw new Error("x"); } } as unknown as Parameters<typeof getPlatformTerminalAutoCompactDefault>[0];
    expect(await getPlatformTerminalAutoCompactDefault(supabase, "codex")).toBeNull();
  });
  it("queries a separate key per agent", async () => {
    const a = makeSupabase({ data: null, error: null });
    await getPlatformTerminalAutoCompactDefault(a, "claude");
    const b = makeSupabase({ data: null, error: null });
    await getPlatformTerminalAutoCompactDefault(b, "codex");
    expect((a.from as ReturnType<typeof vi.fn>).mock.results[0].value.eq).toHaveBeenCalledWith("key", "terminal_auto_compact_default");
    expect((b.from as ReturnType<typeof vi.fn>).mock.results[0].value.eq).toHaveBeenCalledWith("key", "terminal_codex_auto_compact_default");
    expect(TERMINAL_AUTO_COMPACT_DEFAULT_KEYS.claude).not.toBe(TERMINAL_AUTO_COMPACT_DEFAULT_KEYS.codex);
  });
});
