// Terminal helper TOKEN mint (Codex support, docs/codex-terminal-requirements.md
// FR-11) — mints ONLY a helper-role token, no session row, no bridge/browser
// tokens. Mirrors the auth-mocking style of session/end/route.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetUser, mockMintHelperToken } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockMintHelperToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  mintHelperToken: (...args: unknown[]) => mockMintHelperToken(...args),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mockMintHelperToken.mockResolvedValue("helper-tok");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/terminal/helper/token", () => {
  it("mints a helper token for the authenticated user", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ helperToken: "helper-tok" });
    expect(mockMintHelperToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "user-1", secret: "test-secret" }),
    );
  });

  it("401s when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockMintHelperToken).not.toHaveBeenCalled();
  });

  it("503s when TERMINAL_SESSION_SECRET is not configured", async () => {
    vi.stubEnv("TERMINAL_SESSION_SECRET", "");
    const res = await POST();
    expect(res.status).toBe(503);
    expect(mockMintHelperToken).not.toHaveBeenCalled();
  });

  it("500s and does not leak internals when minting throws", async () => {
    mockMintHelperToken.mockRejectedValue(new Error("boom"));
    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("boom");
  });
});
