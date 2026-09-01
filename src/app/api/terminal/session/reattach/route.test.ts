// Terminal P2 (E2EE) — the reattach route now hands the session's key back
// too, so any of the owner's authenticated tabs/devices (not just the one
// that minted the session) can decrypt a live session. Covers only that new
// behaviour; the route's pre-existing auth/ownership/decideReattach logic is
// exercised indirectly (decideReattach itself is unit-tested elsewhere).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { NOW_ISO, SID, mockFrom, mockGetUser } = vi.hoisted(() => ({
  NOW_ISO: "2026-08-19T12:00:00.000Z",
  SID: "sid-1",
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(),
}));

function makeChain(result: { data?: unknown; error?: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const methods = ["select", "eq", "maybeSingle"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/terminal/session-reap", () => ({
  reapExpiredSessions: vi.fn().mockResolvedValue({ activeBefore: 0, reapedIds: [] }),
}));

vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  mintSessionTokens: vi.fn().mockResolvedValue({
    sid: SID,
    idea: "idea-1",
    exp: Date.parse(NOW_ISO) + 60_000,
    browser: "browser-tok",
    bridge: "bridge-tok",
  }),
  mintHelperToken: vi.fn().mockResolvedValue("helper-tok"),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/reattach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  vi.setSystemTime(new Date(NOW_ISO));
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session/reattach", () => {
  it("returns the registry's e2ee_session_key alongside the fresh tokens — happy path", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          sid: SID,
          idea_id: "idea-1",
          status: "active",
          expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
          cwd: "/repo",
          claude_session_id: null,
          display_name: null,
          e2ee_session_key: "a-base64-key",
        },
        error: null,
      }),
    );

    const res = await POST(req({ sid: SID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionKey).toBe("a-base64-key");
    expect(body.browserToken).toBe("browser-tok");
  });

  it("returns null sessionKey for a session that predates the feature (no key ever stored)", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          sid: SID,
          idea_id: "idea-1",
          status: "active",
          expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
          cwd: "/repo",
          claude_session_id: null,
          display_name: null,
          e2ee_session_key: null,
        },
        error: null,
      }),
    );

    const res = await POST(req({ sid: SID }));
    const body = await res.json();
    expect(body.sessionKey).toBeNull();
  });

  it("error path: a session already ended is refused before any key is ever considered", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          sid: SID,
          idea_id: "idea-1",
          status: "ended",
          expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
          cwd: "/repo",
          claude_session_id: null,
          display_name: null,
          e2ee_session_key: "a-base64-key",
        },
        error: null,
      }),
    );

    const res = await POST(req({ sid: SID }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("reattach_ended");
    expect(body.sessionKey).toBeUndefined();
  });
});
