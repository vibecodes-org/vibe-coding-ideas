import { describe, it, expect, vi, beforeEach } from "vitest";

type Resp = { data: unknown; error: unknown };
const queues: Record<string, Resp[]> = {};

function makeChain(table: string) {
  const next = (): Resp => queues[table]?.shift() ?? { data: [], error: null };
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
    then: (resolve: (v: Resp) => unknown) => resolve(next()),
  });
  return chain;
}

const mockFrom = vi.fn((table: string) => makeChain(table));
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => mockFrom(table),
    auth: { getUser: () => mockGetUser() },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { applyNewTaskWorkflow, getNewTaskWorkflowOptions } from "./workflow-templates";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(queues)) delete queues[k];
  mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  // Default: the card is on idea-1.
  queues["board_tasks"] = [{ data: { idea_id: "idea-1" }, error: null }];
});

function appliedTemplateLookups() {
  return mockFrom.mock.calls.filter(([t]) => t === "workflow_templates").length;
}

describe("applyNewTaskWorkflow", () => {
  it("none: does nothing", async () => {
    expect(await applyNewTaskWorkflow("task-1", "idea-1", "none", ["l1"])).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("auto with no labels: does nothing", async () => {
    expect(await applyNewTaskWorkflow("task-1", "idea-1", "auto", [])).toBeNull();
    expect(appliedTemplateLookups()).toBe(0);
  });

  it("auto with no matching rule: attaches nothing", async () => {
    queues["board_task_labels"] = [{ data: [{ label_id: "l1" }], error: null }];
    queues["workflow_auto_rules"] = [{ data: [], error: null }];
    expect(await applyNewTaskWorkflow("task-1", "idea-1", "auto", ["l1"])).toBeNull();
    expect(appliedTemplateLookups()).toBe(0);
  });

  it("auto ignores a label id that is not on the card", async () => {
    queues["board_task_labels"] = [{ data: [{ label_id: "l1" }], error: null }];
    queues["workflow_auto_rules"] = [{ data: [{ label_id: "other", template_id: "t1" }], error: null }];
    expect(await applyNewTaskWorkflow("task-1", "idea-1", "auto", ["other"])).toBeNull();
    expect(appliedTemplateLookups()).toBe(0);
  });

  it("auto with a match applies the first-ticked label's template (no fit check)", async () => {
    queues["board_task_labels"] = [{ data: [{ label_id: "l1" }, { label_id: "l2" }], error: null }];
    queues["workflow_auto_rules"] = [
      { data: [{ label_id: "l1", template_id: "t-a" }, { label_id: "l2", template_id: "t-b" }], error: null },
    ];
    // Stop the apply at the template lookup; we only need to see which template it asked for.
    queues["workflow_templates"] = [{ data: null, error: { message: "x" } }];
    await expect(applyNewTaskWorkflow("task-1", "idea-1", "auto", ["l2", "l1"])).rejects.toThrow(
      "Template not found"
    );
    expect(appliedTemplateLookups()).toBe(1);
  });

  it("a hand-picked template is applied without reading label rules", async () => {
    queues["workflow_templates"] = [{ data: null, error: { message: "x" } }];
    await expect(applyNewTaskWorkflow("task-1", "idea-1", "t-x", ["l1"])).rejects.toThrow(
      "Template not found"
    );
    expect(mockFrom.mock.calls.some(([t]) => t === "workflow_auto_rules")).toBe(false);
  });
});

describe("applyNewTaskWorkflow ownership checks", () => {
  it("refuses when the card is on a different board than the one sent", async () => {
    queues["board_tasks"] = [{ data: { idea_id: "real-board" }, error: null }];
    await expect(applyNewTaskWorkflow("task-1", "idea-1", "t-x", [])).rejects.toThrow(
      "isn't on this board"
    );
    expect(appliedTemplateLookups()).toBe(0);
  });

  it("refuses a hand-picked workflow from another board", async () => {
    queues["workflow_templates"] = [
      { data: { id: "t-x", idea_id: "someone-elses-board", steps: [] }, error: null },
    ];
    queues["board_tasks"] = [
      { data: { idea_id: "idea-1" }, error: null },
      { data: { id: "task-1", idea_id: "idea-1" }, error: null },
    ];
    await expect(applyNewTaskWorkflow("task-1", "idea-1", "t-x", [])).rejects.toThrow(
      "doesn't belong to this card's board"
    );
    expect(mockFrom.mock.calls.some(([t]) => t === "workflow_runs")).toBe(false);
  });
});

describe("getNewTaskWorkflowOptions", () => {
  it("returns templates with step counts and rules", async () => {
    queues["workflow_templates"] = [
      { data: [{ id: "t1", name: "Bug Fix", steps: [{}, {}, {}] }], error: null },
    ];
    queues["workflow_auto_rules"] = [{ data: [{ label_id: "l1", template_id: "t1" }], error: null }];
    expect(await getNewTaskWorkflowOptions("idea-1")).toEqual({
      templates: [{ id: "t1", name: "Bug Fix", stepCount: 3 }],
      rules: [{ label_id: "l1", template_id: "t1" }],
    });
  });

  it("throws on a query error so the dialog can fall back", async () => {
    queues["workflow_templates"] = [{ data: null, error: { message: "boom" } }];
    await expect(getNewTaskWorkflowOptions("idea-1")).rejects.toThrow("boom");
  });
});
