import { describe, expect, it, vi } from "vitest";
import {
  getPlatformTerminalCodexModelDefault,
  isValidPlatformTerminalCodexModelDefault,
  TERMINAL_CODEX_MODEL_DEFAULT_KEY,
} from "./platform-terminal-codex-model";

function makeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof getPlatformTerminalCodexModelDefault>[0];
}

describe("platform Codex terminal default", () => {
  it("requires a complete model and effort pair", () => {
    expect(isValidPlatformTerminalCodexModelDefault({ model: "gpt-6-astra", effort: "high" })).toBe(true);
    expect(isValidPlatformTerminalCodexModelDefault({ model: "gpt-6-astra" })).toBe(false);
    expect(isValidPlatformTerminalCodexModelDefault({ model: "gpt-6-astra", effort: "extreme" })).toBe(false);
  });

  it("returns the complete saved pair", async () => {
    const supabase = makeSupabase({ data: { value: { model: "gpt-6-astra", effort: "high" } }, error: null });
    await expect(getPlatformTerminalCodexModelDefault(supabase)).resolves.toEqual({ model: "gpt-6-astra", effort: "high" });
    const chain = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith("key", TERMINAL_CODEX_MODEL_DEFAULT_KEY);
  });

  it("degrades missing, malformed, and failed reads to the Standard fallback source", async () => {
    await expect(getPlatformTerminalCodexModelDefault(makeSupabase({ data: null, error: null }))).resolves.toBeNull();
    await expect(getPlatformTerminalCodexModelDefault(makeSupabase({ data: { value: { model: "gpt-6-astra" } }, error: null }))).resolves.toBeNull();
    await expect(getPlatformTerminalCodexModelDefault(makeSupabase({ data: null, error: { message: "down" } }))).resolves.toBeNull();
  });
});
