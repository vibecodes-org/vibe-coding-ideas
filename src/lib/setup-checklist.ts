/**
 * Derives the "Getting set up" checklist state for the merged dashboard.
 *
 * Replaces the old first-run-vs-standard `computeIsActivated` fork: instead of
 * deciding *which* dashboard to render, we always render the standard dashboard
 * and surface a self-completing checklist of the remaining setup steps. The
 * checklist auto-hides when every step is done.
 *
 * Each step's `done` flag is derived independently from real signals (no
 * sequential AND-chain, no localStorage escape hatch). Notably the
 * "first task moved" step is based on genuine board progress — a `moved`
 * activity row exists on one of the user's ideas — NOT on the human-assigned
 * `tasks.length` (audit F3.4). A `moved` row is logged whether the move was
 * made by a human in the UI or by an agent via MCP `move_task`, so it ticks
 * honestly the first time any task progresses past its starting column.
 */

export type SetupStepId = "account" | "idea" | "board" | "mcp" | "first-task";

export interface SetupStep {
  id: SetupStepId;
  label: string;
  done: boolean;
}

export interface SetupSignals {
  /** Always true on the dashboard — the user is authenticated. */
  hasAccount?: boolean;
  /** User owns at least one idea. */
  hasIdea: boolean;
  /** At least one of the user's ideas has a board with tasks. */
  hasBoardWithTasks: boolean;
  /** MCP connected (users.mcp_connected_at is set). */
  hasMcpConnection: boolean;
  /**
   * A board task has actually moved (any `moved` activity row on the user's
   * ideas, by a human or an agent). Real progress — not human task assignment.
   */
  hasTaskMoved: boolean;
}

/**
 * Build the ordered checklist. The "first task moved" step is optional in the
 * sense that it only contributes to completion once the prior signals exist;
 * it is always included because the `moved` signal is reliably derivable.
 */
export function computeSetupSteps(signals: SetupSignals): SetupStep[] {
  return [
    { id: "account", label: "Account created", done: signals.hasAccount ?? true },
    { id: "idea", label: "Create an idea", done: signals.hasIdea },
    { id: "board", label: "Generate a board", done: signals.hasBoardWithTasks },
    { id: "mcp", label: "Connect Claude Code", done: signals.hasMcpConnection },
    { id: "first-task", label: "Watch your first task move", done: signals.hasTaskMoved },
  ];
}

/** Count of completed steps. */
export function countDoneSteps(steps: SetupStep[]): number {
  return steps.filter((s) => s.done).length;
}

/** True when every step is complete — the checklist should auto-hide. */
export function isSetupComplete(steps: SetupStep[]): boolean {
  return steps.every((s) => s.done);
}
