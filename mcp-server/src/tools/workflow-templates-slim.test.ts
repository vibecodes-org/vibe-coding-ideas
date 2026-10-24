import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  listWorkflowTemplates,
  listWorkflowTemplatesSchema,
  createWorkflowTemplate,
  updateWorkflowTemplate,
} from "./workflows";

// Template list and edit replies (card 5e654dd1, R6): short by default.

const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const TEMPLATE_ID = "00000000-0000-4000-a000-000000000050";

const steps = [
  { title: "Plan", role: "planner", description: "long text ".repeat(100), model_tier: "frontier", requires_approval: true },
  { title: "Build", role: "developer", description: "more text ".repeat(100) },
];
const row = {
  id: TEMPLATE_ID,
  name: "Feature",
  description: "d",
  steps,
  usage_count: 3,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};

function ctxWith(result: { data: unknown; error?: unknown }, eqSpy?: (...args: unknown[]) => void): McpContext {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "order"]) chain[m] = vi.fn(() => chain);
  chain.eq = vi.fn((...args: unknown[]) => {
    eqSpy?.(...args);
    return chain;
  });
  chain.single = vi.fn(() => Promise.resolve({ data: result.data, error: result.error ?? null }));
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve);
  return {
    supabase: { from: vi.fn(() => chain) },
    userId: "u",
    ownerUserId: "u",
  } as unknown as McpContext;
}

describe("list_workflow_templates", () => {
  it("returns a short summary per template by default", async () => {
    const out = (await listWorkflowTemplates(
      ctxWith({ data: [row] }),
      listWorkflowTemplatesSchema.parse({ idea_id: IDEA_ID })
    )) as Array<Record<string, unknown>>;
    expect(out).toEqual([
      { id: TEMPLATE_ID, name: "Feature", description: "d", usage_count: 3, step_count: 2, step_titles: ["Plan", "Build"] },
    ]);
  });

  it("template_id returns that one template in full", async () => {
    const eq = vi.fn();
    const out = (await listWorkflowTemplates(
      ctxWith({ data: [row] }, eq),
      listWorkflowTemplatesSchema.parse({ idea_id: IDEA_ID, template_id: TEMPLATE_ID })
    )) as Array<Record<string, unknown>>;
    expect(eq).toHaveBeenCalledWith("id", TEMPLATE_ID);
    expect(out).toHaveLength(1);
    expect(out[0].steps).toEqual(steps);
  });

  it("template_id that does not exist is an error", async () => {
    await expect(
      listWorkflowTemplates(
        ctxWith({ data: [] }),
        listWorkflowTemplatesSchema.parse({ idea_id: IDEA_ID, template_id: TEMPLATE_ID })
      )
    ).rejects.toThrow(/not found/);
  });

  it("include_steps returns every template in full", async () => {
    const out = (await listWorkflowTemplates(
      ctxWith({ data: [row, { ...row, id: "t2" }] }),
      listWorkflowTemplatesSchema.parse({ idea_id: IDEA_ID, include_steps: true })
    )) as Array<Record<string, unknown>>;
    expect(out).toHaveLength(2);
    expect(out[0].steps).toEqual(steps);
  });
});

describe("create / update workflow template echo", () => {
  const compact = [
    { title: "Plan", role: "planner", model_tier: "frontier", requires_approval: true },
    { title: "Build", role: "developer", model_tier: null, requires_approval: false },
  ];

  it("create returns id, name, updated_at and a compact step list", async () => {
    const out = await createWorkflowTemplate(ctxWith({ data: row }), {
      idea_id: IDEA_ID,
      name: "Feature",
      steps: [{ title: "Plan", role: "planner" }],
    });
    expect(out).toEqual({ id: TEMPLATE_ID, name: "Feature", updated_at: "2026-10-02T00:00:00Z", steps: compact });
    expect(JSON.stringify(out)).not.toContain("long text");
  });

  it("update returns the compact echo and keeps propagation", async () => {
    const out = (await updateWorkflowTemplate(ctxWith({ data: row }), {
      template_id: TEMPLATE_ID,
      name: "Feature",
    })) as Record<string, unknown>;
    expect(out).toMatchObject({ id: TEMPLATE_ID, name: "Feature", updated_at: "2026-10-02T00:00:00Z", steps: compact });
    expect(out).toHaveProperty("propagation");
    expect(out).not.toHaveProperty("description");
    expect(JSON.stringify(out)).not.toContain("long text");
  });
});
