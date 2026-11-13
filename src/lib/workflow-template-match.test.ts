import { describe, it, expect } from "vitest";
import { planReshape, matchRunStepsToTemplate, type RunStepForMatch } from "./workflow-template-match";
import type { WorkflowTemplateStep } from "@/types/database";

function run(id: string, title: string, status: string, order: number, over: Partial<RunStepForMatch> = {}): RunStepForMatch {
  return {
    id,
    status,
    step_order: order,
    position: (order - 1) * 1000,
    title,
    description: null,
    agent_role: "Dev",
    human_check_required: false,
    expected_deliverables: [],
    model_tier: null,
    effort_override: null,
    untouched: status === "pending",
    ...over,
  };
}
function tpl(title: string, role = "Dev", extra: Partial<WorkflowTemplateStep> = {}): WorkflowTemplateStep {
  return { title, role, ...extra } as WorkflowTemplateStep;
}

describe("planReshape", () => {
  it("removes an untouched step and adds a new one after the frontier (acceptance 1)", () => {
    const r = [run("a", "A", "completed", 1), run("b", "B", "in_progress", 2), run("c", "C", "pending", 3), run("d", "D", "pending", 4)];
    const p = planReshape(r, [tpl("A"), tpl("B"), tpl("X", "Security"), tpl("D")]);
    expect(p.deletes).toEqual(["c"]);
    expect(p.inserts.map((i) => [i.title, i.step_order, i.position])).toEqual([["X", 3, 2000]]);
    expect(p.updates).toEqual([]);
    expect(p.keptRemoved).toEqual([]);
  });

  it("renumbers later waiting steps when one is added before them", () => {
    const r = [run("a", "A", "completed", 1), run("d", "D", "pending", 2)];
    const p = planReshape(r, [tpl("A"), tpl("X", "Security"), tpl("D")]);
    expect(p.inserts.map((i) => [i.title, i.step_order])).toEqual([["X", 2]]);
    expect(p.updates.map((u) => [u.id, u.step_order, u.position])).toEqual([["d", 3, 2000]]);
  });

  it("keeps a removed step that has a comment and reports it (acceptance 2)", () => {
    const r = [run("a", "A", "completed", 1), run("b", "B", "in_progress", 2), run("c", "C", "pending", 3, { untouched: false }), run("d", "D", "pending", 4)];
    const p = planReshape(r, [tpl("A"), tpl("B"), tpl("X", "Security"), tpl("D")]);
    expect(p.deletes).toEqual([]);
    expect(p.keptRemoved).toEqual([{ id: "c", title: "C" }]);
    expect(p.inserts.map((i) => i.title)).toEqual(["X"]);
    const orders = [...p.inserts.map((i) => i.step_order), ...p.updates.map((u) => u.step_order)];
    expect(new Set(orders).size).toBe(orders.length);
    // kept C is right after the frontier, before X
    expect(p.updates.find((u) => u.id === "c")).toBeUndefined();
    expect(p.inserts[0].step_order).toBe(4);
    expect(p.updates.find((u) => u.id === "d")?.step_order).toBe(5);
  });

  it("does not turn a waiting step into a copy of a done one on reorder (acceptance 3)", () => {
    const r = [run("a", "A", "completed", 1), run("b", "B", "pending", 2), run("c", "C", "pending", 3)];
    const p = planReshape(r, [tpl("B"), tpl("A"), tpl("C")]);
    expect(p.updates).toEqual([]);
    expect(p.inserts).toEqual([]);
    expect(p.deletes).toEqual([]);
    expect(p.unchanged).toBe(true);
  });

  it("updates a renamed waiting step in place, keeping its id (acceptance 4)", () => {
    const r = [run("a", "A", "completed", 1), run("b", "Build it", "pending", 2), run("c", "C", "pending", 3)];
    const p = planReshape(r, [tpl("A"), tpl("Build the thing"), tpl("C")]);
    expect(p.updates.map((u) => [u.id, u.title])).toEqual([["b", "Build the thing"]]);
    expect(p.inserts).toEqual([]);
    expect(p.deletes).toEqual([]);
  });

  it("does not add a new step placed before work already done (acceptance 5)", () => {
    const r = [run("a", "A", "completed", 1), run("b", "B", "completed", 2), run("c", "C", "pending", 3)];
    const p = planReshape(r, [tpl("A"), tpl("New"), tpl("B"), tpl("C")]);
    expect(p.inserts).toEqual([]);
    expect(p.unchanged).toBe(true);
  });

  it.each(["in_progress", "awaiting_approval", "completed", "failed", "skipped"])(
    "never changes a %s step (acceptance 6)",
    (status) => {
      const r = [run("a", "Old A", status, 1, { agent_role: "Planner", untouched: false }), run("b", "B", "pending", 2)];
      const p = planReshape(r, [tpl("Completely new", "Other"), tpl("B"), tpl("Z")]);
      expect([...p.updates.map((u) => u.id), ...p.deletes]).not.toContain("a");
      expect(p.updates.every((u) => u.step_order > 1)).toBe(true);
      expect(p.inserts.every((i) => i.step_order > 1)).toBe(true);
    }
  );

  it("writes nothing when the template did not really change (acceptance 7)", () => {
    const r = [run("a", "A", "completed", 1), run("b", "B", "pending", 2, { description: "d", expected_deliverables: ["x"] })];
    const p = planReshape(r, [tpl("A"), tpl("B", "Dev", { description: "d", deliverables: ["x"] })]);
    expect(p.unchanged).toBe(true);
  });

  it("clears the agent only when the role changes", () => {
    const r = [run("a", "A", "pending", 1), run("b", "B", "pending", 2)];
    const p = planReshape(r, [tpl("A", "QA"), tpl("B", "Dev", { description: "new" })]);
    expect(p.updates.find((u) => u.id === "a")?.clear_agent).toBe(true);
    expect(p.updates.find((u) => u.id === "b")?.clear_agent).toBe(false);
  });

  it("only gives content updates to pending steps before the frontier", () => {
    const r = [run("a", "A", "pending", 1), run("b", "B", "completed", 2, { untouched: false }), run("c", "C", "pending", 3)];
    const p = planReshape(r, [tpl("A", "Dev", { description: "new" }), tpl("B"), tpl("C")]);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0]).toMatchObject({ id: "a", step_order: 1, position: 0 });
    expect(p.deletes).toEqual([]);
  });

  it("handles duplicate titles in order", () => {
    const r = [run("a", "Review", "completed", 1), run("b", "Review", "pending", 2)];
    const p = planReshape(r, [tpl("Review"), tpl("Review")]);
    expect(p.unchanged).toBe(true);
  });

  it("handles an empty run", () => {
    const p = planReshape([], [tpl("A")]);
    expect(p.inserts.map((i) => [i.title, i.step_order])).toEqual([["A", 1]]);
  });

  it("records the snapshot of ids and statuses", () => {
    const p = planReshape([run("a", "A", "completed", 1), run("b", "B", "pending", 2)], [tpl("A"), tpl("B")]);
    expect(p.snapshot).toEqual([
      { id: "a", status: "completed" },
      { id: "b", status: "pending" },
    ]);
  });
});

describe("matchRunStepsToTemplate", () => {
  it("pairs a rename in a different-sized gap only by unique role", () => {
    const m = matchRunStepsToTemplate(
      [
        { title: "A", agent_role: "Dev" },
        { title: "Old", agent_role: "QA" },
        { title: "Z", agent_role: "Dev" },
      ],
      [tpl("A"), tpl("New", "QA"), tpl("Extra", "Ops"), tpl("Z")]
    );
    expect(m.get(1)).toBe(1);
  });
});
