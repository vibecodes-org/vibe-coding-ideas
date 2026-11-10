import { describe, it, expect, vi, beforeEach } from "vitest";

const IDEA_ID = "00000000-0000-4000-a000-000000000010";
const REMOVED = "00000000-0000-4000-a000-000000000030";
const PLANNER = "00000000-0000-4000-a000-000000000031";

const pending: (() => Promise<unknown>)[] = [];
vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    pending.push(fn);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const matchMock = vi.fn();
vi.mock("@/lib/ai-role-matching", () => ({
  matchRolesWithAiOrFuzzy: (...args: unknown[]) => matchMock(...args),
  roleMatchSignature: vi.fn(),
}));

type Step = {
  id: string;
  task_id: string;
  agent_role: string;
  bot_id: string | null;
  match_tier: string | null;
  status: string;
};
let steps: Step[] = [];
let pool: { bot_id: string; bot_profiles: { id: string; name: string; role: string } }[] = [];
const updates: { patch: Record<string, unknown>; id: unknown }[] = [];

/** Fake database. Reads stop at 1,000 rows unless .range() is used, like Supabase. */
function makeClient() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      let from = 0;
      let to = 999;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "not", "order", "delete", "insert"]) {
        chain[m] = vi.fn(() => chain);
      }
      chain.eq = vi.fn((c: string, v: unknown) => {
        eqs[c] = v;
        return chain;
      });
      chain.range = vi.fn((a: number, b: number) => {
        from = a;
        to = b;
        return chain;
      });
      chain.update = vi.fn((p: Record<string, unknown>) => {
        patch = p;
        return chain;
      });
      chain.then = (resolve: (v: unknown) => void) => {
        if (patch) {
          updates.push({ patch, id: eqs.id });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        const data =
          table === "task_workflow_steps"
            ? steps.slice(from, to + 1)
            : table === "idea_agents"
              ? pool
              : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => makeClient() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => makeClient() }));

import { removeIdeaAgent, allocateAgent } from "./idea-agents";

async function runBackground() {
  for (const fn of pending.splice(0)) await fn();
}

beforeEach(() => {
  matchMock.mockReset();
  updates.length = 0;
  pending.length = 0;
  steps = [];
  pool = [];
});

describe("web re-pick after an agent pool change", () => {
  it("looks at every waiting step, not just the first 1,000", async () => {
    steps = Array.from({ length: 1500 }, (_, i) => ({
      id: `step-${i}`,
      task_id: `task-${i}`,
      agent_role: "Planner",
      bot_id: null,
      match_tier: null,
      status: "pending",
    }));
    pool = [{ bot_id: PLANNER, bot_profiles: { id: PLANNER, name: "P", role: "Planner" } }];
    matchMock.mockResolvedValue({ Planner: { botId: PLANNER, tier: "exact" } });

    await allocateAgent(IDEA_ID, PLANNER);
    await runBackground();

    expect(updates).toHaveLength(1500);
  });

  it("leaves waiting steps unassigned when the removed agent was the last with that role", async () => {
    steps = [
      {
        id: "step-1",
        task_id: "task-1",
        agent_role: "Planner",
        bot_id: REMOVED,
        match_tier: "ai",
        status: "pending",
      },
    ];
    pool = []; // nobody left
    matchMock.mockResolvedValue({});

    await removeIdeaAgent(IDEA_ID, REMOVED);
    await runBackground();

    expect(updates).toEqual([{ patch: { bot_id: null, match_tier: null }, id: "step-1" }]);
  });

  it("clears a step still on the removed agent when other agents remain but none fit the role", async () => {
    steps = [
      {
        id: "step-1",
        task_id: "task-1",
        agent_role: "Planner",
        bot_id: REMOVED,
        match_tier: "ai",
        status: "pending",
      },
    ];
    pool = [{ bot_id: PLANNER, bot_profiles: { id: PLANNER, name: "T", role: "Tester" } }];
    matchMock.mockResolvedValue({ Planner: { botId: null, tier: "none" } });

    await removeIdeaAgent(IDEA_ID, REMOVED);
    await runBackground();

    expect(updates).toEqual([{ patch: { bot_id: null, match_tier: null }, id: "step-1" }]);
  });
});
