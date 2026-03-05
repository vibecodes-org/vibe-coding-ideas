import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFrom, mockCreateClient } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockCreateClient = vi.fn(() => ({ from: mockFrom }));
  return { mockFrom, mockCreateClient };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

// Helper to build a chainable Supabase query mock
function mockQuery(data: unknown[] | null, error: { message: string } | null = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  };
}

// BASE_URL is captured at module evaluation time from process.env.NEXT_PUBLIC_APP_URL.
// In tests, env is not set before module load, so it falls back to "https://vibecodes.co.uk".
const BASE = "https://vibecodes.co.uk";

describe("sitemap", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fake.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fake-anon-key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFrom.mockReset();
    mockCreateClient.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exports revalidate of 3600 seconds", async () => {
    const { revalidate } = await import("./sitemap");
    expect(revalidate).toBe(3600);
  });

  it("includes all static pages with correct priorities", async () => {
    mockFrom.mockImplementation(() => mockQuery([]));

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    const urls = result.map((entry) => entry.url);
    expect(urls).toContain(BASE);
    expect(urls).toContain(`${BASE}/guide`);
    expect(urls).toContain(`${BASE}/guide/getting-started`);
    expect(urls).toContain(`${BASE}/guide/ideas-and-voting`);
    expect(urls).toContain(`${BASE}/guide/collaboration`);
    expect(urls).toContain(`${BASE}/guide/kanban-boards`);
    expect(urls).toContain(`${BASE}/guide/ai-agent-teams`);
    expect(urls).toContain(`${BASE}/guide/mcp-integration`);
    expect(urls).toContain(`${BASE}/guide/admin`);
    expect(urls).toContain(`${BASE}/terms`);
    expect(urls).toContain(`${BASE}/privacy`);

    // Home page should have highest priority
    const homeEntry = result.find((e) => e.url === BASE);
    expect(homeEntry!.priority).toBe(1.0);
    expect(homeEntry!.changeFrequency).toBe("weekly");
  });

  it("does not include /login or /signup in static pages", async () => {
    mockFrom.mockImplementation(() => mockQuery([]));

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();
    const urls = result.map((entry) => entry.url);

    expect(urls).not.toContain(`${BASE}/login`);
    expect(urls).not.toContain(`${BASE}/signup`);
  });

  it("adds public ideas to sitemap with correct format", async () => {
    const ideas = [
      { id: "idea-1", updated_at: "2026-01-15T10:00:00Z", author_id: "user-1" },
      { id: "idea-2", updated_at: null, author_id: "user-2" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "ideas") return mockQuery(ideas);
      return mockQuery([]);
    });

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    const ideaEntry = result.find((e) => e.url === `${BASE}/ideas/idea-1`);
    expect(ideaEntry).toBeDefined();
    expect(ideaEntry!.changeFrequency).toBe("weekly");
    expect(ideaEntry!.priority).toBe(0.7);
    expect(ideaEntry!.lastModified).toEqual(new Date("2026-01-15T10:00:00Z"));

    // Null updated_at should produce undefined lastModified
    const ideaEntry2 = result.find((e) => e.url === `${BASE}/ideas/idea-2`);
    expect(ideaEntry2).toBeDefined();
    expect(ideaEntry2!.lastModified).toBeUndefined();
  });

  it("only includes users who have authored a public idea", async () => {
    const ideas = [
      { id: "idea-1", updated_at: "2026-01-15T10:00:00Z", author_id: "author-user" },
    ];
    const users = [
      { id: "author-user", updated_at: "2026-01-10T10:00:00Z" },
      { id: "lurker-user", updated_at: "2026-01-10T10:00:00Z" },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === "ideas") return mockQuery(ideas);
      if (table === "users") return mockQuery(users);
      return mockQuery([]);
    });

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();
    const urls = result.map((e) => e.url);

    expect(urls).toContain(`${BASE}/profile/author-user`);
    expect(urls).not.toContain(`${BASE}/profile/lurker-user`);
  });

  it("sets correct format for profile entries", async () => {
    const ideas = [{ id: "idea-1", updated_at: "2026-01-15T10:00:00Z", author_id: "user-1" }];
    const users = [{ id: "user-1", updated_at: "2026-02-01T12:00:00Z" }];

    mockFrom.mockImplementation((table: string) => {
      if (table === "ideas") return mockQuery(ideas);
      if (table === "users") return mockQuery(users);
      return mockQuery([]);
    });

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();
    const profileEntry = result.find((e) => e.url === `${BASE}/profile/user-1`);

    expect(profileEntry).toBeDefined();
    expect(profileEntry!.changeFrequency).toBe("monthly");
    expect(profileEntry!.priority).toBe(0.5);
    expect(profileEntry!.lastModified).toEqual(new Date("2026-02-01T12:00:00Z"));
  });

  it("gracefully handles ideas query failure and logs error", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "ideas") return mockQuery(null, { message: "connection refused" });
      if (table === "users") return mockQuery([{ id: "user-1", updated_at: null }]);
      return mockQuery([]);
    });

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    expect(console.error).toHaveBeenCalledWith("[sitemap] ideas query failed:", "connection refused");
    // Should still return static pages
    expect(result.length).toBeGreaterThan(0);
    // No idea entries
    expect(result.some((e) => e.url.includes("/ideas/"))).toBe(false);
    // No profile entries (no public ideas → no authors to include)
    expect(result.some((e) => e.url.includes("/profile/"))).toBe(false);
  });

  it("gracefully handles users query failure and logs error", async () => {
    const ideas = [{ id: "idea-1", updated_at: null, author_id: "user-1" }];

    mockFrom.mockImplementation((table: string) => {
      if (table === "ideas") return mockQuery(ideas);
      if (table === "users") return mockQuery(null, { message: "timeout" });
      return mockQuery([]);
    });

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    expect(console.error).toHaveBeenCalledWith("[sitemap] users query failed:", "timeout");
    // Ideas should still appear
    expect(result.some((e) => e.url.includes("/ideas/idea-1"))).toBe(true);
    // No profile entries since users query failed
    expect(result.some((e) => e.url.includes("/profile/"))).toBe(false);
  });

  it("creates Supabase client with correct env vars", async () => {
    mockFrom.mockImplementation(() => mockQuery([]));

    const { default: sitemap } = await import("./sitemap");
    await sitemap();

    expect(mockCreateClient).toHaveBeenCalledWith(
      "https://fake.supabase.co",
      "fake-anon-key",
    );
  });

  it("does not include lastModified on static pages", async () => {
    mockFrom.mockImplementation(() => mockQuery([]));

    const { default: sitemap } = await import("./sitemap");
    const result = await sitemap();

    // Static pages should not have lastModified (no new Date() fallback)
    const staticEntries = result.filter((e) => !e.url.includes("/ideas/") && !e.url.includes("/profile/"));
    for (const entry of staticEntries) {
      expect(entry.lastModified).toBeUndefined();
    }
  });
});
