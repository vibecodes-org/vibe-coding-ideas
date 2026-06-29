import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase client chain mock ─────────────────────────────────────────
const mockSingle = vi.fn();
const chain: Record<string, unknown> = {};
const mockSelect = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
Object.assign(chain, {
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
});
const mockFrom = vi.fn((..._args: unknown[]) => chain);
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  }),
}));

// ── AI SDK mock — capture the system prompt passed to generateObject ───
const mockGenerateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  generateText: vi.fn(),
}));

// ── AI access helpers ──────────────────────────────────────────────────
vi.mock("@/lib/ai-helpers", () => ({
  AI_MODEL: "test-model",
  resolveAiProvider: vi.fn().mockResolvedValue({
    ok: true,
    anthropic: (m: string) => m,
    keyType: "byok",
  }),
  chargeAiUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

async function getAction() {
  const mod = await import("./ai");
  return mod.generateClarifyingQuestions;
}

describe("generateClarifyingQuestions — kit context injection (AC-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockImplementation(() => chain);
    mockEq.mockImplementation(() => chain);
    mockFrom.mockImplementation(() => chain);
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockGenerateObject.mockResolvedValue({
      object: { questions: [{ id: "q1", question: "Who is it for?" }] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
  });

  it("injects kit context into the system prompt when the idea has an applied kit", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: "idea-1",
        title: "My idea",
        description: "desc",
        author_id: "user-1",
        project_kit: { name: "SaaS Web App" },
      },
      error: null,
    });

    const generateClarifyingQuestions = await getAction();
    await generateClarifyingQuestions("idea-1", "Make it better");

    const call = mockGenerateObject.mock.calls[0][0] as { system: string };
    expect(call.system).toContain("SaaS Web App");
    expect(call.system.toLowerCase()).toContain("saas web app project");
  });

  it("omits kit context when the idea has no applied kit", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: "idea-1",
        title: "My idea",
        description: "desc",
        author_id: "user-1",
        project_kit: null,
      },
      error: null,
    });

    const generateClarifyingQuestions = await getAction();
    await generateClarifyingQuestions("idea-1", "Make it better");

    const call = mockGenerateObject.mock.calls[0][0] as { system: string };
    expect(call.system).not.toMatch(/This is a \*\*.*\*\* project/);
  });

  it("rejects when the caller is not the idea author (authorization preserved)", async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: "idea-1",
        title: "My idea",
        description: "desc",
        author_id: "someone-else",
        project_kit: { name: "SaaS Web App" },
      },
      error: null,
    });

    const generateClarifyingQuestions = await getAction();
    await expect(
      generateClarifyingQuestions("idea-1", "Make it better")
    ).rejects.toThrow(/only the idea author/i);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });
});
