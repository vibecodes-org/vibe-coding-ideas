import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase client chain
const mockSingle = vi.fn();
const chain: Record<string, unknown> = {};
const mockInsert = vi.fn(() => chain);
const mockSelect = vi.fn(() => chain);
const mockEq = vi.fn(() => chain);
Object.assign(chain, {
  insert: mockInsert,
  select: mockSelect,
  eq: mockEq,
  single: mockSingle,
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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockApplyKit = vi.fn();
vi.mock("./kits", () => ({
  applyKit: (...args: unknown[]) => mockApplyKit(...args),
}));

describe("createIdea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockImplementation(() => chain);
    mockSelect.mockImplementation(() => chain);
    mockFrom.mockImplementation(() => chain);
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
  });

  // Lazy import to ensure mocks are set up first
  async function getCreateIdea() {
    const mod = await import("./ideas");
    return mod.createIdea;
  }

  it("returns ideaId on successful creation without kit", async () => {
    mockSingle.mockResolvedValue({ data: { id: "idea-123" }, error: null });

    const createIdea = await getCreateIdea();
    const result = await createIdea({
      title: "Test Idea",
      description: "A test description for my idea",
      tags: "react,next",
      githubUrl: null,
      visibility: "public",
      kitId: null,
    });

    expect(result).toEqual({ ideaId: "idea-123" });
    expect(mockApplyKit).not.toHaveBeenCalled();
  });

  it("returns ideaId with kitResult when kit is applied", async () => {
    mockSingle.mockResolvedValue({ data: { id: "idea-456" }, error: null });
    mockApplyKit.mockResolvedValue({
      agentsCreated: 3,
      labelsCreated: 5,
      templateImported: true,
    });

    const createIdea = await getCreateIdea();
    const result = await createIdea({
      title: "Kit Idea",
      description: "A test description with kit",
      tags: "",
      githubUrl: null,
      visibility: "public",
      kitId: "kit-1",
    });

    expect(result).toEqual({
      ideaId: "idea-456",
      kitResult: { agentsCreated: 3, labelsCreated: 5, templateImported: true },
    });
    expect(mockApplyKit).toHaveBeenCalledWith("idea-456", "kit-1");
  });

  it("returns kitError: true when kit application fails (does not throw)", async () => {
    mockSingle.mockResolvedValue({ data: { id: "idea-789" }, error: null });
    mockApplyKit.mockRejectedValue(new Error("Kit timeout"));

    const createIdea = await getCreateIdea();
    const result = await createIdea({
      title: "Failing Kit Idea",
      description: "A test description that will fail kit",
      tags: "",
      githubUrl: null,
      visibility: "public",
      kitId: "kit-bad",
    });

    expect(result).toEqual({ ideaId: "idea-789", kitError: true });
    // The form should NOT hang — it returns a result the client can navigate with
  });

  it("throws when idea insert fails", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: "Insert failed" },
    });

    const createIdea = await getCreateIdea();
    await expect(
      createIdea({
        title: "Bad Idea",
        description: "This will fail",
        tags: "",
        githubUrl: null,
        visibility: "public",
        kitId: null,
      })
    ).rejects.toThrow("Insert failed");
  });

  it("redirects to login when user is not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const createIdea = await getCreateIdea();
    await expect(
      createIdea({
        title: "No Auth",
        description: "Should redirect",
        tags: "",
        githubUrl: null,
        visibility: "public",
        kitId: null,
      })
    ).rejects.toThrow("REDIRECT: /login");
  });
});
