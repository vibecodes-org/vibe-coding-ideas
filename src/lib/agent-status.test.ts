import { describe, it, expect } from "vitest";
import { getAgentStatus, type AgentWorkflowStep, type AgentFallbackTask } from "./agent-status";

const NOW = new Date("2026-05-07T12:00:00Z");

function step(overrides: Partial<AgentWorkflowStep> = {}): AgentWorkflowStep {
  return {
    stepId: "step-1",
    stepTitle: "Implementation",
    status: "in_progress",
    startedAt: "2026-05-07T11:55:00Z",
    completedAt: null,
    position: 1000,
    taskId: "task-1",
    taskTitle: "BoardSwitcher growing-pill task",
    ideaId: "idea-1",
    ideaTitle: "VibeCodes",
    runStepsCompleted: 2,
    runStepsTotal: 6,
    ...overrides,
  };
}

const FALLBACK: AgentFallbackTask = {
  taskId: "task-fallback",
  taskTitle: "Migrate staging Supabase project",
  ideaId: "idea-1",
  ideaTitle: "VibeCodes",
  columnTitle: "In Progress",
};

describe("getAgentStatus", () => {
  it("returns 'none' when no steps and no fallback", () => {
    expect(getAgentStatus([], null, NOW)).toEqual({ type: "none" });
  });

  it("returns 'assigned' fallback when no steps but a static assignment exists", () => {
    expect(getAgentStatus([], FALLBACK, NOW)).toEqual({
      type: "assigned",
      taskId: "task-fallback",
      taskTitle: "Migrate staging Supabase project",
      ideaId: "idea-1",
      ideaTitle: "VibeCodes",
      columnTitle: "In Progress",
    });
  });

  it("returns 'pending' for the lowest-position pending step when nothing else is active", () => {
    const result = getAgentStatus(
      [
        step({ stepId: "p2", status: "pending", position: 2000, startedAt: null }),
        step({ stepId: "p1", status: "pending", position: 1000, startedAt: null }),
      ],
      FALLBACK,
      NOW,
    );
    expect(result.type).toBe("pending");
    if (result.type === "pending") expect(result.stepId).toBe("p1");
  });

  it("returns 'active' for an in-progress step started < 2h ago", () => {
    const result = getAgentStatus(
      [step({ status: "in_progress", startedAt: "2026-05-07T11:30:00Z" })],
      null,
      NOW,
    );
    expect(result.type).toBe("active");
    if (result.type === "active") {
      expect(result.stepTitle).toBe("Implementation");
      expect(result.fraction).toEqual({ completed: 2, total: 6 });
    }
  });

  it("returns 'stale' for an in-progress step started >= 2h ago, with rounded age in hours", () => {
    const result = getAgentStatus(
      [step({ status: "in_progress", startedAt: "2026-05-07T07:00:00Z" })], // 5h ago
      null,
      NOW,
    );
    expect(result.type).toBe("stale");
    if (result.type === "stale") expect(result.ageHours).toBe(5);
  });

  it("returns 'approval' (beats stale + active + pending)", () => {
    const result = getAgentStatus(
      [
        step({ stepId: "active", status: "in_progress", startedAt: "2026-05-07T11:00:00Z" }),
        step({ stepId: "approval", status: "awaiting_approval", startedAt: "2026-05-07T10:00:00Z" }),
        step({ stepId: "pending", status: "pending", position: 500, startedAt: null }),
      ],
      FALLBACK,
      NOW,
    );
    expect(result.type).toBe("approval");
    if (result.type === "approval") expect(result.stepId).toBe("approval");
  });

  it("returns 'failed' (beats everything else)", () => {
    const result = getAgentStatus(
      [
        step({ stepId: "fail", status: "failed", completedAt: "2026-05-07T09:00:00Z" }),
        step({ stepId: "approval", status: "awaiting_approval" }),
        step({ stepId: "active", status: "in_progress", startedAt: "2026-05-07T11:30:00Z" }),
      ],
      FALLBACK,
      NOW,
    );
    expect(result.type).toBe("failed");
    if (result.type === "failed") expect(result.stepId).toBe("fail");
  });

  it("picks the most recent failed step when multiple failed", () => {
    const result = getAgentStatus(
      [
        step({ stepId: "older", status: "failed", completedAt: "2026-05-06T10:00:00Z" }),
        step({ stepId: "newer", status: "failed", completedAt: "2026-05-07T11:00:00Z" }),
      ],
      null,
      NOW,
    );
    if (result.type === "failed") expect(result.stepId).toBe("newer");
    else throw new Error("expected failed");
  });

  it("picks the most recently-started active step when multiple in-progress", () => {
    const result = getAgentStatus(
      [
        step({ stepId: "older", status: "in_progress", startedAt: "2026-05-07T11:00:00Z" }),
        step({ stepId: "newer", status: "in_progress", startedAt: "2026-05-07T11:50:00Z" }),
      ],
      null,
      NOW,
    );
    if (result.type === "active") expect(result.stepId).toBe("newer");
    else throw new Error("expected active");
  });

  it("active with no fraction info still returns valid status", () => {
    const result = getAgentStatus(
      [step({ runStepsCompleted: 0, runStepsTotal: 0 })],
      null,
      NOW,
    );
    expect(result.type).toBe("active");
    if (result.type === "active") {
      expect(result.fraction).toEqual({ completed: 0, total: 0 });
    }
  });

  it("ignores in_progress steps with no startedAt (defensive)", () => {
    const result = getAgentStatus(
      [step({ status: "in_progress", startedAt: null })],
      FALLBACK,
      NOW,
    );
    // Falls through to fallback since the in_progress step is skipped
    expect(result.type).toBe("assigned");
  });
});
