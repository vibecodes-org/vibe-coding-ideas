// Terminal P2 (E2EE) — the bridge's off-relay key-delivery route.
//
// Covers the reworked, REPEATABLE delivery semantics (the previously-rejected
// design cleared the key after one read; the approved design never clears it
// here — see route.ts's module doc): a relaunched bridge for the same sid
// must be able to fetch the SAME key again, gated only on the row being
// active/unexpired, never on "already read once".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW_ISO = "2026-08-19T12:00:00.000Z";
const SID = "sid-1";

const { mockFrom, mockAuthorizeAttach } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockAuthorizeAttach: vi.fn(),
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

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockFrom(...args) }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  authorizeAttach: (...args: unknown[]) => mockAuthorizeAttach(...args),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.setSystemTime(new Date(NOW_ISO));
  mockAuthorizeAttach.mockResolvedValue({ ok: true, sub: "user-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session/key", () => {
  it("delivers the key for an active, unexpired session — happy path", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          e2ee_session_key: "a-base64-key",
          status: "active",
          expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
        },
        error: null,
      }),
    );

    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ delivered: true, sessionKey: "a-base64-key" });
  });

  it("REPEATABLE delivery: never clears the key — a second fetch for the same sid gets the SAME key back", async () => {
    const row = {
      e2ee_session_key: "a-base64-key",
      status: "active",
      expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
    };
    // A fresh chain per call, mirroring a real DB read never mutating the
    // underlying row — exactly what "never cleared" means here.
    mockFrom.mockImplementation(() => makeChain({ data: row, error: null }));

    const firstBody = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();
    const secondBody = await (await POST(req({ sid: SID, token: "bridge-tok" }))).json();

    expect(firstBody).toEqual({ delivered: true, sessionKey: "a-base64-key" });
    expect(secondBody).toEqual({ delivered: true, sessionKey: "a-base64-key" });
  });

  it("never issues an update/clear against the registry (read-only route)", async () => {
    const chain = makeChain({
      data: {
        e2ee_session_key: "a-base64-key",
        status: "active",
        expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
      },
      error: null,
    });
    chain.update = vi.fn();
    mockFrom.mockReturnValue(chain);

    await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(chain.update).not.toHaveBeenCalled();
  });

  it("delivered:false for an ENDED session, without treating it as an error", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          e2ee_session_key: "a-base64-key",
          status: "ended",
          expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
        },
        error: null,
      }),
    );

    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: false });
  });

  it("delivered:false for an EXPIRED session (past expires_at, even if still marked active)", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          e2ee_session_key: "a-base64-key",
          status: "active",
          expires_at: new Date(Date.parse(NOW_ISO) - 1_000).toISOString(),
        },
        error: null,
      }),
    );

    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(await res.json()).toEqual({ delivered: false });
  });

  it("delivered:false when the row has no key stored (pre-feature session)", async () => {
    mockFrom.mockReturnValue(
      makeChain({
        data: {
          e2ee_session_key: null,
          status: "active",
          expires_at: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
        },
        error: null,
      }),
    );

    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(await res.json()).toEqual({ delivered: false });
  });

  it("delivered:false when no row exists for the sid", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));

    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(await res.json()).toEqual({ delivered: false });
  });

  it("error path: rejects an invalid/expired bridge token with 401, never reaching the DB", async () => {
    mockAuthorizeAttach.mockResolvedValue({ ok: false, reason: "expired" });
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const res = await POST(req({ sid: SID, token: "bad-tok" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("error path: 503 when TERMINAL_SESSION_SECRET is unset", async () => {
    vi.stubEnv("TERMINAL_SESSION_SECRET", "");
    const res = await POST(req({ sid: SID, token: "bridge-tok" }));
    expect(res.status).toBe(503);
  });

  it("error path: 400 on a malformed body", async () => {
    const res = await POST(req({ sid: "" }));
    expect(res.status).toBe(400);
  });
});
