import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

// Regression guard for the "label dropdown bug" in the New Task dialog.
//
// History: the Labels picker lives inside a Radix *modal* Dialog.
//  1. It first used the shared <PopoverContent>, which portals to document.body
//     — outside the dialog subtree — so the dialog's pointer-events lock swallowed
//     clicks and the checkboxes were unclickable.
//  2. The "fix" rendered a non-portal Radix <Popover.Content> in-tree, but a
//     Radix Popover focus-scope inside a modal Dialog caused an infinite
//     focus/layout-effect loop (React #185, "Maximum update depth exceeded") the
//     moment you interacted with it.
//
// Final fix: a PLAIN in-tree dropdown (no Radix Popover, no FocusScope). These
// tests open the dropdown and actually toggle a label — the interaction that
// crashed under the Radix version — asserting it renders in-tree and toggles
// cleanly (single-fire), with no render loop.

// Radix primitives (Checkbox) use ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("./board-context", () => ({
  useBoardOps: () => ({
    createTask: vi.fn(() => vi.fn()),
    incrementPendingOps: vi.fn(),
    decrementPendingOps: vi.fn(),
  }),
}));

vi.mock("@/actions/board", () => ({
  createBoardTask: vi.fn(),
  addLabelsToTask: vi.fn(),
}));

vi.mock("@/actions/ai", () => ({
  enhanceTaskDescription: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/activity", () => ({
  logTaskActivity: vi.fn(),
}));

vi.mock("./assignee-select", () => ({
  AssigneeSelect: () => null,
}));

import { TaskEditDialog } from "./task-edit-dialog";
import type { BoardLabel } from "@/types";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const labels: BoardLabel[] = [
  { id: "label-1", idea_id: "idea-1", name: "Bug", color: "red", created_at: "2026-01-01T00:00:00Z" },
  { id: "label-2", idea_id: "idea-1", name: "Feature", color: "blue", created_at: "2026-01-01T00:00:00Z" },
];

function setup() {
  render(
    <TaskEditDialog
      open
      onOpenChange={vi.fn()}
      ideaId="idea-1"
      columnId="col-1"
      teamMembers={[]}
      boardLabels={labels}
      currentUserId="user-1"
    />
  );
}

function openLabelDropdown() {
  fireEvent.click(screen.getByRole("button", { name: /Select labels/i }));
}

/** The modal Dialog's content element. */
function getDialogContent() {
  return document.querySelector<HTMLElement>("[data-slot='dialog-content']")!;
}

describe("TaskEditDialog — Labels dropdown (plain dropdown, no Radix Popover)", () => {
  it("opens the dropdown and renders the label options in-tree", () => {
    setup();
    openLabelDropdown();

    const dialogContent = getDialogContent();
    expect(dialogContent).not.toBeNull();
    // Options live INSIDE the dialog subtree (so clicks reach them), not in a portal.
    expect(within(dialogContent).getByText("Bug")).toBeInTheDocument();
    expect(within(dialogContent).getByText("Feature")).toBeInTheDocument();
    expect(document.querySelector("[data-radix-portal]")).toBeNull();
  });

  it("toggles a label on/off via the row — single fire, no render loop (guards React #185)", () => {
    setup();
    openLabelDropdown();

    const dialogContent = getDialogContent();
    // The row IS the checkbox (role=checkbox, aria-checked) — no Radix Checkbox,
    // whose Presence indicator looped when toggled inside the modal Dialog.
    const bugRow = within(dialogContent).getByText("Bug").closest("[role='checkbox']") as HTMLElement;
    expect(bugRow).not.toBeNull();
    expect(bugRow).not.toBeChecked();

    // The interaction that crashed (Maximum update depth) before this fix.
    fireEvent.click(bugRow);
    expect(bugRow).toBeChecked(); // one click selects (single fire — no double-toggle)

    fireEvent.click(bugRow);
    expect(bugRow).not.toBeChecked(); // toggles back off
  });

  it("renders one checkbox row per label, in-tree", () => {
    setup();
    openLabelDropdown();

    const dialogContent = getDialogContent();
    expect(within(dialogContent).getAllByRole("checkbox")).toHaveLength(labels.length);
  });
});
