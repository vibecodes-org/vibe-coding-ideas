import { describe, it, expect } from "vitest";
import {
  computeSetupSteps,
  countDoneSteps,
  isSetupComplete,
  type SetupSignals,
} from "./setup-checklist";

const allFalse: SetupSignals = {
  hasIdea: false,
  hasBoardWithTasks: false,
  hasMcpConnection: false,
  hasTaskMoved: false,
};

describe("computeSetupSteps", () => {
  it("always marks Account as done (user is authenticated)", () => {
    const steps = computeSetupSteps(allFalse);
    const account = steps.find((s) => s.id === "account");
    expect(account?.done).toBe(true);
  });

  it("respects an explicit hasAccount=false override", () => {
    const steps = computeSetupSteps({ ...allFalse, hasAccount: false });
    expect(steps.find((s) => s.id === "account")?.done).toBe(false);
  });

  it("produces five steps in stable order", () => {
    const steps = computeSetupSteps(allFalse);
    expect(steps.map((s) => s.id)).toEqual([
      "account",
      "idea",
      "board",
      "mcp",
      "first-task",
    ]);
  });

  it("marks idea step done only when the user has an idea", () => {
    expect(computeSetupSteps(allFalse).find((s) => s.id === "idea")?.done).toBe(false);
    expect(
      computeSetupSteps({ ...allFalse, hasIdea: true }).find((s) => s.id === "idea")?.done
    ).toBe(true);
  });

  it("marks board step done only when a board has tasks", () => {
    expect(
      computeSetupSteps(allFalse).find((s) => s.id === "board")?.done
    ).toBe(false);
    expect(
      computeSetupSteps({ ...allFalse, hasBoardWithTasks: true }).find(
        (s) => s.id === "board"
      )?.done
    ).toBe(true);
  });

  it("marks MCP step done only when MCP is connected", () => {
    expect(
      computeSetupSteps(allFalse).find((s) => s.id === "mcp")?.done
    ).toBe(false);
    expect(
      computeSetupSteps({ ...allFalse, hasMcpConnection: true }).find(
        (s) => s.id === "mcp"
      )?.done
    ).toBe(true);
  });

  describe("first-task signal (F3.4 fix)", () => {
    it("is NOT done when no task has moved, even if a board has tasks", () => {
      // A freshly AI-generated board has tasks but nothing has moved yet —
      // the step must not falsely tick (the old human-task-count bug).
      const steps = computeSetupSteps({
        ...allFalse,
        hasIdea: true,
        hasBoardWithTasks: true,
        hasTaskMoved: false,
      });
      expect(steps.find((s) => s.id === "first-task")?.done).toBe(false);
    });

    it("is done when a task has moved (by a human or an agent)", () => {
      const steps = computeSetupSteps({ ...allFalse, hasTaskMoved: true });
      expect(steps.find((s) => s.id === "first-task")?.done).toBe(true);
    });

    it("does not depend on assigned-task count — only on real movement", () => {
      // Tasks assigned to the user/agents but never moved => still not done.
      const steps = computeSetupSteps({
        ...allFalse,
        hasBoardWithTasks: true,
        hasMcpConnection: true,
        hasTaskMoved: false,
      });
      expect(steps.find((s) => s.id === "first-task")?.done).toBe(false);
    });
  });
});

describe("countDoneSteps", () => {
  it("counts only completed steps (account always counts)", () => {
    expect(countDoneSteps(computeSetupSteps(allFalse))).toBe(1);
  });

  it("counts all five when everything is done", () => {
    const steps = computeSetupSteps({
      hasIdea: true,
      hasBoardWithTasks: true,
      hasMcpConnection: true,
      hasTaskMoved: true,
    });
    expect(countDoneSteps(steps)).toBe(5);
  });
});

describe("isSetupComplete", () => {
  it("is false while any step is incomplete", () => {
    expect(isSetupComplete(computeSetupSteps(allFalse))).toBe(false);
    expect(
      isSetupComplete(
        computeSetupSteps({
          hasIdea: true,
          hasBoardWithTasks: true,
          hasMcpConnection: true,
          hasTaskMoved: false,
        })
      )
    ).toBe(false);
  });

  it("is true only when every step is done — drives auto-hide", () => {
    expect(
      isSetupComplete(
        computeSetupSteps({
          hasIdea: true,
          hasBoardWithTasks: true,
          hasMcpConnection: true,
          hasTaskMoved: true,
        })
      )
    ).toBe(true);
  });
});
