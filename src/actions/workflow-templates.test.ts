import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ──
// applyAutoRuleRetroactively issues three distinct .from() queries that resolve
// in different ways:
//   1. workflow_auto_rules  → terminal .single()
//   2. board_task_labels    → chain is awaited directly (thenable) → { data }
//   3. workflow_runs        → chain is awaited directly (thenable) → { data }
// We model each query as a thenable chain whose methods return the chain, and
// whose then()/single() resolve to a per-table queued response. This lets us
// drive the active-runs set precisely without touching applyWorkflowTemplate
// (the apply loop is a no-op in these tests because every labelled task already
// has an active run, so the eligible list is empty).

type Resp = { data: unknown; error: unknown };

const queues: Record<string, Resp[]> = {};

function makeChain(table: string) {
  const next = (): Resp =>
    queues[table]?.shift() ?? { data: [], error: null };

  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  Object.assign(chain, {
    select: passthrough,
    eq: passthrough,
    not: passthrough,
    in: passthrough,
    order: passthrough,
    single: () => Promise.resolve(next()),
    maybeSingle: () => Promise.resolve(next()),
    // Make the chain itself awaitable for queries that don't call a terminal.
    then: (resolve: (v: Resp) => unknown) => resolve(next()),
  });
  return chain;
}

const mockFrom = vi.fn((table: string) => makeChain(table));

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "human-user-1" } },
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => mockFrom(table),
    auth: { getUser: () => mockGetUser() },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { applyAutoRuleRetroactively } from "./workflow-templates";

describe("applyAutoRuleRetroactively — skipped count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(queues)) delete queues[k];
  });

  it("counts ONLY labelled tasks with an active run, not the whole idea's active runs", async () => {
    // Rule under test.
    queues["workflow_auto_rules"] = [
      {
        data: {
          id: "rule-1",
          idea_id: "idea-1",
          label_id: "label-1",
          template_id: "tpl-1",
        },
        error: null,
      },
    ];

    // 3 labelled tasks.
    queues["board_task_labels"] = [
      {
        data: [
          { task_id: "t1", board_tasks: { id: "t1", idea_id: "idea-1", archived: false } },
          { task_id: "t2", board_tasks: { id: "t2", idea_id: "idea-1", archived: false } },
          { task_id: "t3", board_tasks: { id: "t3", idea_id: "idea-1", archived: false } },
        ],
        error: null,
      },
    ];

    // Active runs scoped by idea: all 3 labelled tasks have active runs, PLUS
    // 5 OTHER (non-labelled) tasks in the same idea also have active runs.
    // The old code (skipped = activeTaskIds.size) would report 8; the fix must
    // report only the 3 labelled tasks. Because all labelled tasks are active,
    // the eligible list is empty and the apply loop never runs.
    queues["workflow_runs"] = [
      {
        data: [
          { task_id: "t1", board_tasks: { idea_id: "idea-1" } },
          { task_id: "t2", board_tasks: { idea_id: "idea-1" } },
          { task_id: "t3", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x1", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x2", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x3", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x4", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x5", board_tasks: { idea_id: "idea-1" } },
        ],
        error: null,
      },
    ];

    const result = await applyAutoRuleRetroactively("rule-1");

    // Only the 3 labelled tasks with active runs are skipped — NOT all 8.
    expect(result.skipped).toBe(3);
    expect(result.applied).toBe(0);
  });

  it("reports the single labelled active task even when the idea has many other active runs", async () => {
    queues["workflow_auto_rules"] = [
      {
        data: {
          id: "rule-1",
          idea_id: "idea-1",
          label_id: "label-1",
          template_id: "tpl-1",
        },
        error: null,
      },
    ];

    // 3 labelled tasks, only t1 has an active run. t2/t3 would be eligible, but
    // we make them ALSO active here so the apply loop stays a no-op and the
    // final count reflects the initializer alone. (See sibling test for the
    // mixed case rationale; this isolates the "1 of N labelled" boundary.)
    queues["board_task_labels"] = [
      {
        data: [
          { task_id: "t1", board_tasks: { id: "t1", idea_id: "idea-1", archived: false } },
        ],
        error: null,
      },
    ];

    // t1 active, plus 5 unrelated active-run tasks in the idea.
    queues["workflow_runs"] = [
      {
        data: [
          { task_id: "t1", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x1", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x2", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x3", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x4", board_tasks: { idea_id: "idea-1" } },
          { task_id: "x5", board_tasks: { idea_id: "idea-1" } },
        ],
        error: null,
      },
    ];

    const result = await applyAutoRuleRetroactively("rule-1");

    // 1 labelled task with an active run → skipped must be 1, NOT 6.
    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(0);
  });
});
