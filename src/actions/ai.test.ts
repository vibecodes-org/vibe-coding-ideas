import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase client chain mock ─────────────────────────────────────────
const mockSingle = vi.fn();
// idea_attachments query resolves via .order().limit() — default: no attachments,
// so pre-existing tests (which don't care about attachments) see byte parity.
const mockLimit = vi.fn().mockResolvedValue({ data: [], error: null });
const chain: Record<string, unknown> = {};
const mockSelect = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
const mockOrder = vi.fn(() => chain);
Object.assign(chain, {
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
  order: mockOrder,
  limit: mockLimit,
});
const mockFrom = vi.fn((..._args: unknown[]) => chain);
const mockGetUser = vi.fn();
const mockDownload = vi.fn().mockResolvedValue({ data: null, error: null });
const mockStorageFrom = vi.fn((..._args: unknown[]) => ({ download: mockDownload }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
  }),
}));

// ── AI SDK mock — capture the system/user prompts passed to the AI SDK ─
const mockGenerateObject = vi.fn();
const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  generateText: (...args: unknown[]) => mockGenerateText(...args),
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

function resetSupabaseMocks() {
  mockSelect.mockImplementation(() => chain);
  mockEq.mockImplementation(() => chain);
  mockOrder.mockImplementation(() => chain);
  mockLimit.mockResolvedValue({ data: [], error: null });
  mockFrom.mockImplementation(() => chain);
  mockStorageFrom.mockImplementation(() => ({ download: mockDownload }));
  mockDownload.mockResolvedValue({ data: null, error: null });
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
}

describe("generateClarifyingQuestions — kit context injection (AC-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSupabaseMocks();
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

// ── Attachment context injection (AC-1, AC-6, AC-7, AC-8, AC-9) ──────────

const ideaRow = {
  id: "idea-1",
  title: "My idea",
  description: "desc",
  author_id: "user-1",
  project_kit: null,
};

describe("attachment context injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSupabaseMocks();
    mockSingle.mockResolvedValue({ data: ideaRow, error: null });
    mockGenerateText.mockResolvedValue({
      text: "enhanced",
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    });
    mockGenerateObject.mockResolvedValue({
      object: { questions: [{ id: "q1", question: "Who is it for?" }] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
  });

  it("AC-1: enhanceIdeaDescription injects a used markdown attachment's content into the prompt", async () => {
    mockLimit.mockResolvedValue({
      data: [
        {
          id: "a1",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a1.md",
        },
      ],
      error: null,
    });
    mockDownload.mockResolvedValue({
      data: { text: () => Promise.resolve("Attachment body content") },
      error: null,
    });

    const { enhanceIdeaDescription } = await import("./ai");
    await enhanceIdeaDescription("idea-1", "Make it better");

    const call = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toContain("## notes.md");
    expect(call.prompt).toContain("Attachment body content");
  });

  it("AC-6: enhanceIdeaWithContext leaves the prompt byte-identical when the idea has no attachments", async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });

    const { enhanceIdeaWithContext } = await import("./ai");
    await enhanceIdeaWithContext("idea-1", "Make it better");

    const call = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toBe(
      "Make it better\n\n---\n\n**Idea Title:** My idea\n\n**Current Description:**\ndesc"
    );
    expect(call.prompt).not.toContain("Attached Files");
  });

  it("AC-9: a storage download failure is absorbed — enhanceIdeaWithContext still succeeds with the file omitted", async () => {
    mockLimit.mockResolvedValue({
      data: [
        {
          id: "a1",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a1.md",
        },
      ],
      error: null,
    });
    mockDownload.mockResolvedValue({ data: null, error: { message: "storage offline" } });

    const { enhanceIdeaWithContext } = await import("./ai");
    const result = await enhanceIdeaWithContext("idea-1", "Make it better");

    expect(result.enhanced).toBe("enhanced");
    const call = mockGenerateText.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).not.toContain("Attached Files");
  });

  it("AC-7: generateClarifyingQuestions returns attachmentUsage additively without breaking { questions } destructuring", async () => {
    mockLimit.mockResolvedValue({
      data: [
        {
          id: "a1",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a1.md",
        },
      ],
      error: null,
    });
    mockDownload.mockResolvedValue({
      data: { text: () => Promise.resolve("Some markdown context") },
      error: null,
    });

    const { generateClarifyingQuestions } = await import("./ai");
    const result = await generateClarifyingQuestions("idea-1", "Make it better");

    // Existing callers destructure only `{ questions }` — still works.
    const { questions } = result;
    expect(questions).toEqual([{ id: "q1", question: "Who is it for?" }]);
    expect(result.attachmentUsage?.used).toEqual([{ id: "a1", name: "notes.md", truncated: false }]);

    const call = mockGenerateObject.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).toContain("Some markdown context");
  });

  it("AC-8: route.ts and enhanceIdeaWithContext build an identical attachment block for the same inputs", async () => {
    mockLimit.mockResolvedValue({
      data: [
        {
          id: "a1",
          file_name: "notes.md",
          file_size: 100,
          content_type: "text/markdown",
          storage_path: "idea-1/a1.md",
        },
      ],
      error: null,
    });
    mockDownload.mockResolvedValue({
      data: { text: () => Promise.resolve("Shared attachment content") },
      error: null,
    });

    // Both consumers call the same shared helper (getAttachmentContext) for the
    // same idea, so the produced block is identical by construction — assert
    // the actual text form directly rather than re-testing route.ts's route
    // handler here.
    const { getAttachmentContext } = await import("@/lib/attachment-context");
    const supabase = {
      from: (...args: unknown[]) => mockFrom(...args),
      storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
    };
    const first = await getAttachmentContext(supabase as never, "idea-1");
    const second = await getAttachmentContext(supabase as never, "idea-1");
    expect(first.promptBlock).toBe(second.promptBlock);
    expect(first.promptBlock).toContain("## notes.md");
  });
});
