import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

// Regression guard for the "label dropdown bug" (see the Reproduce & Investigate
// step). The Labels Popover lives inside a Radix *modal* Dialog. Previously it
// used the shared <PopoverContent>, which ALWAYS wraps its children in a Radix
// Portal. Because a portalled popover escapes the dialog's DOM subtree, the
// dialog's `pointer-events` lock swallowed clicks on the label checkboxes,
// making them unclickable. The fix renders the popover content in-tree (no
// Portal), mirroring LabelPicker's `inDialog` path. These tests assert the
// content mounts inside the dialog subtree (so clicks reach it) rather than in
// a portal at the document root.

// Radix Popover positioning relies on ResizeObserver, which jsdom lacks.
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

function openLabelPopover() {
  fireEvent.click(screen.getByRole("button", { name: /Select labels/i }));
}

/** The modal Dialog's content element (it owns the pointer-events lock). */
function getDialogContent() {
  return document.querySelector<HTMLElement>("[data-slot='dialog-content']")!;
}

describe("TaskEditDialog — Labels popover (in-dialog, no-portal regression)", () => {
  it("renders the label options when the popover opens", () => {
    setup();
    openLabelPopover();
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
  });

  it("renders the popover content INSIDE the dialog subtree, not in a Radix portal", () => {
    setup();
    openLabelPopover();

    const dialogContent = getDialogContent();
    expect(dialogContent).not.toBeNull();

    // Core regression guard: the popover content (and its label rows) must live
    // within the dialog content subtree. If it were portalled to document.body,
    // the dialog's pointer-events lock would swallow clicks on the checkboxes.
    expect(within(dialogContent).getByText("Bug")).toBeInTheDocument();
    expect(within(dialogContent).getByText("Feature")).toBeInTheDocument();

    // And it must NOT have been portalled out by the shared PopoverContent.
    expect(document.querySelector("[data-radix-portal]")).toBeNull();
  });

  it("renders a real checkbox per label, reachable for pointer events inside the dialog", () => {
    setup();
    openLabelPopover();

    const dialogContent = getDialogContent();
    const checkboxes = within(dialogContent).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(labels.length);

    // The row is the click target (onClick toggles selection). It must not be
    // pointer-events-disabled — that is what the portal regression caused.
    for (const checkbox of checkboxes) {
      const row = checkbox.closest("div");
      expect(row).not.toBeNull();
      expect(row).toHaveClass("cursor-pointer");
    }
  });
});
