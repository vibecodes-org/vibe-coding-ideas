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

  // Card 6b2cb8ac: the relay ends a session at once when the bridge closes on
  // purpose (code 1000) and tells the app with reason "bridge_ended". This
  // route must accept it BEFORE the relay ships, or the callback 400s and the
  // row stays "active".
  it("accepts reason bridge_ended and ends the row", async () => {
    const chain = makeChain({ data: { id: "row-1" }, error: null });
    mockFrom.mockReturnValue(chain);
    const res = await POST(req({ sid: "sid-1", reason: "bridge_ended" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });
  });

  // Card 4cd8270f: the relay adds how the agent ended ("signal 9" / "code 1").
  it("saves detail on the ended row as a second write, after the end itself", async () => {
    const endChain = makeChain({ data: { id: "row-1" }, error: null });
    const detailChain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValueOnce(endChain).mockReturnValueOnce(detailChain);
    const { logger } = await import("@/lib/logger");

    const res = await POST(req({ sid: "sid-1", reason: "bridge_ended", detail: "signal 9" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });

    // The end write is unchanged (never depends on the new column).
    const endUpdate = endChain.__calls.find((c: { method: string }) => c.method === "update");
    expect(endUpdate.args[0]).not.toHaveProperty("end_detail");
    const detailUpdate = detailChain.__calls.find((c: { method: string }) => c.method === "update");
    expect(detailUpdate.args[0]).toEqual({ end_detail: "signal 9" });
    expect(detailChain.__calls).toContainEqual({ method: "eq", args: ["id", "row-1"] });
    expect(logger.info).toHaveBeenCalledWith(
      "Terminal session closed callback: registry updated in real time",
      expect.objectContaining({ sid: "sid-1", reason: "bridge_ended", detail: "signal 9" }),
    );
  });

  it("no detail → no second write", async () => {
    const chain = makeChain({ data: { id: "row-1" }, error: null });
    mockFrom.mockReturnValue(chain);
    const res = await POST(req({ sid: "sid-1", reason: "bridge_ended" }));
    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("still succeeds when saving detail fails (e.g. the column isn't live yet) — logs a warning", async () => {
    const endChain = makeChain({ data: { id: "row-1" }, error: null });
    const detailChain = makeChain({ data: null, error: { message: 'column "end_detail" does not exist' } });
    mockFrom.mockReturnValueOnce(endChain).mockReturnValueOnce(detailChain);
    const { logger } = await import("@/lib/logger");

    const res = await POST(req({ sid: "sid-1", reason: "bridge_ended", detail: "code 1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: true });
    expect(logger.warn).toHaveBeenCalled();
  });

  it.each(["signal SIGKILL", "code 1234", "/Users/x", "a".repeat(40), "", 9])(
    "a detail outside the short shape (%j) is dropped, and the row still ends",
    async (detail) => {
      const chain = makeChain({ data: { id: "row-1" }, error: null });
      mockFrom.mockReturnValue(chain);
      const res = await POST(req({ sid: "sid-1", reason: "bridge_ended", detail }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: true });
      expect(mockFrom).toHaveBeenCalledTimes(1);
    },
  );

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
