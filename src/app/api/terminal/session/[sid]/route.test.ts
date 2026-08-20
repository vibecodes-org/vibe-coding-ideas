// Terminal session PATCH — coverage for the rename extension (card 3bf262ac):
// the headline fix is that a rename must land on an ENDED row (Requirements
// §2's PATCH-gap finding — the OLD route filtered every write, including a
// future `displayName`, to `.eq("status", "active")`), while the bridge-fed
// identity fields (`cwd`/`machineLabel`/`claudeSessionId`) keep their
// pre-existing active-only, set-never-clear behaviour untouched. Also covers
// the clear-to-null semantics and the server-side code-point clamp.
//
// The route's PRE-EXISTING identity-field behaviour (sanitization,
// active-only filter, "nothing valid survived → silent ok:true") is
// exercised here only as a regression guard — it shipped before this card
// and was untested; these are not new requirements.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(),
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

import { PATCH } from "./route";
import { logger } from "@/lib/logger";

// One chain per `.from("terminal_sessions")` call, recording every
// `update`/`eq` invocation so a test can assert exactly what each of the
// (up to two) separate update calls looked like — the route issues TWO
// independent `.update()` chains when a request carries both an identity
// field and `displayName`, since they have different `status` filtering.
function makeChain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = { __calls: calls };
  for (const method of ["update", "eq"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function req(body: unknown) {
  return new Request("http://localhost/api/terminal/session/sid-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(sid = "sid-1") {
  return { params: Promise.resolve({ sid }) };
}

beforeEach(() => {
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/terminal/session/[sid] — auth and validation", () => {
  it("401s when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PATCH(req({ displayName: "Auth spike" }), params());
    expect(res.status).toBe(401);
  });

  it("400s when the body has none of the four recognized fields", async () => {
    const res = await PATCH(req({ somethingElse: 1 }), params());
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/terminal/session/[sid] — rename (card 3bf262ac)", () => {
  it("renames an ACTIVE session, storing the trimmed name with NO status filter on the write", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    const res = await PATCH(req({ displayName: "  Auth spike  " }), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, displayName: "Auth spike" });

    expect(mockFrom).toHaveBeenCalledWith("terminal_sessions");
    const chain = mockFrom.mock.results[0]!.value;
    const updateCall = chain.__calls.find((c: { method: string }) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ display_name: "Auth spike" });
    const eqCalls = chain.__calls.filter((c: { method: string }) => c.method === "eq");
    expect(eqCalls.map((c: { args: unknown[] }) => c.args)).toEqual([
      ["sid", "sid-1"],
      ["user_id", "user-1"],
    ]);
    // The headline invariant: unlike the identity fields, this write carries
    // NO `.eq("status", "active")` — renaming must work on ended rows too.
    expect(eqCalls.some((c: { args: unknown[] }) => c.args[0] === "status")).toBe(false);
  });

  it("renames an ENDED session — the Requirements §2 PATCH-gap fix; the write is identical whether the row is active or ended (no status read happens here at all)", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    const res = await PATCH(req({ displayName: "Stripe webhook spike" }), params());
    expect(res.status).toBe(200);
    // Same assertion as the "active" case above — proving there is no
    // status-gating logic at all on this write path, so it can never
    // regress into silently no-op'ing on an ended row again.
    const chain = mockFrom.mock.results[0]!.value;
    const eqCalls = chain.__calls.filter((c: { method: string }) => c.method === "eq");
    expect(eqCalls.some((c: { args: unknown[] }) => c.args[0] === "status")).toBe(false);
  });

  it("clears the name to NULL — never an empty string — when the field is blank/whitespace", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    const res = await PATCH(req({ displayName: "   " }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, displayName: null });
    const chain = mockFrom.mock.results[0]!.value;
    const updateCall = chain.__calls.find((c: { method: string }) => c.method === "update");
    expect(updateCall.args[0]).toEqual({ display_name: null });
  });

  it("clears the name to NULL when the field is an empty string", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    const res = await PATCH(req({ displayName: "" }), params());
    const body = await res.json();
    expect(body).toEqual({ ok: true, displayName: null });
  });

  it("clamps an over-limit name to 100 CODE POINTS server-side, matching the client's own clamp — never UTF-16 units", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    const emoji150 = "🚀".repeat(150); // 150 code points, 300 UTF-16 units
    const res = await PATCH(req({ displayName: emoji150 }), params());
    const body = await res.json();
    expect([...(body.displayName as string)]).toHaveLength(100);
    expect(body.displayName).toBe("🚀".repeat(100));
  });

  it("returns 500 and logs when the rename write itself fails", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: { message: "connection reset" } }));
    const res = await PATCH(req({ displayName: "Auth spike" }), params());
    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      "Terminal session rename PATCH failed",
      expect.objectContaining({ sid: "sid-1", error: "connection reset" }),
    );
  });
});

describe("PATCH /api/terminal/session/[sid] — bridge-fed identity fields (regression guard, pre-existing behaviour)", () => {
  it("writes cwd/machineLabel/claudeSessionId with the active-only filter, UNCHANGED by this card", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    const res = await PATCH(
      req({
        cwd: "~/projects/vibecodes",
        machineLabel: "Nick's MacBook",
        claudeSessionId: "99999999-8888-7777-6666-555555555555",
      }),
      params(),
    );
    expect(res.status).toBe(200);
    const chain = mockFrom.mock.results[0]!.value;
    const updateCall = chain.__calls.find((c: { method: string }) => c.method === "update");
    expect(updateCall.args[0]).toEqual({
      cwd: "~/projects/vibecodes",
      machine_label: "Nick's MacBook",
      claude_session_id: "99999999-8888-7777-6666-555555555555",
    });
    const eqCalls = chain.__calls.filter((c: { method: string }) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["status", "active"] });
  });

  it("issues TWO separate update calls when a request carries both an identity field and displayName — the identity write stays active-only, the rename write does not", async () => {
    mockFrom.mockImplementation(() => makeChain({ data: null, error: null }));
    const res = await PATCH(req({ cwd: "~/projects/vibecodes", displayName: "Auth spike" }), params());
    expect(res.status).toBe(200);
    expect(mockFrom).toHaveBeenCalledTimes(2);

    const identityChain = mockFrom.mock.results[0]!.value;
    const identityEqs = identityChain.__calls.filter((c: { method: string }) => c.method === "eq");
    expect(identityEqs).toContainEqual({ method: "eq", args: ["status", "active"] });

    const renameChain = mockFrom.mock.results[1]!.value;
    const renameEqs = renameChain.__calls.filter((c: { method: string }) => c.method === "eq");
    expect(renameEqs.some((c: { args: unknown[] }) => c.args[0] === "status")).toBe(false);
  });

  it("a no-op request (identity field passes the body schema but fails sanitization, no displayName) returns ok:true without writing anything", async () => {
    // "not-a-uuid" passes the schema's `.trim().min(1).max(64)` but fails
    // sanitizeConversationId's strict UUID check — the realistic case the
    // route's "nothing valid survived sanitization" comment describes.
    const res = await PATCH(req({ claudeSessionId: "not-a-uuid" }), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
