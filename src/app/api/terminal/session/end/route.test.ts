// Terminal session END — this route had NO test file at all before this
// backfill (a pre-existing gap in this area of the codebase, predating the
// E2EE feature). Terminal P2 (E2EE): the registry update the route issues
// when a session ends must clear `e2ee_session_key` alongside `status` and
// `ended_at` — the registry TTL is only a backstop, not the primary clear.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFrom, mockGetUser, mockMintControlToken } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(),
  mockMintControlToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  mintControlToken: (...args: unknown[]) => mockMintControlToken(...args),
}));

vi.mock("@/lib/terminal/relay-http", () => ({
  relayHttpBaseUrl: () => "http://relay.test",
}));

import { POST } from "./route";

// Two independent chains are exercised on a target: a SELECT (to resolve
// targets) and one UPDATE per target. This factory records every call so a
// test can assert exactly what the update payload looked like.
function makeSelectChain(result: { data?: unknown; error?: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "eq"]) chain[m] = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeUpdateChain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { __calls: calls };
  for (const m of ["update", "eq"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mockMintControlToken.mockResolvedValue("control-tok");
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session/end", () => {
  it("clears e2ee_session_key (alongside status/ended_at) when ending a session — happy path", async () => {
    const updateChain = makeUpdateChain();
    mockFrom
      .mockImplementationOnce(() =>
        makeSelectChain({ data: [{ id: "row-1", sid: "sid-1" }], error: null }),
      )
      .mockImplementationOnce(() => updateChain);

    const res = await POST(req({ sid: "sid-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ sid: "sid-1", ended: true, relayConfirmed: true }]);

    const updateCall = updateChain.__calls.find((c: { method: string }) => c.method === "update");
    expect(updateCall.args[0]).toMatchObject({
      status: "ended",
      e2ee_session_key: null,
    });
    expect(updateCall.args[0]).toHaveProperty("ended_at");
  });

  it("still clears e2ee_session_key when the relay is unreachable (skew-safe registry-only end)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    const updateChain = makeUpdateChain();
    mockFrom
      .mockImplementationOnce(() =>
        makeSelectChain({ data: [{ id: "row-1", sid: "sid-1" }], error: null }),
      )
      .mockImplementationOnce(() => updateChain);

    const res = await POST(req({ sid: "sid-1" }));
    const body = await res.json();
    expect(body.results).toEqual([{ sid: "sid-1", ended: true, relayConfirmed: false }]);

    const updateCall = updateChain.__calls.find((c: { method: string }) => c.method === "update");
    expect(updateCall.args[0]).toMatchObject({ e2ee_session_key: null });
  });

  it("401s when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req({ sid: "sid-1" }));
    expect(res.status).toBe(401);
  });

  it("returns an empty results list (no-op) when there are no active targets", async () => {
    mockFrom.mockImplementationOnce(() => makeSelectChain({ data: [], error: null }));
    const res = await POST(req({ sid: "sid-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });
});
