import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Deferred promise helper — lets tests control exactly when a "server call"
// resolves/rejects, so multiple concurrent creates can be interleaved.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const createTaskAtTop = vi.fn();
const incrementPendingOps = vi.fn();
const decrementPendingOps = vi.fn();

vi.mock("./board-context", () => ({
  useBoardOps: () => ({
    createTaskAtTop,
    incrementPendingOps,
    decrementPendingOps,
  }),
}));

const createBoardTaskAtTop = vi.fn();
vi.mock("@/actions/board", () => ({
  createBoardTaskAtTop: (...args: unknown[]) => createBoardTaskAtTop(...args),
}));

const logTaskActivity = vi.fn();
vi.mock("@/lib/activity", () => ({
  logTaskActivity: (...args: unknown[]) => logTaskActivity(...args),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { BoardQuickAdd } from "./board-quick-add";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  createTaskAtTop.mockImplementation(() => vi.fn());
});

function setup(existingPositions: number[] = [1000, 2000], onClose = vi.fn()) {
  render(
    <BoardQuickAdd
      columnId="col-1"
      columnTitle="In Progress"
      ideaId="idea-1"
      currentUserId="user-1"
      existingPositions={existingPositions}
      onClose={onClose}
    />
  );
  return { onClose };
}

function getTextarea() {
  return screen.getByRole("textbox", { name: /Add task to top of In Progress/i });
}

describe("BoardQuickAdd", () => {
  it("creates a task at the top on Enter and clears the field for rapid multi-add", async () => {
    createBoardTaskAtTop.mockResolvedValue("real-id");
    setup();

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Fix the flicker" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(createTaskAtTop).toHaveBeenCalledWith(
      "col-1",
      expect.objectContaining({ title: "Fix the flicker", position: 1000 - 1000, column_id: "col-1" })
    );

    await waitFor(() => expect(createBoardTaskAtTop).toHaveBeenCalledWith("idea-1", "col-1", "Fix the flicker"));
    await waitFor(() => expect(logTaskActivity).toHaveBeenCalledWith("real-id", "idea-1", "user-1", "created"));

    // Composer clears but stays open, ready for another add
    expect((getTextarea() as HTMLTextAreaElement).value).toBe("");
  });

  it("falls back to position 0 for an empty column", () => {
    setup([]);
    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "First task" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(createTaskAtTop).toHaveBeenCalledWith("col-1", expect.objectContaining({ position: 0 }));
  });

  it("does not submit on Enter with an empty or whitespace-only title", () => {
    setup();
    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(createTaskAtTop).not.toHaveBeenCalled();
  });

  it("Escape closes immediately and discards typed text, no exceptions", () => {
    const { onClose } = setup();
    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Some unsaved text" } });
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createTaskAtTop).not.toHaveBeenCalled();
  });

  it("rolls back, toasts, and re-opens pre-filled with a Retry affordance on failure", async () => {
    const rollback = vi.fn();
    createTaskAtTop.mockImplementation(() => rollback);
    createBoardTaskAtTop.mockRejectedValue(new Error("boom"));
    setup();

    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Will fail" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith("Failed to create task");

    // Text is restored, not lost
    expect((getTextarea() as HTMLTextAreaElement).value).toBe("Will fail");
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn.t create the task/);
  });

  it("only rolls back the failing create when several are in flight at once", async () => {
    const rollbackA = vi.fn();
    const rollbackB = vi.fn();
    const deferredA = deferred<string>();
    const deferredB = deferred<string>();

    createTaskAtTop.mockImplementationOnce(() => rollbackA).mockImplementationOnce(() => rollbackB);
    createBoardTaskAtTop.mockImplementationOnce(() => deferredA.promise).mockImplementationOnce(() => deferredB.promise);

    setup();
    const textarea = getTextarea();

    // Fire off two creates back-to-back before either resolves
    fireEvent.change(textarea, { target: { value: "Task A" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.change(textarea, { target: { value: "Task B" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(createTaskAtTop).toHaveBeenCalledTimes(2);

    // A fails, B succeeds
    deferredA.reject(new Error("boom"));
    deferredB.resolve("task-b-id");

    await waitFor(() => expect(rollbackA).toHaveBeenCalledTimes(1));
    expect(rollbackB).not.toHaveBeenCalled();
  });

  it("closes immediately on outside click when there is no unsaved text", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the composer open once with a hint on outside click with unsaved text, then discards on the second", () => {
    const { onClose } = setup();
    const textarea = getTextarea();
    fireEvent.change(textarea, { target: { value: "Don't lose me" } });

    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Press Esc again to discard/i)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
