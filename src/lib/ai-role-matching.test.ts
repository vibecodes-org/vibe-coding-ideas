import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@/lib/ai-helpers", () => ({
  AI_MODEL: "claude-sonnet-4-6",
  resolveAiProvider: vi.fn(),
  logAiUsage: vi.fn(),
  decrementStarterCredit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { matchRolesWithAi, matchRolesWithAiOrFuzzy } from "./ai-role-matching";
import { generateObject } from "ai";
import { resolveAiProvider, logAiUsage, decrementStarterCredit } from "@/lib/ai-helpers";

const mockGenerateObject = vi.mocked(generateObject);
const mockResolveAiProvider = vi.mocked(resolveAiProvider);
const mockLogAiUsage = vi.mocked(logAiUsage);
const mockDecrementStarterCredit = vi.mocked(decrementStarterCredit);

// Fake Supabase client (only used for type satisfaction and passing to mocked functions)
const fakeSupabase = {} as Parameters<typeof matchRolesWithAi>[0];

const testAgents = [
  { botId: "bot-1", name: "Alice", role: "Frontend Developer" },
  { botId: "bot-2", name: "Bob", role: "Backend Engineer" },
  { botId: "bot-3", name: "Carol", role: "QA Tester" },
];

const mockAnthropicFn = vi.fn();

describe("matchRolesWithAi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapping when AI is available", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "byok",
    });

    mockGenerateObject.mockResolvedValue({
      object: {
        matches: [
          { stepRole: "UI Developer", botId: "bot-1" },
          { stepRole: "API Developer", botId: "bot-2" },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const result = await matchRolesWithAi(
      fakeSupabase,
      "user-1",
      ["UI Developer", "API Developer"],
      testAgents
    );

    expect(result).toEqual({
      "UI Developer": "bot-1",
      "API Developer": "bot-2",
    });

    expect(mockResolveAiProvider).toHaveBeenCalledWith(fakeSupabase, "user-1");
    expect(mockGenerateObject).toHaveBeenCalledOnce();
    expect(mockLogAiUsage).toHaveBeenCalledWith(fakeSupabase, {
      userId: "user-1",
      actionType: "role_matching",
      inputTokens: 100,
      outputTokens: 50,
      model: "claude-sonnet-4-6",
      ideaId: null,
      keyType: "byok",
    });
    // BYOK — should NOT decrement starter credit
    expect(mockDecrementStarterCredit).not.toHaveBeenCalled();
  });

  it("decrements starter credit when using platform key", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "platform",
    });

    mockGenerateObject.mockResolvedValue({
      object: {
        matches: [{ stepRole: "Designer", botId: "bot-1" }],
      },
      usage: { inputTokens: 50, outputTokens: 20 },
    } as never);

    await matchRolesWithAi(fakeSupabase, "user-1", ["Designer"], testAgents);

    expect(mockDecrementStarterCredit).toHaveBeenCalledWith(fakeSupabase, "user-1");
  });

  it("returns null when AI access fails", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: false,
      error: "No API key",
      status: 403,
    });

    const result = await matchRolesWithAi(
      fakeSupabase,
      "user-1",
      ["UI Developer"],
      testAgents
    );

    expect(result).toBeNull();
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("returns null on AI error (silent fallback)", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "byok",
    });

    mockGenerateObject.mockRejectedValue(new Error("API timeout"));

    const result = await matchRolesWithAi(
      fakeSupabase,
      "user-1",
      ["UI Developer"],
      testAgents
    );

    expect(result).toBeNull();
  });

  it("returns null when stepRoles is empty", async () => {
    const result = await matchRolesWithAi(fakeSupabase, "user-1", [], testAgents);
    expect(result).toBeNull();
    expect(mockResolveAiProvider).not.toHaveBeenCalled();
  });

  it("returns null when agents is empty", async () => {
    const result = await matchRolesWithAi(fakeSupabase, "user-1", ["Dev"], []);
    expect(result).toBeNull();
    expect(mockResolveAiProvider).not.toHaveBeenCalled();
  });

  it("validates returned botIds against agent list", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "byok",
    });

    mockGenerateObject.mockResolvedValue({
      object: {
        matches: [
          { stepRole: "UI Developer", botId: "bot-1" },
          { stepRole: "API Developer", botId: "invalid-bot-id" }, // not in agent list
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const result = await matchRolesWithAi(
      fakeSupabase,
      "user-1",
      ["UI Developer", "API Developer"],
      testAgents
    );

    expect(result).toEqual({
      "UI Developer": "bot-1",
      "API Developer": null, // invalid ID replaced with null
    });
  });

  it("ensures all requested roles have an entry", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "byok",
    });

    // AI only returns a match for one of two roles
    mockGenerateObject.mockResolvedValue({
      object: {
        matches: [{ stepRole: "UI Developer", botId: "bot-1" }],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const result = await matchRolesWithAi(
      fakeSupabase,
      "user-1",
      ["UI Developer", "DevOps Engineer"],
      testAgents
    );

    expect(result).toEqual({
      "UI Developer": "bot-1",
      "DevOps Engineer": null, // missing from AI response, filled with null
    });
  });
});

describe("matchRolesWithAiOrFuzzy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses AI result when available", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "byok",
    });

    mockGenerateObject.mockResolvedValue({
      object: {
        matches: [
          { stepRole: "UI Developer", botId: "bot-1" },
          { stepRole: "API Developer", botId: "bot-2" },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const result = await matchRolesWithAiOrFuzzy(
      fakeSupabase,
      "user-1",
      ["UI Developer", "API Developer"],
      testAgents
    );

    expect(result).toEqual({
      "UI Developer": { botId: "bot-1", tier: "ai" },
      "API Developer": { botId: "bot-2", tier: "ai" },
    });

    // Verify AI path was taken
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });

  it("falls back to fuzzy when AI returns null", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: false,
      error: "No API key",
      status: 403,
    });

    const result = await matchRolesWithAiOrFuzzy(
      fakeSupabase,
      "user-1",
      ["Frontend Developer", "Unknown Role"],
      testAgents
    );

    // Fuzzy should match "Frontend Developer" exactly — now returns tier info
    expect(result["Frontend Developer"]).toEqual({ botId: "bot-1", tier: "exact" });
    // "Unknown Role" has no fuzzy match
    expect(result["Unknown Role"]).toEqual({ botId: null, tier: "none" });

    // Verify AI was NOT called
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("falls back to fuzzy when AI throws", async () => {
    mockResolveAiProvider.mockResolvedValue({
      ok: true,
      anthropic: mockAnthropicFn as never,
      keyType: "byok",
    });

    mockGenerateObject.mockRejectedValue(new Error("Network error"));

    const result = await matchRolesWithAiOrFuzzy(
      fakeSupabase,
      "user-1",
      ["Backend Engineer"],
      testAgents
    );

    // Fuzzy should match "Backend Engineer" exactly — now returns tier info
    expect(result["Backend Engineer"]).toEqual({ botId: "bot-2", tier: "exact" });
  });
});
