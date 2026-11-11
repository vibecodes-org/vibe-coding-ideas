// Card f2a563ca: the bridge sends the main window's own usage totals.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type FakeCall, type FakeResult } from "@/test/fake-supabase";
import { mintSessionTokens } from "../../../../../../terminal/shared/session-token.mjs";

const SECRET = "test-secret";
const SID = "11111111-2222-4333-8444-555555555555";
const IDEA = "faed9703-f223-4a32-8f3b-1aee2f2ddefd";
const OWNER = "user-1";
const CONV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const { state } = vi.hoisted(() => ({
  state: { tables: {} as Record<string, (call: FakeCall) => FakeResult> },
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastFake: any = null;

vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return {
    createClient: () => {
      const fake = fakeSupabase({ tables: state.tables });
      lastFake = fake;
      return fake.client;
    },
  };
});
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { POST } from "./route";

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const hourAgo = () => new Date(Math.floor((Date.now() - 3_600_000) / 3_600_000) * 3_600_000).toISOString();

async function bridgeToken(sub = OWNER) {
  return (await mintSessionTokens({ sub, idea: IDEA, sid: SID, secret: SECRET })).bridge;
}
const req = (body: unknown) =>
  new Request("http://localhost/api/terminal/session/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const hourRow = (over: object = {}) => ({
  hour: hourAgo(), model: "claude-opus-5-5", calls: 3, input_tokens: 10, output_tokens: 20,
  cache_read_tokens: 30, cache_write_5m_tokens: 4, cache_write_1h_tokens: 5, ...over,
});
async function body(over: object = {}) {
  return { sid: SID, token: await bridgeToken(), conversationId: CONV, hours: [hourRow()], stepIds: [], firstCallAt: hourAgo(), lastCallAt: hourAgo(), ...over };
}

function setTables(opts: { row?: unknown; session?: unknown; upsertError?: boolean } = {}) {
  let sessionReads = 0;
  state.tables = {
    terminal_sessions: () => {
      sessionReads++;
      // first read is the auth read (row), second the extra columns
      if (sessionReads === 1) {
        return { data: opts.row === undefined ? { user_id: OWNER, idea_id: IDEA, status: "active", expires_at: future() } : opts.row, error: null };
      }
      return { data: opts.session === undefined ? { claude_session_id: CONV, machine_label: "Mac" } : opts.session, error: null };
    },
    session_main_usage_hours: () => ({ data: null, error: opts.upsertError ? { message: "boom" } : null }),
    session_main_usage: () => ({ data: null, error: null }),
  };
}

beforeEach(() => {
  vi.stubEnv("TERMINAL_SESSION_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  setTables();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/terminal/session/usage", () => {
  it("saves the hours and the conversation, taking board and owner from the session row", async () => {
    const res = await POST(req(await body({ stepIds: ["11111111-1111-4111-8111-111111111111"] })));
    expect(res.status).toBe(200);
    const [hours] = lastFake.writesTo("session_main_usage_hours", "upsert");
    expect(hours.payload[0]).toMatchObject({ conversation_id: CONV, user_id: OWNER, idea_id: IDEA, model: "claude-opus-5-5", calls: 3 });
    const [conv] = lastFake.writesTo("session_main_usage", "upsert");
    expect(conv.payload).toMatchObject({ conversation_id: CONV, idea_id: IDEA, step_ids: ["11111111-1111-4111-8111-111111111111"], machine_label: "Mac" });
  });

  it("401s a bad token and writes nothing", async () => {
    expect((await POST(req({ ...(await body()), token: "nope" }))).status).toBe(401);
    expect((await POST(req({ ...(await body()), token: await bridgeToken("someone-else") }))).status).toBe(401);
    expect(lastFake.writesTo("session_main_usage_hours", "upsert")).toHaveLength(0);
  });

  it("accepts an ended row (the last send happens as it ends), 409s a missing row", async () => {
    setTables({ row: { user_id: OWNER, idea_id: IDEA, status: "ended", expires_at: future() } });
    expect((await POST(req(await body()))).status).toBe(200);
    setTables({ row: null });
    expect((await POST(req(await body()))).status).toBe(409);
  });

  it("403s a conversation that isn't the row's", async () => {
    setTables({ session: { claude_session_id: "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee", machine_label: null } });
    expect((await POST(req(await body()))).status).toBe(403);
    expect(lastFake.writesTo("session_main_usage_hours", "upsert")).toHaveLength(0);
  });

  it("400s extra keys, old hours, too many rows and bad ids", async () => {
    expect((await POST(req({ ...(await body()), cwd: "/Users/x" }))).status).toBe(400);
    expect((await POST(req(await body({ hours: [hourRow({ prompt: "text" })] })))).status).toBe(400);
    expect((await POST(req(await body({ hours: [hourRow({ hour: "2020-01-01T00:00:00.000Z" })] })))).status).toBe(400);
    expect((await POST(req(await body({ hours: Array.from({ length: 2001 }, () => hourRow()) })))).status).toBe(400);
    expect((await POST(req(await body({ stepIds: ["not-a-uuid"] })))).status).toBe(400);
    expect((await POST(req(await body({ conversationId: "nope" })))).status).toBe(400);
  });

  it("500s when the save fails", async () => {
    setTables({ upsertError: true });
    expect((await POST(req(await body()))).status).toBe(500);
  });

  it("writes with upsert only (conflict key conversation, hour, model), never insert", async () => {
    await POST(req(await body()));
    expect(lastFake.writesTo("session_main_usage_hours", "insert")).toHaveLength(0);
    expect(lastFake.writesTo("session_main_usage_hours", "upsert")).toHaveLength(1);
  });
});
