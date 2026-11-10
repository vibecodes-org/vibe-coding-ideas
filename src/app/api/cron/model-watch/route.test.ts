import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  row: null as null | { value: unknown },
  dup: [] as unknown[],
  inserted: [] as Record<string, unknown>[],
  upserts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/ai-helpers", () => ({
  AI_MODEL: "claude-sonnet-5-5",
  getPlatformAnthropicProvider: () => () => ({}),
}));
const runModelChecks = vi.fn();
vi.mock("@/lib/model-watch-checks", () => ({
  runModelChecks: (...a: unknown[]) => runModelChecks(...a),
}));

function from(table: string) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ["select", "eq", "ilike", "order", "limit"]) q[m] = chain;
  q.maybeSingle = async () =>
    table === "platform_settings"
      ? { data: state.row, error: null }
      : { data: { position: 1000 }, error: null };
  q.then = (res: (v: unknown) => void) =>
    res(
      table === "board_columns"
        ? { data: [{ id: "c1", title: "To Do", is_done_column: false, position: 0 }], error: null }
        : { data: state.dup, error: null }
    );
  q.upsert = async (v: Record<string, unknown>) => {
    state.upserts.push(v);
    return { error: null };
  };
  q.insert = async (v: Record<string, unknown>) => {
    state.inserted.push(v);
    return { error: null };
  };
  return q;
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from }) }));

import { GET } from "./route";

const models = (extra: unknown[] = []) => ({
  data: [
    { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-10-01T00:00:00Z" },
    ...extra,
  ],
  has_more: false,
});
const newer = {
  id: "claude-sonnet-5-6",
  display_name: "Claude Sonnet 5.6",
  created_at: "2026-11-09T00:00:00Z",
};
const req = (auth?: string) =>
  new Request("http://x/api/cron/model-watch", {
    headers: auth ? { authorization: auth } : {},
  });
const okResult = { name: "short rewrite", ok: true, inputTokens: 1, outputTokens: 1, ms: 1 };

beforeEach(() => {
  state.row = null;
  state.dup = [];
  state.inserted = [];
  state.upserts = [];
  runModelChecks.mockReset().mockResolvedValue([okResult]);
  process.env.CRON_SECRET = "s3cret";
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://sb";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(models())));
});

describe("model-watch route", () => {
  it("503 when the secret is blank", async () => {
    process.env.CRON_SECRET = "   ";
    expect((await GET(req("Bearer    "))).status).toBe(503);
  });
  it("401 without the right bearer", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
  });
  it("quiet day: no AI call, no card, first run seeds seen", async () => {
    const res = await GET(req("Bearer s3cret"));
    expect(await res.json()).toEqual({ action: "none" });
    expect(runModelChecks).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
    expect((state.upserts[0].value as { seen: string[] }).seen).toEqual(["claude-sonnet-5-5"]);
  });
  it("already seen: does nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(models([newer]))));
    state.row = { value: { seen: ["claude-sonnet-5-6"] } };
    await GET(req("Bearer s3cret"));
    expect(runModelChecks).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });
  it("new model: one card and marked seen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(models([newer]))));
    state.row = { value: { seen: ["claude-sonnet-5-5"] } };
    const res = await GET(req("Bearer s3cret"));
    expect(await res.json()).toEqual({ action: "card", model: "claude-sonnet-5-6", passed: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].title).toContain("Sonnet 5.6");
    expect(state.inserted[0].position).toBe(0);
    expect((state.upserts[0].value as { seen: string[] }).seen).toContain("claude-sonnet-5-6");
  });
  it("duplicate card: records seen, creates nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(models([newer]))));
    state.row = { value: { seen: [] } };
    state.dup = [{ id: "t1" }];
    await GET(req("Bearer s3cret"));
    expect(runModelChecks).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
    expect(state.upserts).toHaveLength(1);
  });
  it("Models API failure: 500, nothing marked seen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(state.upserts).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });
});
