import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const OLD = "run-old";
const NEW = "run-new";

function step(id: string, run: string, order: number, status: string, createdAt: string, title: string) {
  return {
    id, run_id: run, task_id: "task-1", idea_id: "idea-1", title, status,
    step_order: order, position: order * 1000, created_at: createdAt,
    agent_role: null, bot_id: null, output: null, comment_count: 0,
    human_check_required: false, model_tier: null, executed_model: null, tier_honored: null,
  };
}

const STEPS = [
  step("o1", OLD, 1, "completed", "2026-10-19T10:00:00Z", "Old plan"),
  step("o2", OLD, 2, "failed", "2026-10-19T10:00:00Z", "Old build"),
  step("n1", NEW, 1, "pending", "2026-10-21T05:40:00Z", "New plan"),
  step("n2", NEW, 2, "failed", "2026-10-21T05:40:00Z", "New build"),
  step("n3", NEW, 3, "pending", "2026-10-21T05:40:00Z", "New review"),
  step("n4", NEW, 4, "pending", "2026-10-21T05:40:00Z", "New release"),
];
const RUNS = [
  { id: NEW, task_id: "task-1", status: "running", created_at: "2026-10-21T05:40:00Z", workflow_templates: { name: "Feature Development" } },
  { id: OLD, task_id: "task-1", status: "failed", created_at: "2026-10-19T10:00:00Z", workflow_templates: { name: "Bug Fix" } },
];

vi.mock("@/lib/supabase/client", () => {
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
  return {
    createClient: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => {
            const data = table === "task_workflow_steps" ? STEPS : RUNS;
            const p = Promise.resolve({ data, error: null });
            return Object.assign(p, { order: () => Promise.resolve({ data, error: null }) });
          },
        }),
      }),
      channel: () => channel,
    }),
  };
});
vi.mock("@/actions/workflow", () => ({
  approveWorkflowStep: vi.fn(), retryWorkflowStep: vi.fn(), startWorkflowStep: vi.fn(),
  failWorkflowStep: vi.fn(), skipWorkflowStep: vi.fn(), resetWorkflow: vi.fn(), removeWorkflow: vi.fn(),
}));
vi.mock("@/actions/workflow-templates", () => ({
  applyWorkflowTemplate: vi.fn(), listWorkflowTemplates: vi.fn().mockResolvedValue([]),
  rematchWorkflowAgents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./workflow-suggestion-panel", () => ({ WorkflowSuggestionPanel: () => null }));
vi.mock("./step-detail-dialog", () => ({
  StepDetailDialog: (p: { step: { title: string }; isReadOnly?: boolean; allSteps?: unknown[] }) => (
    <div data-testid="dialog" data-readonly={String(!!p.isReadOnly)} data-count={p.allSteps?.length}>{p.step.title}</div>
  ),
}));
vi.mock("./kanban-board", async () => {
  const { createContext } = await import("react");
  return {
    TaskAutoOpenContext: createContext({ autoOpenTaskId: undefined, autoOpenStepId: undefined, onAutoOpenConsumed: () => {} }),
  };
});

import { TaskWorkflowSection } from "./task-workflow-section";

describe("TaskWorkflowSection - current run only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows only the live run's steps and counts, with earlier runs closed", async () => {
    render(<TaskWorkflowSection taskId="task-1" ideaId="idea-1" />);
    await screen.findByText("New plan");
    expect(screen.getByText("0 of 4 steps completed")).toBeInTheDocument();
    expect(screen.queryByText("Old plan")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /1 earlier run/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("opens earlier runs read-only: rows shown, no Retry, read-only dialog", async () => {
    render(<TaskWorkflowSection taskId="task-1" ideaId="idea-1" />);
    await screen.findByText("New plan");
    // live failed step has a Retry button
    expect(screen.getAllByRole("button", { name: /Retry/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /1 earlier run/ }));
    expect(screen.getByText("Old build")).toBeInTheDocument();
    expect(screen.getByText(/Run 1 · Bug Fix · started 19 Oct/)).toBeInTheDocument();
    expect(screen.getByText("1 of 2 steps completed")).toBeInTheDocument();
    // still only the live Retry
    expect(screen.getAllByRole("button", { name: /Retry/ })).toHaveLength(1);
    fireEvent.click(screen.getByText("Old build"));
    const dlg = await screen.findByTestId("dialog");
    expect(dlg).toHaveAttribute("data-readonly", "true");
    expect(dlg).toHaveAttribute("data-count", "2");
  });

  it("opens a live step with the live run's steps only", async () => {
    render(<TaskWorkflowSection taskId="task-1" ideaId="idea-1" />);
    fireEvent.click(await screen.findByText("New build"));
    const dlg = await screen.findByTestId("dialog");
    expect(dlg).toHaveAttribute("data-readonly", "false");
    expect(dlg).toHaveAttribute("data-count", "4");
  });

  it("mentions earlier runs in the Remove confirmation", async () => {
    render(<TaskWorkflowSection taskId="task-1" ideaId="idea-1" />);
    await screen.findByText("New plan");
    fireEvent.pointerDown(screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-ellipsis, svg.lucide-more-horizontal"))!, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByText("Remove Workflow"));
    await waitFor(() =>
      expect(screen.getByText(/including 1 earlier run\. You can apply/)).toBeInTheDocument()
    );
  });
});
