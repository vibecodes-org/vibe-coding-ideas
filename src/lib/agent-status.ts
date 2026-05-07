/**
 * Resolves an agent's current status for the dashboard "My Agents" panel.
 *
 * Mirrors the board's getWorkflowStatus() priority order so the panel and
 * the board task cards always agree on what an agent is doing.
 */

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export interface AgentWorkflowStep {
  stepId: string;
  stepTitle: string;
  status: "pending" | "in_progress" | "failed" | "awaiting_approval";
  startedAt: string | null;
  completedAt: string | null;
  position: number;
  taskId: string;
  taskTitle: string;
  ideaId: string;
  ideaTitle: string;
  runStepsCompleted: number;
  runStepsTotal: number;
}

export interface AgentFallbackTask {
  taskId: string;
  taskTitle: string;
  ideaId: string;
  ideaTitle: string;
  columnTitle: string;
}

interface BaseStatus {
  taskId: string;
  taskTitle: string;
  ideaId: string;
  ideaTitle: string;
}

interface StatusWithStep extends BaseStatus {
  stepId: string;
  stepTitle: string;
  fraction: { completed: number; total: number };
}

export type AgentStatus =
  | (StatusWithStep & { type: "failed"; failedAt: string | null })
  | (StatusWithStep & { type: "approval"; submittedAt: string | null })
  | (StatusWithStep & { type: "stale"; startedAt: string; ageHours: number })
  | (StatusWithStep & { type: "active"; startedAt: string })
  | (StatusWithStep & { type: "pending" })
  | (BaseStatus & { type: "assigned"; columnTitle: string })
  | { type: "none" };

export function getAgentStatus(
  steps: AgentWorkflowStep[],
  fallback: AgentFallbackTask | null,
  now: Date = new Date(),
): AgentStatus {
  const stepBase = (s: AgentWorkflowStep): StatusWithStep => ({
    stepId: s.stepId,
    stepTitle: s.stepTitle,
    taskId: s.taskId,
    taskTitle: s.taskTitle,
    ideaId: s.ideaId,
    ideaTitle: s.ideaTitle,
    fraction: { completed: s.runStepsCompleted, total: s.runStepsTotal },
  });

  // Most-recent-first by a given timestamp; missing timestamps sort last.
  const byTimestampDesc = (key: "completedAt" | "startedAt") =>
    (a: AgentWorkflowStep, b: AgentWorkflowStep) =>
      (b[key] ?? "").localeCompare(a[key] ?? "");

  const failed = steps
    .filter((s) => s.status === "failed")
    .sort(byTimestampDesc("completedAt"));
  if (failed[0]) {
    return { ...stepBase(failed[0]), type: "failed", failedAt: failed[0].completedAt };
  }

  const approval = steps
    .filter((s) => s.status === "awaiting_approval")
    .sort(byTimestampDesc("startedAt"));
  if (approval[0]) {
    return { ...stepBase(approval[0]), type: "approval", submittedAt: approval[0].startedAt };
  }

  const inProgress = steps
    .filter((s) => s.status === "in_progress" && s.startedAt)
    .sort(byTimestampDesc("startedAt"));
  if (inProgress[0]) {
    const startedAt = inProgress[0].startedAt!;
    const elapsedMs = now.getTime() - new Date(startedAt).getTime();
    if (elapsedMs >= STALE_THRESHOLD_MS) {
      const ageHours = Math.floor(elapsedMs / (60 * 60 * 1000));
      return { ...stepBase(inProgress[0]), type: "stale", startedAt, ageHours };
    }
    return { ...stepBase(inProgress[0]), type: "active", startedAt };
  }

  // For pending we want the lowest-position step in any active run (the
  // next thing this agent will pick up).
  const pending = steps
    .filter((s) => s.status === "pending")
    .sort((a, b) => a.position - b.position);
  if (pending[0]) {
    return { ...stepBase(pending[0]), type: "pending" };
  }

  if (fallback) {
    return {
      type: "assigned",
      taskId: fallback.taskId,
      taskTitle: fallback.taskTitle,
      ideaId: fallback.ideaId,
      ideaTitle: fallback.ideaTitle,
      columnTitle: fallback.columnTitle,
    };
  }

  return { type: "none" };
}
