import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase client — all chain methods return `chain` by default,
// individual tests override terminal methods (single, gte) as needed.
const mockSingle = vi.fn();
const mockGte = vi.fn();
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
