import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  noWorkflowInstruction,
  ASSIGN_AND_START_INSTRUCTION,
  SUGGEST_WORKFLOW_INSTRUCTION,
  NO_TEMPLATES_PREFIX,
} from "./no-workflow";

function ctxWith(opts: { templateCount: number; dismissed: unknown[] }): McpContext {
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) chain[m] = vi.fn(() => chain);
    chain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve(
        table === "workflow_templates"
          ? { count: opts.templateCount, data: null, error: null }
          : { data: opts.dismissed, error: null }
      ).then(resolve);
    return chain;
  });
  return { supabase: { from } as unknown as McpContext["supabase"], userId: "u" };
}

describe("noWorkflowInstruction", () => {
  it("asks the agent to suggest a workflow and stop when templates exist", async () => {
    const text = await noWorkflowInstruction(ctxWith({ templateCount: 3, dismissed: [] }), "t", "i");
    expect(text).toBe(SUGGEST_WORKFLOW_INSTRUCTION);
    expect(text).toContain("suggest_workflow");
    expect(text).toContain("Do NOT call apply_workflow_template");
  });

  it("falls back to assign-and-start after a dismissed suggestion", async () => {
    const text = await noWorkflowInstruction(
      ctxWith({ templateCount: 3, dismissed: [{ id: "s" }] }),
      "t",
      "i"
    );
    expect(text).toBe(ASSIGN_AND_START_INSTRUCTION);
  });

  it("says there is nothing to suggest on a board with no templates", async () => {
    const text = await noWorkflowInstruction(ctxWith({ templateCount: 0, dismissed: [] }), "t", "i");
    expect(text).toBe(NO_TEMPLATES_PREFIX + ASSIGN_AND_START_INSTRUCTION);
  });
});
