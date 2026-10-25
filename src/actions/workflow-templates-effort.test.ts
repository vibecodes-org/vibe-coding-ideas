import { describe, it, expect, vi } from "vitest";

// Per-step effort (card 5e654dd1, stage 5): applying a template copies each
// step's own effort level onto the waiting step.

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai-role-matching", () => ({
  matchRolesWithAiOrFuzzy: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/workflow-helpers", () => ({
  propagateTemplateEdits: vi.fn(),
  resolveSuggestionOnApply: vi.fn().mockResolvedValue(undefined),
}));

import { applyWorkflowTemplateWithContext } from "./workflow-templates";

const TEMPLATE = {
  id: "tmpl-1",
  usage_count: 0,
  steps: [
    { title: "Review", role: "Code Reviewer", model_tier: "frontier", effort: "high" },
    { title: "Test", role: "QA Engineer", model_tier: "standard" },
  ],
};

describe("applyWorkflowTemplateWithContext - effort", () => {
  it("copies the template step's effort into effort_override (absent -> null)", async () => {
    const inserted: Record<string, unknown>[][] = [];
    const runCalls = { n: 0 };
    const chainFor = (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        not: self,
        update: self,
        insert: (rows: Record<string, unknown>[]) => {
          if (table === "task_workflow_steps") inserted.push(rows);
          return chain;
        },
        single: () => {
          if (table === "workflow_templates") return Promise.resolve({ data: TEMPLATE, error: null });
          if (table === "board_tasks") return Promise.resolve({ data: { id: "t1", idea_id: "i1" }, error: null });
          if (table === "workflow_runs") return Promise.resolve({ data: { id: "run-1" }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle: () => {
          runCalls.n += table === "workflow_runs" ? 1 : 0;
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: table === "task_workflow_steps" ? [] : [], error: null }),
      });
      return chain;
    };
    const supabase = { from: (table: string) => chainFor(table) };

    await applyWorkflowTemplateWithContext(supabase, "user-1", "t1", "tmpl-1");

    expect(inserted).toHaveLength(1);
    expect(inserted[0].map((r) => r.effort_override)).toEqual(["high", null]);
    expect(inserted[0].map((r) => r.model_tier)).toEqual(["frontier", "standard"]);
  });
});
