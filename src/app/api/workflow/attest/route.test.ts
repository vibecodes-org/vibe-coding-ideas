import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

const STEP = "11111111-2222-4333-8444-555555555555";
const BOT = "37e8ffb2-3f88-49e5-9ab4-a516c1088f77";
const TOKEN = "wt_goodtoken";

let rows: Record<string, unknown>[] = [];
let lookupError: { message: string } | null = null;
const updates: Record<string, unknown>[] = [];
const updateEq: [string, unknown][] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (c: string, v: unknown) => {
        if (updates.length && c) updateEq.push([c, v]);
        return chain;
      };
      chain.limit = () => chain;
      chain.update = (v: Record<string, unknown>) => {
        updates.push(v);
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (r: (v: unknown) => void) => r({ data: rows, error: lookupError });
      return chain;
    },
  }),
}));

import { POST } from "./route";

function req(body: unknown, raw?: string) {
  return new Request("https://app.test/api/workflow/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

const event = (over: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => ({
  hook_event_name: "PreToolUse",
  agent_type: "vc-atlas-37e8ffb2-standard",
  agent_id: "agent-1",
  tool_name: "mcp__vibecodes__save_step_output",
  tool_input: { step_id: STEP, work_token: TOKEN, ...input },
  ...over,
});

const step = (over: Record<string, unknown> = {}) => ({
  id: STEP,
  bot_id: BOT,
  status: "in_progress",
  work_token_hash: hash(TOKEN),
  attested_agent_type: null,
  ...over,
});

beforeEach(() => {
  rows = [step()];
  lookupError = null;
  updates.length = 0;
  updateEq.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});

async function expectEmpty204(res: Response) {
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
}

describe("POST /api/workflow/attest", () => {
  it("records a report carrying the right work token", async () => {
    await expectEmpty204(await POST(req(event())));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ attested_agent_type: "vc-atlas-37e8ffb2-standard", attested_agent_id: "agent-1" });
    expect(updateEq).toContainEqual(["status", "in_progress"]);
    expect(updateEq).toContainEqual(["work_token_hash", hash(TOKEN)]);
  });

  it("finds the step by task id for add_task_comment", async () => {
    await expectEmpty204(
      await POST(req(event({ tool_name: "mcp__v__add_task_comment" }, { step_id: undefined, task_id: STEP }))),
    );
    expect(updates).toHaveLength(1);
  });

  it.each([
    ["a wrong token", () => event({}, { work_token: "wt_other" })],
    ["a main-thread call (no agent_type)", () => event({ agent_type: undefined })],
    ["another tool", () => event({ tool_name: "mcp__vibecodes__complete_step" })],
    ["another event", () => event({ hook_event_name: "PostToolUse" })],
  ])("writes nothing for %s and still answers 204", async (_n, make) => {
    await expectEmpty204(await POST(req(make())));
    expect(updates).toHaveLength(0);
  });

  it("refuses a wrong work token on a running step: no write, empty 204", async () => {
    rows = [step({ status: "in_progress" })];
    await expectEmpty204(await POST(req(event({}, { work_token: "wt_not_the_right_one" }))));
    expect(updates).toHaveLength(0);
  });

  it("writes nothing when the step is not in progress", async () => {
    rows = [step({ status: "completed" })];
    await expectEmpty204(await POST(req(event())));
    expect(updates).toHaveLength(0);
  });

  it("writes nothing when the old token's hash was cleared", async () => {
    rows = [step({ work_token_hash: null })];
    await expectEmpty204(await POST(req(event())));
    expect(updates).toHaveLength(0);
  });

  it("answers 204 for malformed or oversized bodies", async () => {
    await expectEmpty204(await POST(req(null, "{not json")));
    await expectEmpty204(await POST(req(null, "x".repeat(256 * 1024 + 1))));
    expect(updates).toHaveLength(0);
  });

  it("answers 204 when the lookup fails", async () => {
    lookupError = { message: "boom" };
    await expectEmpty204(await POST(req(event())));
    expect(updates).toHaveLength(0);
  });

  it("skips the write when the same agent type is already recorded", async () => {
    rows = [step({ attested_agent_type: "vc-atlas-37e8ffb2-standard" })];
    await POST(req(event()));
    expect(updates).toHaveLength(0);
  });

  it("never replaces the step's own agent's report with another agent's", async () => {
    rows = [step({ attested_agent_type: "vc-atlas-37e8ffb2-standard" })];
    await POST(req(event({ agent_type: "general-purpose" })));
    expect(updates).toHaveLength(0);
  });

  it("lets the step's own agent replace another agent's report", async () => {
    rows = [step({ attested_agent_type: "general-purpose" })];
    await POST(req(event()));
    expect(updates).toHaveLength(1);
  });
});
