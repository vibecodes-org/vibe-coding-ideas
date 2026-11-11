// Card f2a563ca: the bridge sends the main window's own usage totals.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type FakeCall, type FakeResult } from "@/test/fake-supabase";
import { mainWindowOwnUsage } from "../../../../../../terminal/shared/transcript-usage.mjs";
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
    session_main_usage_hours: (call) => ({
      data: call.op === "select" ? [] : null,
      error: opts.upsertError ? { message: "boom" } : null,
    }),
    session_main_usage: (call) => ({ data: call.op === "select" ? [] : null, error: null }),
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

  it("writes with upsert only (conflict key user, conversation, hour, model), never insert", async () => {
    await POST(req(await body()));
    expect(lastFake.writesTo("session_main_usage_hours", "insert")).toHaveLength(0);
    expect(lastFake.writesTo("session_main_usage_hours", "upsert")).toHaveLength(1);
  });

  it("keys the upserts by user as well, and scopes the stale-row delete by owner", async () => {
    await POST(req(await body()));
    const [hoursUp] = lastFake.writesTo("session_main_usage_hours", "upsert");
    expect(hoursUp.options).toMatchObject({ onConflict: "user_id,conversation_id,hour,model" });
    const [convUp] = lastFake.writesTo("session_main_usage", "upsert");
    expect(convUp.options).toMatchObject({ onConflict: "user_id,conversation_id" });
    const [del] = lastFake.writesTo("session_main_usage_hours", "delete");
    expect(del.filters).toContainEqual(["eq", ["conversation_id", CONV]]);
    expect(del.filters).toContainEqual(["eq", ["user_id", OWNER]]);
  });
});

// A small in-memory copy of the hours table, so two sends in a row can be followed end to end.
describe("a send mid-step, then a send after the step closes", () => {
  type Row = { conversation_id: string; user_id: string; hour: string; model: string; calls: number; updated_at: string };
  let rows: Row[] = [];
  const keep = (r: Row, filters: [string, unknown][]) =>
    filters.every(([f, a]) => {
      const [col, val] = a as [string, string];
      const v = (r as unknown as Record<string, string>)[col];
      if (f === "eq") return v === val;
      if (f === "neq") return v !== val;
      if (f === "gte") return v >= val;
      if (f === "lt") return v < val;
      return true;
    });

  // setTables counts session reads per send, so each send installs afresh.
  const install = (opts: Parameters<typeof setTables>[0] = {}) => {
    setTables(opts);
    state.tables.session_main_usage_hours = (call) => {
      if (call.op === "upsert") {
        for (const p of call.payload as Row[]) {
          rows = rows.filter((r) => !(r.user_id === p.user_id && r.conversation_id === p.conversation_id && r.hour === p.hour && r.model === p.model));
          rows.push({ ...p });
        }
        return { data: null, error: null };
      }
      if (call.op === "delete") {
        rows = rows.filter((r) => !keep(r, call.filters));
        return { data: null, error: null };
      }
      return { data: rows.filter((r) => keep(r, call.filters)), error: null };
    };
  };
  beforeEach(() => {
    rows = [];
    install();
  });

  const line = (o: object) => JSON.stringify(o);
  const callLine = (id: string, ts: string, block?: object) =>
    line({
      isSidechain: false, type: "assistant", timestamp: ts,
      message: { model: "claude-opus-5-5", id, type: "message", role: "assistant", content: [block ?? { type: "text", text: "x" }], stop_reason: null,
        usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, output_tokens: 1 } },
    });

  it("drops the hour the step took over, so it is not counted twice", async () => {
    const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const t = (hm: string) => `${day}T${hm}:00.000Z`;
    const MARK = "vcu_" + "0a".repeat(12);
    const CT = "ct_" + "a1".repeat(24);
    const STEP = "11111111-1111-4111-8111-111111111111";
    const claim = line({ type: "user", isSidechain: false, timestamp: t("09:00"), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_claim", content: [{ type: "text", text: JSON.stringify({ done: false, claim_token: CT, step: { id: STEP }, usage_command: `(\nmark='${MARK}'` }) }] }] } });
    const midStep = [claim, callLine("msg_m1", t("09:10")), callLine("msg_m2", t("09:20"))];
    const closed = [
      ...midStep,
      callLine("msg_run", t("10:05"), { type: "tool_use", id: "toolu_run", name: "Bash", input: { command: `mark='${MARK}'` } }),
    ];

    const send = async (lines: string[]) => {
      install();
      const usage = mainWindowOwnUsage(lines);
      return POST(req(await body({ hours: usage.hours, stepIds: usage.stepIds, firstCallAt: usage.firstCallAt, lastCallAt: usage.lastCallAt })));
    };

    // Mid-step (the claim is still open): the two calls count as the main window's.
    const r1 = await send(midStep);
    expect(r1.status).toBe(200);
    expect(rows.reduce((n, r) => n + r.calls, 0)).toBe(2);

    await new Promise((r) => setTimeout(r, 5)); // sends are an hour apart in life; keep the stamps distinct
    // After the step's usage run closes the claim, those calls are the step's: nothing is ours.
    expect((await send(closed)).status).toBe(200);
    expect(rows).toHaveLength(0);
  });

  const seed = (o: Partial<Row>): Row => {
    const r: Row = { conversation_id: CONV, user_id: OWNER, hour: hourAgo(), model: "claude-opus-5-5", calls: 1, updated_at: "2020-01-01T00:00:00.000Z", ...o };
    rows.push(r);
    return r;
  };
  const hoursAgo = (n: number) => new Date(Math.floor((Date.now() - n * 3_600_000) / 3_600_000) * 3_600_000).toISOString();

  it("a second user's send for the same conversation id succeeds and leaves the first user's rows alone", async () => {
    const OTHER = "user-2";
    const first = await POST(req(await body({ hours: [hourRow({ calls: 7 })] })));
    expect(first.status).toBe(200);

    install({ row: { user_id: OTHER, idea_id: IDEA, status: "active", expires_at: future() } });
    const second = await POST(req({ ...(await body({ hours: [hourRow({ calls: 2 })] })), token: await bridgeToken(OTHER) }));
    expect(second.status).toBe(200);
    expect(rows.filter((r) => r.user_id === OWNER).map((r) => r.calls)).toEqual([7]);
    expect(rows.filter((r) => r.user_id === OTHER).map((r) => r.calls)).toEqual([2]);

    install();
    const again = await POST(req(await body({ hours: [hourRow({ calls: 8 })] })));
    expect(again.status).toBe(200);
    expect(rows.filter((r) => r.user_id === OWNER).map((r) => r.calls)).toEqual([8]);
    expect(rows.filter((r) => r.user_id === OTHER).map((r) => r.calls)).toEqual([2]);
  });

  it("the delete leaves a row older than the window and another conversation's row alone", async () => {
    const old = seed({ hour: hoursAgo(40 * 24) });
    const other = seed({ conversation_id: "99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
    const stale = seed({ hour: hoursAgo(5), model: "stale" });
    expect((await POST(req(await body()))).status).toBe(200);
    expect(rows).toContain(old);
    expect(rows).toContain(other);
    expect(rows).not.toContain(stale);
  });

  it("a send at the 2000-row cap leaves an older, unsent hour alone but drops a stale hour inside its range", async () => {
    const models = Array.from({ length: 50 }, (_, m) => `claude-model-${m}`);
    const sent = Array.from({ length: 40 }, (_, h) => models.map((model) => hourRow({ hour: hoursAgo(h + 1), model }))).flat();
    expect(sent).toHaveLength(2000);
    const older = seed({ hour: hoursAgo(200), model: "older" }); // older than every sent hour, inside the window
    const stale = seed({ hour: hoursAgo(10), model: "stale" }); // inside the sent range
    expect((await POST(req(await body({ hours: sent })))).status).toBe(200);
    expect(rows).toContain(older);
    expect(rows).not.toContain(stale);
  });
});
