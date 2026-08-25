import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// Coverage for the "Allow the unarchiving of tasks" card: the ⋯ menu shows
// Unarchive (not Archive) on an archived task, Archive (not Unarchive) on a
// live one, hides the Move items once archived (dragging is already disabled),
// and the unarchive optimistic-update/rollback/toast recipe mirrors Archive's.

// Radix DropdownMenu uses ResizeObserver / PointerEvent APIs jsdom lacks parts of.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const updateBoardTask = vi.fn();
const deleteBoardTask = vi.fn();
const moveBoardTask = vi.fn();
vi.mock("@/actions/board", () => ({
  updateBoardTask: (...args: unknown[]) => updateBoardTask(...args),
  deleteBoardTask: (...args: unknown[]) => deleteBoardTask(...args),
  moveBoardTask: (...args: unknown[]) => moveBoardTask(...args),
}));

const convertTaskToDiscussion = vi.fn();
vi.mock("@/actions/discussions", () => ({
  convertTaskToDiscussion: (...args: unknown[]) => convertTaskToDiscussion(...args),
}));

const logTaskActivity = vi.fn();
vi.mock("@/lib/activity", () => ({
  logTaskActivity: (...args: unknown[]) => logTaskActivity(...args),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("./board-launch-context", () => ({
  useBoardLaunch: () => null, // no launch entry point rendered in these tests
}));

const archiveTask = vi.fn();
const unarchiveTask = vi.fn();
const trustMove = vi.fn();
const trustRemoval = vi.fn();
const incrementPendingOps = vi.fn();
const decrementPendingOps = vi.fn();
vi.mock("./board-context", () => ({
  useBoardOps: () => ({
    archiveTask: (...args: unknown[]) => archiveTask(...args),
    unarchiveTask: (...args: unknown[]) => unarchiveTask(...args),
    trustMove: (...args: unknown[]) => trustMove(...args),
    trustRemoval: (...args: unknown[]) => trustRemoval(...args),
    incrementPendingOps,
    decrementPendingOps,
  }),
}));

import { TaskCardMenu } from "./task-card-menu";
import type { BoardTaskWithAssignee } from "@/types";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  updateBoardTask.mockResolvedValue(undefined);
});

function makeTask(overrides: Partial<BoardTaskWithAssignee> = {}): BoardTaskWithAssignee {
  return {
    id: "task-1",
    idea_id: "idea-1",
    column_id: "col-1",
    title: "Fix relay reconnect",
    description: null,
    position: 1000,
    assignee_id: null,
    due_date: null,
    archived: false,
    attachment_count: 0,
    comment_count: 0,
    cover_image_path: null,
    workflow_step_total: 0,
    workflow_step_completed: 0,
    workflow_step_in_progress: 0,
    workflow_step_failed: 0,
    workflow_step_awaiting_approval: 0,
    workflow_step_started_at: null,
    working_started_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    assignee: null,
    labels: [],
    ...overrides,
  } as unknown as BoardTaskWithAssignee;
}

function setup(task: BoardTaskWithAssignee) {
  render(
    <TaskCardMenu
      task={task}
      ideaId="idea-1"
      columnId="col-1"
      currentUserId="user-1"
      columnTasks={[{ id: "task-1", position: 1000 }, { id: "task-2", position: 2000 }]}
    />
  );
  const trigger = screen.getByRole("button", { name: /task actions/i });
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.click(trigger);
}

describe("TaskCardMenu — archive/unarchive", () => {
  it("shows Archive (not Unarchive) and the Move items on a live task", () => {
    setup(makeTask({ archived: false }));

    expect(screen.getByRole("menuitem", { name: /^archive$/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /unarchive/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /move to top/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /move to bottom/i })).toBeInTheDocument();
  });

  it("shows Unarchive (not Archive) and hides the Move items on an archived task", () => {
    setup(makeTask({ archived: true }));

    expect(screen.getByRole("menuitem", { name: /unarchive/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /move to top/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /move to bottom/i })).not.toBeInTheDocument();
  });

  it("unarchiving fires the optimistic update, trusts the flip, and logs activity", async () => {
    setup(makeTask({ archived: true, position: 1000 }));

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /unarchive/i }));
    });

    expect(unarchiveTask).toHaveBeenCalledWith("task-1", "col-1");
    // Local flip must win over a lagging Realtime snapshot the way trustMove
    // protects a move — same column/position, archived flipped to false.
    expect(trustMove).toHaveBeenCalledWith("task-1", "col-1", 1000, false);
    expect(updateBoardTask).toHaveBeenCalledWith("task-1", "idea-1", { archived: false });

    await Promise.resolve();
    await Promise.resolve();

    expect(logTaskActivity).toHaveBeenCalledWith("task-1", "idea-1", "user-1", "unarchived");
  });

  it("rolls back and toasts on unarchive failure", async () => {
    const rollback = vi.fn();
    unarchiveTask.mockReturnValue(rollback);
    updateBoardTask.mockRejectedValue(new Error("network error"));

    setup(makeTask({ archived: true, position: 1000 }));

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /unarchive/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rollback).toHaveBeenCalledTimes(1);
    // Rejected unarchive: stop trusting the flip entirely.
    expect(trustMove).toHaveBeenLastCalledWith("task-1", "col-1", null);
    expect(toastError).toHaveBeenCalledWith("Couldn't unarchive task");
  });
});
