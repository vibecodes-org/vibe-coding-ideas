import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcut } from "./use-keyboard-shortcut";

function fireKeydown(opts: { key: string; metaKey?: boolean; ctrlKey?: boolean; target?: HTMLElement }) {
  const event = new KeyboardEvent("keydown", {
    key: opts.key,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target) {
    Object.defineProperty(event, "target", { value: opts.target, configurable: true });
    opts.target.dispatchEvent(event);
  } else {
    window.dispatchEvent(event);
  }
  return event;
}

describe("useKeyboardShortcut", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fires the handler on Cmd+B", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+b", handler));

    fireKeydown({ key: "b", metaKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires the handler on Ctrl+B", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+b", handler));

    fireKeydown({ key: "b", ctrlKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("preventDefault is called", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+b", handler));

    const event = fireKeydown({ key: "b", metaKey: true });

    expect(event.defaultPrevented).toBe(true);
  });

  it("does NOT fire on plain B (no modifier)", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+b", handler));

    fireKeydown({ key: "b" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire when typing in an input", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+b", handler));

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKeydown({ key: "b", metaKey: true, target: input });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire when typing in a textarea", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+b", handler));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireKeydown({ key: "b", metaKey: true, target: textarea });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire on contenteditable", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcut("mod+b", handler));

    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    fireKeydown({ key: "b", metaKey: true, target: div });

    expect(handler).not.toHaveBeenCalled();
  });

  it("cleans up the listener on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcut("mod+b", handler));

    unmount();
    fireKeydown({ key: "b", metaKey: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the latest handler when the handler reference changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ h }: { h: () => void }) => useKeyboardShortcut("mod+b", h),
      { initialProps: { h: first } }
    );

    rerender({ h: second });
    fireKeydown({ key: "b", metaKey: true });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
