// Terminal session CLOSED — server-to-server callback from the relay. This
// route had NO test file at all before this backfill (a pre-existing gap in
// this area of the codebase, predating the E2EE feature). Terminal P2
// (E2EE): the registry update the route issues when the relay confirms a
// session is gone must clear `e2ee_session_key` alongside `status` and
// `ended_at` — the registry TTL is only a backstop, not the primary clear.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFrom, mockAuthorizeNotify } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAuthorizeNotify: vi.fn(),
}));

function makeChain(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { __calls: calls };
  for (const m of ["update", "eq", "select", "maybeSingle"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  authorizeNotify: (...args: unknown[]) => mockAuthorizeNotify(...args),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/closed", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer notify-tok" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  mockAuthorizeNotify.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session/closed", () => {
  it("clears e2ee_session_key (alongside status/ended_at) when the relay confirms closure — happy path", async () => {
    const chain = makeChain({ data: { id: "row-1" }, error: null });
    mockFrom.mockReturnValue(chain);

    const res = await POST(req({ sid: "sid-1", reason: "idle_timeout" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });

    const updateCall = chain.__calls.find((c: { method: string }) => c.method === "update");
    expect(updateCall.args[0]).toMatchObject({
      status: "ended",
      e2ee_session_key: null,
    });
    expect(updateCall.args[0]).toHaveProperty("ended_at");
    const eqCalls = chain.__calls.filter((c: { method: string }) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["sid", "sid-1"] });
    expect(eqCalls).toContainEqual({ method: "eq", args: ["status", "active"] });
  });

  it("honest no-op when the row is already ended (concurrency guard) — no error, updated:false", async () => {
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const res = await POST(req({ sid: "sid-1", reason: "peer_gone" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: false });
  });

  it("401s when the notify token is rejected", async () => {
    mockAuthorizeNotify.mockResolvedValue({ ok: false, reason: "expired" });
    const res = await POST(req({ sid: "sid-1" }));
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("400s on a malformed body", async () => {
    const res = await POST(req({ sid: "" }));
    expect(res.status).toBe(400);
  });

  it("503s when TERMINAL_SESSION_SECRET is unset", async () => {
    vi.stubEnv("TERMINAL_SESSION_SECRET", "");
    const res = await POST(req({ sid: "sid-1" }));
    expect(res.status).toBe(503);
  });
});
