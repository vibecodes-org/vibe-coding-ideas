import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpContext } from "../context";

const matchMock = vi.fn();
vi.mock("../../../src/lib/ai-role-matching", () => ({
  matchRolesWithAiOrFuzzy: (...args: unknown[]) => matchMock(...args),
}));

import { allocateAgent, removeIdeaAgent } from "./idea-agents";

const IDEA_ID = "00000000-0000-4000-a000-000000000010";
const BOT_ID = "00000000-0000-4000-a000-000000000030";
const PLANNER = "00000000-0000-4000-a000-000000000031";

const TASK_COUNT = 120;

/** Fake database with one waiting Planner step per card, all on active runs. */
function makeCtx() {
  const updates: { patch: Record<string, unknown>; id: unknown }[] = [];
  const taskIds = Array.from({ length: TASK_COUNT }, (_, i) => `task-${i}`);
  const steps = taskIds.map((t, i) => ({
    id: `step-${i}`,
    task_id: t,
    agent_role: "Planner",
    bot_id: null,
    match_tier: null,
    status: "pending",
  }));
  const queries: string[] = [];

  function from(table: string) {
    const eqs: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    let rangeFrom = 0;
    let rangeTo = 999;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "not", "order", "delete", "insert", "upsert"]) {
      chain[m] = vi.fn(() => chain);
    }
    chain.eq = vi.fn((c: string, v: unknown) => {
      eqs[c] = v;
      return chain;
    });
    chain.range = vi.fn((a: number, b: number) => {
      rangeFrom = a;
      rangeTo = b;
      return chain;
    });
    chain.update = vi.fn((p: Record<string, unknown>) => {
      patch = p;
      return chain;
    });
    chain.single = vi.fn(() =>
      Promise.resolve({ data: { idea_id: IDEA_ID }, error: null })
    );
    chain.then = (resolve: (v: unknown) => void) => {
      queries.push(table);
      if (patch) {
        updates.push({ patch, id: eqs.id });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      let data: unknown[] = [];
      if (table === "workflow_runs") {
        data = taskIds.map((t) => ({ task_id: t })).slice(rangeFrom, rangeTo + 1);
      } else if (table === "task_workflow_steps") {
        const scoped = eqs.task_id
          ? steps.filter((s) => s.task_id === eqs.task_id)
          : steps;
        data = scoped.slice(rangeFrom, rangeTo + 1);
      } else if (table === "idea_agents") {
        data = [
          {
            bot_id: PLANNER,
            bot: { id: PLANNER, name: "Planner", role: "Planner" },
            bot_profiles: { id: PLANNER, name: "Planner", role: "Planner" },
          },
        ];
      }
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return chain;
  }

  const ctx = {
    supabase: { from } as unknown as McpContext["supabase"],
    userId: "u1",
  } as McpContext;
  return { ctx, updates, queries };
}

describe("agent pool change on a board with many waiting steps", () => {
  beforeEach(() => {
    matchMock.mockReset();
    matchMock.mockResolvedValue({ Planner: { botId: PLANNER, tier: "exact" } });
  });

  it("allocateAgent re-picks every waiting step with ONE role lookup, not one per card", async () => {
    const { ctx, updates } = makeCtx();
    await allocateAgent(ctx, { idea_id: IDEA_ID, bot_id: BOT_ID });
    expect(matchMock).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(TASK_COUNT);
    expect(updates[0].patch).toEqual({ bot_id: PLANNER, match_tier: "exact" });
  });

  it("removeIdeaAgent re-picks every waiting step with ONE role lookup", async () => {
    const { ctx, updates } = makeCtx();
    await removeIdeaAgent(ctx, { idea_id: IDEA_ID, bot_id: BOT_ID });
    expect(matchMock).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(TASK_COUNT);
  });
});
