import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";

// Regression guard for the existing-task LabelPicker (task 84c7ff4a).
//
// History: a prior fix (2553eb2) corrected the toggle LOGIC but kept the Radix
// <Checkbox> — whose Presence-based indicator double-fires / loops (React #185,
// "Maximum update depth exceeded") when this picker renders inside the modal
// task-detail Dialog. It passed unit tests yet failed in the live browser, so it
// was reverted. The real fix mirrors the New Task dialog: the ROW owns the toggle
// (role=checkbox, single fire) with a plain check indicator — no Radix Checkbox.
//
// These tests render the picker in its in-dialog mode and actually toggle a label
// — the interaction that crashed — and pin the two behavioural fixes:
//  - uncheck updates the UI BEFORE the workflow check resolves (was "slow uncheck")
//  - a per-label in-flight guard drops a rapid second click (was the duplicate-add
//    "Failed to update label" race).

// Radix primitives use ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const addLabelToTask = vi.fn();
const removeLabelFromTask = vi.fn();
const checkLabelAutoRuleWorkflow = vi.fn();

vi.mock("@/actions/board", () => ({
  addLabelToTask: (...args: unknown[]) => addLabelToTask(...args),
  removeLabelFromTask: (...args: unknown[]) => removeLabelFromTask(...args),
  checkLabelAutoRuleWorkflow: (...args: unknown[]) => checkLabelAutoRuleWorkflow(...args),
  createBoardLabel: vi.fn(),
  updateBoardLabel: vi.fn(),
  deleteBoardLabel: vi.fn(),
}));

vi.mock("@/lib/activity", () => ({
  logTaskActivity: vi.fn(),
}));

import { LabelPicker } from "./label-picker";
import type { BoardLabel } from "@/types";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  addLabelToTask.mockResolvedValue(undefined);
  removeLabelFromTask.mockResolvedValue(undefined);
  checkLabelAutoRuleWorkflow.mockResolvedValue({ hasActiveWorkflow: false });
});

const labels: BoardLabel[] = [
  { id: "label-1", idea_id: "idea-1", name: "Bug", color: "red", created_at: "2026-01-01T00:00:00Z" },
  { id: "label-2", idea_id: "idea-1", name: "Feature", color: "blue", created_at: "2026-01-01T00:00:00Z" },
];

function setup(taskLabels: BoardLabel[] = []) {
  render(
    <LabelPicker
      boardLabels={labels}
      taskLabels={taskLabels}
      taskId="task-1"
      ideaId="idea-1"
      currentUserId="user-1"
      inDialog
    >
      <button>Open labels</button>
    </LabelPicker>
  );
  fireEvent.click(screen.getByRole("button", { name: /Open labels/i }));
}

function row(name: string): HTMLElement {
  return screen.getByText(name).closest("[role='checkbox']") as HTMLElement;
}

describe("LabelPicker — existing-task toggle (row owns the toggle, no Radix Checkbox)", () => {
  it("toggles a label on via the row — single fire, no render loop (guards React #185)", async () => {
    setup();
    const bug = row("Bug");
    expect(bug).not.toBeChecked();

    // The interaction that crashed (Maximum update depth) before the fix.
    await act(async () => {
      fireEvent.click(bug);
    });

    expect(bug).toBeChecked(); // one click selects (single fire — no double-toggle)
    expect(addLabelToTask).toHaveBeenCalledTimes(1);
    expect(addLabelToTask).toHaveBeenCalledWith("task-1", "label-1", "idea-1");
  });

  it("uncheck updates the UI BEFORE the workflow check resolves (was the slow-uncheck bug)", async () => {
    // Hold the workflow check open so we can assert the UI moved without waiting on it.
    let resolveCheck: (v: { hasActiveWorkflow: boolean }) => void = () => {};
    checkLabelAutoRuleWorkflow.mockImplementation(
      () => new Promise((res) => { resolveCheck = res; })
    );

    setup([labels[0]]); // Bug starts assigned
    const bug = row("Bug");
    expect(bug).toBeChecked();

    fireEvent.click(bug);

    // UI is already unchecked even though checkLabelAutoRuleWorkflow has NOT resolved.
    expect(bug).not.toBeChecked();
    expect(checkLabelAutoRuleWorkflow).toHaveBeenCalledTimes(1);

    // No active workflow → plain removal persists after the check resolves.
    await act(async () => {
      resolveCheck({ hasActiveWorkflow: false });
    });
    expect(removeLabelFromTask).toHaveBeenCalledWith("task-1", "label-1", "idea-1", false);
  });

  it("preserves an in-flight toggle when a piecemeal Realtime echo resyncs props (board flakiness)", async () => {
    let resolveAdd: () => void = () => {};
    addLabelToTask.mockImplementation(() => new Promise<void>((res) => { resolveAdd = res; }));

    const el = (taskLabels: BoardLabel[]) => (
      <LabelPicker
        boardLabels={labels}
        taskLabels={taskLabels}
        taskId="task-1"
        ideaId="idea-1"
        currentUserId="user-1"
        inDialog
      >
        <button>Open labels</button>
      </LabelPicker>
    );

    const { rerender } = render(el([]));
    fireEvent.click(screen.getByRole("button", { name: /Open labels/i }));

    // Start adding Feature — still in flight (add promise unresolved).
    fireEvent.click(row("Feature"));
    expect(row("Feature")).toBeChecked();

    // A piecemeal echo lands for an UNRELATED label (Bug added elsewhere) while
    // Feature's add hasn't echoed back yet. The old code reset localLabelIds to
    // the server set [Bug] and Feature flickered off — this is the board bug.
    await act(async () => {
      rerender(el([labels[0]]));
    });

    expect(row("Feature")).toBeChecked(); // pending intent preserved
    expect(row("Bug")).toBeChecked();     // server truth merged in

    await act(async () => { resolveAdd(); });
  });

  it("in-flight guard drops a rapid second click — no duplicate add", async () => {
    let resolveAdd: () => void = () => {};
    addLabelToTask.mockImplementation(() => new Promise<void>((res) => { resolveAdd = res; }));

    setup();
    const bug = row("Bug");

    fireEvent.click(bug); // starts the add (still in flight)
    fireEvent.click(bug); // rapid re-click — must be dropped

    expect(addLabelToTask).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAdd();
    });
  });
});
