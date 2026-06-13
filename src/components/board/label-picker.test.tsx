import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// Radix primitives (Checkbox/Popover) use ResizeObserver, absent in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const addLabelToTask = vi.fn().mockResolvedValue(undefined);
const removeLabelFromTask = vi.fn().mockResolvedValue(undefined);
const checkLabelAutoRuleWorkflow = vi.fn().mockResolvedValue({ hasActiveWorkflow: false });
vi.mock("@/actions/board", () => ({
  addLabelToTask: (...a: unknown[]) => addLabelToTask(...a),
  removeLabelFromTask: (...a: unknown[]) => removeLabelFromTask(...a),
  checkLabelAutoRuleWorkflow: (...a: unknown[]) => checkLabelAutoRuleWorkflow(...a),
  createBoardLabel: vi.fn(),
  updateBoardLabel: vi.fn(),
  deleteBoardLabel: vi.fn(),
}));
vi.mock("@/lib/activity", () => ({ logTaskActivity: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { LabelPicker } from "./label-picker";
import type { BoardLabel } from "@/types";

const labels: BoardLabel[] = [
  { id: "l1", idea_id: "i1", name: "Bug", color: "red", created_at: "" },
  { id: "l2", idea_id: "i1", name: "Feature", color: "blue", created_at: "" },
];

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  checkLabelAutoRuleWorkflow.mockResolvedValue({ hasActiveWorkflow: false });
});

function setup(taskLabels: BoardLabel[] = []) {
  render(
    <LabelPicker boardLabels={labels} taskLabels={taskLabels} taskId="t1" ideaId="i1" currentUserId="u1">
      <button>Open</button>
    </LabelPicker>
  );
  fireEvent.click(screen.getByText("Open")); // open the popover
}

/** Checkboxes render in label order: [0]=Bug, [1]=Feature. */
function checkboxes() {
  return screen.getAllByRole("checkbox");
}

describe("LabelPicker — assign/unassign", () => {
  it("checking an unassigned label updates the UI and persists (add)", async () => {
    setup([]);
    expect(checkboxes()[0]).not.toBeChecked();

    await act(async () => {
      fireEvent.click(checkboxes()[0]);
    });

    expect(checkboxes()[0]).toBeChecked();
    expect(addLabelToTask).toHaveBeenCalledWith("t1", "l1", "i1");
  });

  it("unchecking updates the UI IMMEDIATELY, before the workflow check resolves (the slow-uncheck fix)", async () => {
    // Hold the workflow check open so we can prove the UI didn't wait on it.
    let resolveCheck: (v: { hasActiveWorkflow: boolean }) => void = () => {};
    checkLabelAutoRuleWorkflow.mockReturnValue(
      new Promise((res) => {
        resolveCheck = res;
      })
    );

    setup([labels[0]]); // Bug assigned
    expect(checkboxes()[0]).toBeChecked();

    // Click to uncheck — do NOT await the (pending) workflow check.
    act(() => {
      fireEvent.click(checkboxes()[0]);
    });

    // UI already reflects the uncheck while the check is still pending,
    // and the server removal hasn't fired yet (deferred behind the check).
    expect(checkboxes()[0]).not.toBeChecked();
    expect(removeLabelFromTask).not.toHaveBeenCalled();

    // Resolve the check (no workflow) → removal now persists.
    await act(async () => {
      resolveCheck({ hasActiveWorkflow: false });
    });
    expect(removeLabelFromTask).toHaveBeenCalledWith("t1", "l1", "i1", false);
  });

  it("drops rapid re-clicks on the same label (in-flight guard — no duplicate server call)", async () => {
    setup([]);

    await act(async () => {
      fireEvent.click(checkboxes()[0]);
      fireEvent.click(checkboxes()[0]); // second click while the first is in flight
    });

    expect(addLabelToTask).toHaveBeenCalledTimes(1);
  });
});
