import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { useHiddenLinkedTaskNotice } from "./use-hidden-linked-task-notice";
import type { BoardColumnWithTasks } from "@/types";

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const col = (ids: string[]) =>
  [{ id: "c1", tasks: ids.map((id) => ({ id })) }] as unknown as BoardColumnWithTasks[];

const onClear = vi.fn();

describe("useHiddenLinkedTaskNotice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the message once even when the board updates repeatedly", () => {
    const onShown = vi.fn();
    const onClearFilters = vi.fn();
    const { rerender } = renderHook((p) => useHiddenLinkedTaskNotice(p), {
      initialProps: {
        autoOpenTaskId: "t1" as string | undefined,
        columns: col(["t1", "t2"]),
        filteredColumns: col(["t2"]),
        onShown,
        onClearFilters,
      },
    });
    // Simulate the parent not yet dropping the link, and many board updates.
    for (let i = 0; i < 5; i++) {
      rerender({
        autoOpenTaskId: "t1",
        columns: col(["t1", "t2", `n${i}`]),
        filteredColumns: col(["t2"]),
        onShown,
        onClearFilters,
      });
    }
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the linked card is visible", () => {
    renderHook(() =>
      useHiddenLinkedTaskNotice({
        autoOpenTaskId: "t1",
        columns: col(["t1"]),
        filteredColumns: col(["t1"]),
        onShown: vi.fn(),
        onClearFilters: vi.fn(),
      })
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("Clear filters passes the card id back so it can be opened", () => {
    renderHook(() =>
      useHiddenLinkedTaskNotice({
        autoOpenTaskId: "t1",
        columns: col(["t1"]),
        filteredColumns: col([]),
        onShown: vi.fn(),
        onClearFilters: onClear,
      })
    );
    const opts = vi.mocked(toast.info).mock.calls[0][1] as unknown as { action: { onClick: () => void } };
    opts.action.onClick();
    expect(onClear).toHaveBeenCalledWith("t1");
  });
});
