import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SAMPLE_IDEA_CONTENT, POSITION_GAP } from "@/lib/constants";

// Mock the Supabase client — all chain methods return `chain` by default,
// individual tests override terminal methods (single, gte) as needed.
const mockSingle = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();
const chain: Record<string, unknown> = {};
const mockUpdate = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
const mockInsert = vi.fn(() => chain);
const mockSelect = vi.fn(() => chain);
Object.assign(chain, {
  update: mockUpdate,
  insert: mockInsert,
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
  gte: mockGte,
  order: mockOrder,
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
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn().mockReturnValue(
    vi.fn().mockReturnValue("mock-model")
  ),
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
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
    // Default terminal mocks
    mockSingle.mockResolvedValue({
      data: { id: "idea-123" },
      error: null,
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

      // Mock chain: from("ideas").insert(...).select("id").single()
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

    it("rejects empty titles", async () => {
      const { createIdeaFromOnboarding } = await import("./onboarding");

      await expect(
        createIdeaFromOnboarding({ title: "  ", tags: [] })
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

      await createIdeaFromOnboarding({ title: "My app", tags: [] });

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

  describe("createSampleIdea", () => {
    it("creates sample idea with board and tasks when user has no ideas", async () => {
      const { createSampleIdea } = await import("./onboarding");

      // Mock count query: from("ideas").select("*", { head: true, count: "exact" }).eq(...)
      // Returns 0 ideas
      const countChain: Record<string, unknown> = {};
      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => countChain);
      Object.assign(countChain, { eq: countEq, select: countSelect });

      // Mock idea insert: from("ideas").insert(...).select("id").single()
      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: { id: "sample-idea-id" },
        error: null,
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      // Mock columns insert: from("board_columns").insert(...).select("id, position").order(...)
      const colOrderFn = vi.fn().mockResolvedValue({
        data: [
          { id: "col-0", position: 0 },
          { id: "col-1", position: 1000 },
          { id: "col-2", position: 2000 },
          { id: "col-3", position: 3000 },
          { id: "col-4", position: 4000 },
          { id: "col-5", position: 5000 },
        ],
        error: null,
      });
      const colSelect = vi.fn(() => ({ order: colOrderFn }));
      const colInsert = vi.fn(() => ({ select: colSelect }));

      // Mock tasks insert: from("board_tasks").insert(...)
      const taskInsert = vi.fn().mockResolvedValue({ error: null });

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) {
            // Count query
            return { select: countSelect };
          }
          // Insert query
          return { insert: insertFn };
        }
        if (table === "board_columns") {
          return { insert: colInsert };
        }
        if (table === "board_tasks") {
          return { insert: taskInsert };
        }
        return chain;
      });

      const result = await createSampleIdea();

      expect(result).toEqual({ ideaId: "sample-idea-id" });
      expect(insertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          visibility: "private",
          is_sample: true,
          title: "My First Project",
        })
      );
      expect(taskInsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: "Explore the board", column_id: "col-1" }),
          expect.objectContaining({ title: "Try creating a new task", column_id: "col-1" }),
          expect.objectContaining({ title: "Check out the AI features", column_id: "col-0" }),
        ])
      );
    });

    it("returns null when user already has ideas (idempotency)", async () => {
      const { createSampleIdea } = await import("./onboarding");

      // Mock count query returning 1
      const countEq = vi.fn().mockResolvedValue({ count: 1, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          return { select: countSelect };
        }
        return chain;
      });

      const result = await createSampleIdea();
      expect(result).toBeNull();
    });

    it("throws when idea insert fails", async () => {
      const { createSampleIdea } = await import("./onboarding");

      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "insert failed" },
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) return { select: countSelect };
          return { insert: insertFn };
        }
        return chain;
      });

      await expect(createSampleIdea()).rejects.toThrow(
        "Failed to create sample idea"
      );
    });

    it("returns null on unique constraint violation (23505 race condition)", async () => {
      const { createSampleIdea } = await import("./onboarding");

      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "duplicate key", code: "23505" },
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) return { select: countSelect };
          return { insert: insertFn };
        }
        return chain;
      });

      const result = await createSampleIdea();
      expect(result).toBeNull();
    });

    it("throws on count query error", async () => {
      const { createSampleIdea } = await import("./onboarding");

      const countEq = vi.fn().mockResolvedValue({
        count: null,
        error: { message: "connection error" },
      });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") return { select: countSelect };
        return chain;
      });

      await expect(createSampleIdea()).rejects.toThrow(
        "Failed to check existing ideas"
      );
    });

    it("returns ideaId even when column insert fails (graceful degradation)", async () => {
      const { createSampleIdea } = await import("./onboarding");

      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: { id: "sample-idea-id" },
        error: null,
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      // Column insert fails
      const colOrderFn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "column insert failed" },
      });
      const colSelect = vi.fn(() => ({ order: colOrderFn }));
      const colInsert = vi.fn(() => ({ select: colSelect }));

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) return { select: countSelect };
          return { insert: insertFn };
        }
        if (table === "board_columns") return { insert: colInsert };
        return chain;
      });

      const result = await createSampleIdea();
      expect(result).toEqual({ ideaId: "sample-idea-id" });
    });

    it("redirects unauthenticated users to login", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { createSampleIdea } = await import("./onboarding");

      await expect(createSampleIdea()).rejects.toThrow("REDIRECT: /login");
    });

    it("skips task insert when column insert fails (no board_tasks call)", async () => {
      const { createSampleIdea } = await import("./onboarding");

      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: { id: "sample-idea-id" },
        error: null,
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      const colOrderFn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "column insert failed" },
      });
      const colSelect = vi.fn(() => ({ order: colOrderFn }));
      const colInsert = vi.fn(() => ({ select: colSelect }));

      const taskInsert = vi.fn().mockResolvedValue({ error: null });

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) return { select: countSelect };
          return { insert: insertFn };
        }
        if (table === "board_columns") return { insert: colInsert };
        if (table === "board_tasks") return { insert: taskInsert };
        return chain;
      });

      await createSampleIdea();
      expect(taskInsert).not.toHaveBeenCalled();
    });

    it("logs error but still returns ideaId when task insert fails", async () => {
      const { createSampleIdea } = await import("./onboarding");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: { id: "sample-idea-id" },
        error: null,
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      const colOrderFn = vi.fn().mockResolvedValue({
        data: [
          { id: "col-0", position: 0 },
          { id: "col-1", position: 1000 },
          { id: "col-2", position: 2000 },
          { id: "col-3", position: 3000 },
          { id: "col-4", position: 4000 },
          { id: "col-5", position: 5000 },
        ],
        error: null,
      });
      const colSelect = vi.fn(() => ({ order: colOrderFn }));
      const colInsert = vi.fn(() => ({ select: colSelect }));

      const taskInsert = vi.fn().mockResolvedValue({
        error: { message: "task insert failed" },
      });

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) return { select: countSelect };
          return { insert: insertFn };
        }
        if (table === "board_columns") return { insert: colInsert };
        if (table === "board_tasks") return { insert: taskInsert };
        return chain;
      });

      const result = await createSampleIdea();
      expect(result).toEqual({ ideaId: "sample-idea-id" });
      expect(consoleSpy).toHaveBeenCalledWith(
        "[createSampleIdea] task insert failed:",
        expect.objectContaining({ message: "task insert failed" })
      );
      consoleSpy.mockRestore();
    });

    it("sets correct position values on tasks using POSITION_GAP", async () => {
      const { createSampleIdea } = await import("./onboarding");

      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: { id: "sample-idea-id" },
        error: null,
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      const colOrderFn = vi.fn().mockResolvedValue({
        data: [
          { id: "col-0", position: 0 },
          { id: "col-1", position: 1000 },
          { id: "col-2", position: 2000 },
          { id: "col-3", position: 3000 },
          { id: "col-4", position: 4000 },
          { id: "col-5", position: 5000 },
        ],
        error: null,
      });
      const colSelect = vi.fn(() => ({ order: colOrderFn }));
      const colInsert = vi.fn(() => ({ select: colSelect }));

      const taskInsert = vi.fn().mockResolvedValue({ error: null });

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) return { select: countSelect };
          return { insert: insertFn };
        }
        if (table === "board_columns") return { insert: colInsert };
        if (table === "board_tasks") return { insert: taskInsert };
        return chain;
      });

      await createSampleIdea();

      const insertedTasks = taskInsert.mock.calls[0][0] as Array<{
        position: number;
        idea_id: string;
      }>;
      expect(insertedTasks).toHaveLength(SAMPLE_IDEA_CONTENT.tasks.length);
      for (let i = 0; i < insertedTasks.length; i++) {
        expect(insertedTasks[i].position).toBe((i + 1) * POSITION_GAP);
        expect(insertedTasks[i].idea_id).toBe("sample-idea-id");
      }
    });

    it("task titles and descriptions match SAMPLE_IDEA_CONTENT", async () => {
      const { createSampleIdea } = await import("./onboarding");

      const countEq = vi.fn().mockResolvedValue({ count: 0, error: null });
      const countSelect = vi.fn(() => ({ eq: countEq }));

      const insertSelectSingle = vi.fn().mockResolvedValue({
        data: { id: "sample-idea-id" },
        error: null,
      });
      const insertSelect = vi.fn(() => ({ single: insertSelectSingle }));
      const insertFn = vi.fn(() => ({ select: insertSelect }));

      const colOrderFn = vi.fn().mockResolvedValue({
        data: [
          { id: "col-0", position: 0 },
          { id: "col-1", position: 1000 },
          { id: "col-2", position: 2000 },
          { id: "col-3", position: 3000 },
          { id: "col-4", position: 4000 },
          { id: "col-5", position: 5000 },
        ],
        error: null,
      });
      const colSelect = vi.fn(() => ({ order: colOrderFn }));
      const colInsert = vi.fn(() => ({ select: colSelect }));

      const taskInsert = vi.fn().mockResolvedValue({ error: null });

      let fromCallCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === "ideas") {
          fromCallCount++;
          if (fromCallCount === 1) return { select: countSelect };
          return { insert: insertFn };
        }
        if (table === "board_columns") return { insert: colInsert };
        if (table === "board_tasks") return { insert: taskInsert };
        return chain;
      });

      await createSampleIdea();

      const insertedTasks = taskInsert.mock.calls[0][0] as Array<{
        title: string;
        description: string;
      }>;
      for (let i = 0; i < SAMPLE_IDEA_CONTENT.tasks.length; i++) {
        expect(insertedTasks[i].title).toBe(SAMPLE_IDEA_CONTENT.tasks[i].title);
        expect(insertedTasks[i].description).toBe(
          SAMPLE_IDEA_CONTENT.tasks[i].description
        );
      }
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
});
