import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  GithubApiError,
  buildAuthorizeUrl,
  createOwnRepo,
  exchangeCodeForToken,
  getAuthedUser,
  getRepo,
  listOwnRepos,
  parseRepoUrl,
  revokeGrant,
  safeReturnTo,
  toRepoName,
} from "./github";

describe("toRepoName", () => {
  it("lowercases and replaces spaces", () => {
    expect(toRepoName("My Cool Repo")).toBe("my-cool-repo");
  });

  it("collapses repeated separators", () => {
    expect(toRepoName("hello   world!!!  again")).toBe("hello-world-again");
  });

  it("strips leading and trailing dashes / dots", () => {
    expect(toRepoName("---hello---")).toBe("hello");
    expect(toRepoName("...foo...")).toBe("foo");
  });

  it("caps at 100 characters", () => {
    const long = "a".repeat(150);
    expect(toRepoName(long)).toHaveLength(100);
  });

  it("preserves dots, dashes and underscores", () => {
    expect(toRepoName("hello.world_repo-name")).toBe("hello.world_repo-name");
  });

  it("returns empty string for input with no valid chars", () => {
    expect(toRepoName("!!!!")).toBe("");
    expect(toRepoName("    ")).toBe("");
  });

  it("handles emoji and unicode by stripping", () => {
    expect(toRepoName("Balla Bot 🤖")).toBe("balla-bot");
  });
});

describe("parseRepoUrl", () => {
  it("accepts a clean github URL", () => {
    expect(parseRepoUrl("https://github.com/foo/bar")).toBe("https://github.com/foo/bar");
  });

  it("strips trailing slash and .git", () => {
    expect(parseRepoUrl("https://github.com/foo/bar/")).toBe("https://github.com/foo/bar");
    expect(parseRepoUrl("https://github.com/foo/bar.git")).toBe("https://github.com/foo/bar");
  });

  it("trims surrounding whitespace", () => {
    expect(parseRepoUrl("  https://github.com/foo/bar  ")).toBe("https://github.com/foo/bar");
  });

  it("rejects non-github hosts", () => {
    expect(parseRepoUrl("https://gitlab.com/foo/bar")).toBeNull();
    expect(parseRepoUrl("https://example.com/foo/bar")).toBeNull();
  });

  it("rejects URLs missing repo segment", () => {
    expect(parseRepoUrl("https://github.com/foo")).toBeNull();
    expect(parseRepoUrl("https://github.com/")).toBeNull();
  });

  it("rejects http (not https)", () => {
    expect(parseRepoUrl("http://github.com/foo/bar")).toBeNull();
  });

  it("rejects deeper paths like /foo/bar/tree/main", () => {
    expect(parseRepoUrl("https://github.com/foo/bar/tree/main")).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it("accepts a same-origin path", () => {
    expect(safeReturnTo("/ideas/123")).toBe("/ideas/123");
  });

  it("falls back when input is empty or null", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });

  it("rejects absolute URLs (open redirect)", () => {
    expect(safeReturnTo("https://evil.com/steal")).toBe("/");
    expect(safeReturnTo("http://evil.com")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeReturnTo("//evil.com/steal")).toBe("/");
  });

  it("rejects javascript: and data: schemes", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
    expect(safeReturnTo("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("rejects backslash-prefixed paths", () => {
    expect(safeReturnTo("\\\\evil.com")).toBe("/");
  });

  it("uses custom fallback when provided", () => {
    expect(safeReturnTo(null, "/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("https://evil.com", "/dashboard")).toBe("/dashboard");
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a github.com OAuth URL with the right params", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc123",
      redirectUri: "https://example.com/api/github/callback",
      state: "state-token",
    });
    expect(url).toContain("https://github.com/login/oauth/authorize?");
    expect(url).toContain("client_id=abc123");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fgithub%2Fcallback");
    expect(url).toContain("state=state-token");
    expect(url).toContain("scope=repo+read%3Auser");
    expect(url).toContain("allow_signup=true");
  });

  it("supports custom scopes", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc",
      redirectUri: "https://x.test/cb",
      state: "s",
      scopes: ["read:org"],
    });
    expect(url).toContain("scope=read%3Aorg");
  });
});

// fetch-mocking helper that records the last call so we can assert headers/body
function mockFetchOnce(response: { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const status = response.status ?? 200;
  const bodyText = response.body !== undefined ? JSON.stringify(response.body) : "";
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    headers: { get: (k: string) => string | null };
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }>>(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => response.headers?.[key.toLowerCase()] ?? null },
    text: async () => bodyText,
    json: async () => (bodyText ? JSON.parse(bodyText) : null),
  }));
  // @ts-expect-error overriding global for the test
  global.fetch = fetchMock;
  return fetchMock;
}

describe("exchangeCodeForToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the token + scope on success", async () => {
    const fetchMock = mockFetchOnce({ body: { access_token: "gho_xxx", scope: "repo,read:user" } });
    const out = await exchangeCodeForToken("the-code", "cid", "csec");
    expect(out).toEqual({ access_token: "gho_xxx", scope: "repo,read:user" });
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://github.com/login/oauth/access_token");
  });

  it("throws GithubApiError when github returns an error payload", async () => {
    mockFetchOnce({ body: { error: "bad_verification_code", error_description: "Code expired" } });
    await expect(exchangeCodeForToken("c", "id", "sec")).rejects.toBeInstanceOf(GithubApiError);
  });

  it("throws GithubApiError on non-2xx HTTP", async () => {
    mockFetchOnce({ status: 502, body: { message: "Bad gateway" } });
    await expect(exchangeCodeForToken("c", "id", "sec")).rejects.toBeInstanceOf(GithubApiError);
  });
});

describe("getAuthedUser", () => {
  it("returns the parsed user", async () => {
    mockFetchOnce({ body: { id: 42, login: "nick", avatar_url: "https://a.test/n.png" } });
    const user = await getAuthedUser("token");
    expect(user.login).toBe("nick");
    expect(user.id).toBe(42);
  });

  it("throws on 401 with status preserved", async () => {
    mockFetchOnce({ status: 401, body: { message: "Bad credentials" } });
    try {
      await getAuthedUser("token");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GithubApiError);
      expect((e as GithubApiError).status).toBe(401);
    }
  });
});

describe("listOwnRepos", () => {
  it("requests page 1 with per_page=100 by default", async () => {
    const fetchMock = mockFetchOnce({ body: [] });
    await listOwnRepos("tok");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/user/repos");
    expect(url).toContain("affiliation=owner");
    expect(url).toContain("per_page=100");
    expect(url).toContain("page=1");
    expect(url).toContain("sort=pushed");
  });

  it("paginates when page > 1", async () => {
    const fetchMock = mockFetchOnce({ body: [] });
    await listOwnRepos("tok", { page: 3 });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("page=3");
  });

  it("propagates rate-limit reset on 403", async () => {
    mockFetchOnce({
      status: 403,
      body: { message: "API rate limit exceeded" },
      headers: { "x-ratelimit-reset": "1700000000" },
    });
    try {
      await listOwnRepos("tok");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GithubApiError);
      expect((e as GithubApiError).status).toBe(403);
      expect((e as GithubApiError).rateLimitResetAt).toBe(1700000000 * 1000);
    }
  });
});

describe("createOwnRepo", () => {
  it("POSTs the expected body and returns the created repo", async () => {
    const fetchMock = mockFetchOnce({
      status: 201,
      body: {
        id: 1,
        name: "ballabot",
        full_name: "nick/ballabot",
        html_url: "https://github.com/nick/ballabot",
        private: true,
      },
    });
    const repo = await createOwnRepo("tok", {
      name: "ballabot",
      description: "Bot",
      isPrivate: true,
      autoInit: false,
    });
    expect(repo.full_name).toBe("nick/ballabot");
    const call = fetchMock.mock.calls[0]?.[1] as { body: string };
    const body = JSON.parse(call.body);
    expect(body).toEqual({ name: "ballabot", description: "Bot", private: true, auto_init: false });
  });

  it("throws GithubApiError(422) on name conflict", async () => {
    mockFetchOnce({ status: 422, body: { message: "Repository creation failed." } });
    try {
      await createOwnRepo("tok", { name: "dup", isPrivate: false, autoInit: false });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GithubApiError);
      expect((e as GithubApiError).status).toBe(422);
    }
  });
});

describe("getRepo", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /repos/{owner}/{repo} with the user's token and returns the repo", async () => {
    const fetchMock = mockFetchOnce({
      body: {
        id: 1,
        name: "next.js",
        full_name: "vercel/next.js",
        html_url: "https://github.com/vercel/next.js",
        private: false,
        description: null,
        pushed_at: "2024-01-01T00:00:00Z",
        language: "JavaScript",
        owner: { login: "vercel", avatar_url: "https://a.test/v.png" },
      },
    });
    const repo = await getRepo("tok", "vercel", "next.js");
    expect(repo.full_name).toBe("vercel/next.js");
    expect(repo.private).toBe(false);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.github.com/repos/vercel/next.js");
    const init = call?.[1] as { headers: Record<string, string>; signal?: AbortSignal };
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("URL-encodes owner/repo segments", async () => {
    const fetchMock = mockFetchOnce({ body: { id: 1, owner: { login: "a", avatar_url: "" } } });
    await getRepo("tok", "weird owner", "repo name");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://api.github.com/repos/weird%20owner/repo%20name");
  });

  it("throws GithubApiError(404) when the repo doesn't exist or isn't visible to this token", async () => {
    mockFetchOnce({ status: 404, body: { message: "Not Found" } });
    try {
      await getRepo("tok", "acme", "internal-tool");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GithubApiError);
      expect((e as GithubApiError).status).toBe(404);
    }
  });

  it("throws GithubApiError(403) with rate-limit reset on rate-limiting", async () => {
    mockFetchOnce({
      status: 403,
      body: { message: "API rate limit exceeded" },
      headers: { "x-ratelimit-reset": "1700000000" },
    });
    try {
      await getRepo("tok", "vercel", "next.js");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GithubApiError);
      expect((e as GithubApiError).status).toBe(403);
      expect((e as GithubApiError).rateLimitResetAt).toBe(1700000000 * 1000);
    }
  });

  it("propagates a non-GithubApiError (e.g. abort/timeout) rather than swallowing it", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      // Simulate the runtime aborting the request when the timeout signal fires.
      if (init?.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      throw new DOMException("The operation was aborted", "AbortError");
    });
    // @ts-expect-error overriding global for the test
    global.fetch = fetchMock;
    await expect(getRepo("tok", "vercel", "next.js", { timeoutMs: 1 })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("revokeGrant", () => {
  it("calls the grant DELETE endpoint with Basic auth", async () => {
    const fetchMock = mockFetchOnce({ status: 204 });
    await revokeGrant("token", "client", "secret");
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toContain("/applications/client/grant");
    const headers = (call?.[1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toMatch(/^Basic /);
  });
});
