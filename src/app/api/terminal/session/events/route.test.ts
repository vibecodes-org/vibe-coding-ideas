// Session record route (card f4be2981, stage 2): who may write events, and
// that each caller's events are filed under the right account and session.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { serviceFrom, userFrom, getUser, authorizeNotify, authorizeAttach } = vi.hoisted(() => ({
  serviceFrom: vi.fn(),
  userFrom: vi.fn(),
  getUser: vi.fn(),
  authorizeNotify: vi.fn(),
  authorizeAttach: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(result: { data?: unknown; error?: unknown }, calls: Array<{ m: string; a: unknown[] }> = []): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = { calls };
  for (const m of ["select", "eq", "in", "insert", "delete", "lt", "maybeSingle"]) {
    c[m] = (...a: unknown[]) => {
      calls.push({ m, a });
      return c;
    };
  }
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}

vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (t: string) => serviceFrom(t) }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, from: (t: string) => userFrom(t) }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock("../../../../../../terminal/shared/session-token.mjs", () => ({
  authorizeNotify: (...a: unknown[]) => authorizeNotify(...a),
  authorizeAttach: (...a: unknown[]) => authorizeAttach(...a),
}));

import { POST } from "./route";

const NOW = Date.now();
function req(body: unknown, bearer?: string) {
  return new Request("http://localhost/api/terminal/session/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
}

let inserted: unknown[];
beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", "s");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
  vi.spyOn(Math, "random").mockReturnValue(0.9); // no trim
  inserted = [];
  serviceFrom.mockImplementation((table: string) => {
    if (table === "terminal_sessions") return chain({ data: { user_id: "owner-1" }, error: null });
    const calls: Array<{ m: string; a: unknown[] }> = [];
    const c = chain({ data: null, error: null }, calls);
    const insert = c.insert;
    c.insert = (rows: unknown[]) => {
      inserted.push(...rows);
      return insert(rows);
    };
    return c;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session/events", () => {
  it("browser: keeps own sessions and '-' events, drops someone else's session", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
    userFrom.mockReturnValue(chain({ data: [{ sid: "mine" }], error: null }));
    const res = await POST(
      req({
        events: [
          { sid: "mine", event: "socket.closed", at: NOW, detail: { code: 1006 } },
          { sid: "theirs", event: "socket.closed", at: NOW },
          { sid: "-", event: "browser.offline", at: NOW },
        ],
      }),
    );
    expect(await res.json()).toEqual({ saved: 2 });
    expect(inserted).toEqual([
      expect.objectContaining({ user_id: "owner-1", sid: "mine", source: "browser", event: "socket.closed" }),
      expect.objectContaining({ sid: "-", event: "browser.offline" }),
    ]);
  });

  it("browser: refused when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ events: [{ sid: "-", event: "x", at: NOW }] }));
    expect(res.status).toBe(401);
  });

  it("relay: notify token for the sid; every event filed under that sid and its owner", async () => {
    authorizeNotify.mockResolvedValue({ ok: true });
    const res = await POST(req({ sid: "s1", events: [{ sid: "other", event: "attach.rejected", at: NOW }] }, "notify-tok"));
    expect(await res.json()).toEqual({ saved: 1 });
    expect(inserted).toEqual([expect.objectContaining({ user_id: "owner-1", sid: "s1", source: "relay" })]);
  });

  it("relay: bad token refused", async () => {
    authorizeNotify.mockResolvedValue({ ok: false, reason: "expired" });
    const res = await POST(req({ sid: "s1", events: [{ sid: "s1", event: "x", at: NOW }] }, "bad"));
    expect(res.status).toBe(401);
    expect(inserted).toEqual([]);
  });

  it("bridge: an expired bridge token still works for the session's own owner (the waiver)", async () => {
    authorizeAttach.mockResolvedValue({ ok: true, sub: "owner-1", expired: true });
    const res = await POST(req({ sid: "s1", token: "bridge-tok", events: [{ sid: "s1", event: "link.down", at: NOW }] }));
    expect(await res.json()).toEqual({ saved: 1 });
    expect(authorizeAttach).toHaveBeenCalledWith(expect.objectContaining({ role: "bridge", boundOwner: "owner-1", session: "s1" }));
    expect(inserted).toEqual([expect.objectContaining({ source: "bridge", sid: "s1" })]);
  });

  it("bridge: a token for someone else is refused", async () => {
    authorizeAttach.mockResolvedValue({ ok: true, sub: "intruder" });
    const res = await POST(req({ sid: "s1", token: "t", events: [{ sid: "s1", event: "x", at: NOW }] }));
    expect(res.status).toBe(401);
  });
});
