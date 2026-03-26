import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Supabase client — all chain methods return `chain` by default,
// individual tests override terminal methods (single, gte) as needed.
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();
const chain: Record<string, unknown> = {};
const mockUpdate = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
const mockInsert = vi.fn(() => chain);
const mockSelect = vi.fn(() => chain);
const mockLimit = vi.fn(() => chain);
const mockIlike = vi.fn(() => chain);
const mockIn = vi.fn(() => chain);
Object.assign(chain, {
  update: mockUpdate,
  insert: mockInsert,
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  gte: mockGte,
  order: mockOrder,
  limit: mockLimit,
  ilike: mockIlike,
  in: mockIn,
});
const mockFrom = vi.fn(() => chain);
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`REDIRECT: ${url}`), {
      digest: "NEXT_REDIRECT",
    });
  }),
}));

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({
    text: "Enhanced description text",
    usage: { inputTokens: 100, outputTokens: 50 },
    finishReason: "stop",
  }),
  generateObject: vi.fn().mockResolvedValue({
    object: {
      tasks: [
        { title: "Set up project", description: "Init repo", columnName: "To Do" },
        { title: "Build landing page", description: "Create UI", columnName: "Backlog" },
      ],
    },
    usage: { inputTokens: 200, outputTokens: 300 },
  }),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn().mockReturnValue(
    vi.fn().mockReturnValue("mock-model")
  ),
}));

const mockApplyKit = vi.fn();
vi.mock("@/actions/kits", () => ({
  applyKit: (...args: unknown[]) => mockApplyKit(...args),
}));

describe("onboarding actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set default chain implementations (clearAllMocks doesn't reset mockReturnValue)
    mockUpdate.mockImplementation(() => chain);
    mockEq.mockImplementation(() => chain);
    mockInsert.mockImplementation(() => chain);
    mockSelect.mockImplementation(() => chain);
    mockFrom.mockImplementation(() => chain);
    mockOrder.mockImplementation(() => chain);
    mockLimit.mockImplementation(() => chain);
    mockIlike.mockImplementation(() => chain);
    mockIn.mockImplementation(() => chain);
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
    // Default terminal mocks
    mockSingle.mockResolvedValue({
      data: { id: "idea-123" },
      error: null,
    });
    mockApplyKit.mockResolvedValue({
      agentsCreated: 3,
      agentsSkipped: 0,
      labelsCreated: 4,
      templateImported: true,
      autoRuleCreated: true,
    });
  });

  describe("completeOnboarding", () => {
    it("updates onboarding_completed_at on the user row", async () => {
      const { completeOnboarding } = await import("./onboarding");

      // Mock chain: from("users").update(...).eq(...)
      mockUpdate.mockReturnValue({ eq: mockEq });
      mockEq.mockResolvedValue({ error: null });

      await completeOnboarding();

      expect(mockFrom).toHaveBeenCalledWith("users");
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          onboarding_completed_at: expect.any(String),
        })
      );
      expect(mockEq).toHaveBeenCalledWith("id", "user-1");
    });

    it("redirects unauthenticated users to login", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { completeOnboarding } = await import("./onboarding");

      await expect(completeOnboarding()).rejects.toThrow("REDIRECT: /login");
    });
  });

  describe("createIdeaFromOnboarding", () => {
    it("creates an idea and returns the ID", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      mockInsert.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({
        data: { id: "new-idea-id" },
        error: null,
      });

      const result = await createIdeaFromOnboarding({
        title: "My cool app",
        description: "A description",
        tags: ["ai", "web"],
      });

      expect(result).toEqual({ ideaId: "new-idea-id" });
      expect(mockFrom).toHaveBeenCalledWith("ideas");
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "My cool app",
          description: "A description",
          tags: ["ai", "web"],
          visibility: "public",
          author_id: "user-1",
        })
      );
    });

    it("accepts kitId and calls applyKit after idea creation", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      mockInsert.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({
        data: { id: "new-idea-id" },
        error: null,
      });

      const result = await createIdeaFromOnboarding({
        title: "My app",
        kitId: "kit-123",
      });

      expect(mockApplyKit).toHaveBeenCalledWith("new-idea-id", "kit-123");
      expect(result.kitResult).toEqual(
        expect.objectContaining({
          agentsCreated: 3,
          templateImported: true,
        })
      );
    });

    it("accepts visibility parameter", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      mockInsert.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({
        data: { id: "new-idea-id" },
        error: null,
      });

      await createIdeaFromOnboarding({
        title: "Secret project",
        visibility: "private",
      });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: "private" })
      );
    });

    it("does not throw when kit application fails", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      mockInsert.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({
        data: { id: "new-idea-id" },
        error: null,
      });
      mockApplyKit.mockRejectedValue(new Error("Kit failed"));

      const result = await createIdeaFromOnboarding({
        title: "My app",
        kitId: "bad-kit",
      });

      expect(result.ideaId).toBe("new-idea-id");
      expect(result.kitResult).toBeUndefined();
    });

    it("defaults to public visibility and empty tags", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      mockInsert.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({
        data: { id: "new-idea-id" },
        error: null,
      });

      await createIdeaFromOnboarding({ title: "Minimal" });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: "public",
          tags: [],
        })
      );
    });

    it("rejects empty titles", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      await expect(
        createIdeaFromOnboarding({ title: "  " })
      ).rejects.toThrow("Title is required");
    });

    it("rejects too many tags", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");
      const tooManyTags = Array.from({ length: 11 }, (_, i) => `tag${i}`);

      await expect(
        createIdeaFromOnboarding({ title: "Test", tags: tooManyTags })
      ).rejects.toThrow("Maximum 10 tags allowed");
    });

    it("uses title as description when description is empty", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      mockInsert.mockReturnValue({ select: mockSelect });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockSingle.mockResolvedValue({
        data: { id: "new-idea-id" },
        error: null,
      });

      await createIdeaFromOnboarding({ title: "My app" });

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "My app",
        })
      );
    });
  });

  describe("updateProfileFromOnboarding", () => {
    it("updates profile fields", async () => {
      const { updateProfileFromOnboarding } = await import("./onboarding");

      mockUpdate.mockReturnValue({ eq: mockEq });
      mockEq.mockResolvedValue({ error: null });

      await updateProfileFromOnboarding({
        full_name: "Nick Ball",
        bio: "Developer",
        github_username: "nickball",
      });

      expect(mockFrom).toHaveBeenCalledWith("users");
      expect(mockUpdate).toHaveBeenCalledWith({
        full_name: "Nick Ball",
        bio: "Developer",
        github_username: "nickball",
      });
    });

    it("skips update when no fields provided", async () => {
      const { updateProfileFromOnboarding } = await import("./onboarding");

      await updateProfileFromOnboarding({});

      // Should not call from() for profile update (only auth.getUser)
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("trims empty strings to null", async () => {
      const { updateProfileFromOnboarding } = await import("./onboarding");

      mockUpdate.mockReturnValue({ eq: mockEq });
      mockEq.mockResolvedValue({ error: null });

      await updateProfileFromOnboarding({
        full_name: "  ",
        bio: "",
        github_username: "  ",
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        full_name: null,
        bio: null,
        github_username: null,
      });
    });
  });

  describe("enhanceOnboardingDescription", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, ANTHROPIC_API_KEY: "sk-test-key" };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("enhances a description for users who haven't completed onboarding", async () => {
      const { enhanceOnboardingDescription } = await import("./onboarding");

      // Chain methods return `chain` by default — just configure terminals
      mockSingle.mockResolvedValue({
        data: { onboarding_completed_at: null },
        error: null,
      });
      mockGte.mockResolvedValue({ count: 0, error: null });

      const result = await enhanceOnboardingDescription({
        title: "My cool app",
        description: "An app that does stuff",
      });

      expect(result).toEqual({ enhanced: "Enhanced description text" });
    });

    it("throws when platform key is missing", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const { enhanceOnboardingDescription } = await import("./onboarding");

      await expect(
        enhanceOnboardingDescription({
          title: "Test",
          description: "Test desc",
        })
      ).rejects.toThrow("AI enhancement is not available right now");
    });

    it("throws when user already completed onboarding", async () => {
      const { enhanceOnboardingDescription } = await import("./onboarding");

      mockSingle.mockResolvedValue({
        data: { onboarding_completed_at: "2026-01-01T00:00:00Z" },
        error: null,
      });

      await expect(
        enhanceOnboardingDescription({
          title: "Test",
          description: "Test desc",
        })
      ).rejects.toThrow("AI enhancement during onboarding is no longer available");
    });

    it("rejects empty titles", async () => {
      const { enhanceOnboardingDescription } = await import("./onboarding");

      mockSingle.mockResolvedValue({
        data: { onboarding_completed_at: null },
        error: null,
      });
      mockGte.mockResolvedValue({ count: 0, error: null });

      await expect(
        enhanceOnboardingDescription({ title: "  ", description: "" })
      ).rejects.toThrow("Title is required");
    });
  });

  describe("generateBoardFromOnboarding", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, ANTHROPIC_API_KEY: "sk-test-key" };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("generates board tasks for an idea during onboarding", async () => {
      const { generateBoardFromOnboarding } = await import("./onboarding");

      // Mock onboarding check: not completed
      mockSingle
        .mockResolvedValueOnce({ data: { onboarding_completed_at: null }, error: null })
        // Mock idea fetch
        .mockResolvedValueOnce({ data: { id: "idea-1", title: "My App", description: "A cool app" }, error: null });
      mockGte.mockResolvedValue({ count: 0, error: null });
      // Mock columns query (order returns the chain with data) — called twice:
      // 1. Initial columns fetch for AI prompt context
      // 2. Columns fetch after initializeBoardColumns for task insertion
      mockOrder
        .mockResolvedValueOnce({ data: [{ title: "To Do" }, { title: "Backlog" }], error: null })
        .mockResolvedValueOnce({ data: [{ id: "col-1", title: "To Do", position: 0 }, { id: "col-2", title: "Backlog", position: 1000 }], error: null });
      // Mock board_labels fetch (returns empty — no labels)
      mockSelect.mockImplementation(() => {
        // board_task_labels insert returns { data: null, error: null }
        return { ...chain, select: mockSelect };
      });
      // Mock task insert with .select("id") chain
      mockInsert.mockImplementation(() => ({
        ...chain,
        select: vi.fn().mockResolvedValue({
          data: [{ id: "task-1" }, { id: "task-2" }],
          error: null,
        }),
      }));

      const result = await generateBoardFromOnboarding("idea-1");

      expect(result.count).toBe(2);
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].title).toBe("Set up project");
    });

    it("throws when platform key is missing", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      const { generateBoardFromOnboarding } = await import("./onboarding");

      await expect(generateBoardFromOnboarding("idea-1")).rejects.toThrow(
        "AI board generation is not available right now"
      );
    });

    it("throws when user already completed onboarding", async () => {
      const { generateBoardFromOnboarding } = await import("./onboarding");

      mockSingle.mockResolvedValue({
        data: { onboarding_completed_at: "2026-01-01T00:00:00Z" },
        error: null,
      });

      await expect(generateBoardFromOnboarding("idea-1")).rejects.toThrow(
        "Free board generation during onboarding is no longer available"
      );
    });
  });
});
