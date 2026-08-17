// Drag-to-resize handle + hook (card b885ebfd) — exercised through a tiny host
// component so the real pointer/keyboard wiring, the CSS variable on the root
// and the localStorage persistence are all covered end-to-end in jsdom.

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useDockHeight, TerminalDockResizeHandle, DOCK_HEIGHT_CSS_VAR } from "./terminal-dock-resize";
import {
  DOCK_HEIGHT_KEY,
  DOCK_HEIGHT_KEY_STEP_PX,
  MIN_DOCK_HEIGHT_PX,
  defaultDockHeight,
  maxDockHeight,
} from "@/lib/terminal/dock-height";

const VH = 1000;

function Host() {
  const controller = useDockHeight();
  return (
    <div data-testid="root" style={controller.rootStyle}>
      <TerminalDockResizeHandle controller={controller} />
      <span data-testid="height">{controller.height ?? "null"}</span>
      <span data-testid="dragging">{String(controller.dragging)}</span>
    </div>
  );
}

const rootVar = () =>
  (screen.getByTestId("root") as HTMLElement).style.getPropertyValue(DOCK_HEIGHT_CSS_VAR);
const handle = () => screen.getByTestId("terminal-dock-resize-handle");
const heightText = () => screen.getByTestId("height").textContent;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerHeight", { value: VH, configurable: true, writable: true });
  // jsdom has no pointer-capture implementation — stub the three methods the handle uses.
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});
afterEach(() => {
  cleanup();
});

describe("useDockHeight — hydration + CSS variable", () => {
  it("uses the default (38vh) after mount when nothing is stored, and exposes it as the CSS variable", () => {
    render(<Host />);
    expect(heightText()).toBe(String(defaultDockHeight(VH)));
    expect(rootVar()).toBe(`${defaultDockHeight(VH)}px`);
  });
  it("hydrates a stored preference on mount", () => {
    window.localStorage.setItem(DOCK_HEIGHT_KEY, "520");
    render(<Host />);
    expect(heightText()).toBe("520");
    expect(rootVar()).toBe("520px");
  });
  it("clamps a stored preference to the live viewport, and restores it when the window grows back", () => {
    window.localStorage.setItem(DOCK_HEIGHT_KEY, "700");
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true, writable: true });
    render(<Host />);
    expect(heightText()).toBe(String(maxDockHeight(600)));
    act(() => {
      Object.defineProperty(window, "innerHeight", { value: VH, configurable: true, writable: true });
      window.dispatchEvent(new Event("resize"));
    });
    expect(heightText()).toBe("700");
    // The stored preference itself was never overwritten by the clamp.
    expect(window.localStorage.getItem(DOCK_HEIGHT_KEY)).toBe("700");
  });
});

describe("TerminalDockResizeHandle — pointer drag", () => {
  it("dragging up makes the panel taller with live feedback, and persists once on release", () => {
    render(<Host />);
    const start = defaultDockHeight(VH);
    fireEvent.pointerDown(handle(), { clientY: 500, button: 0, pointerId: 1, pointerType: "mouse" });
    expect(screen.getByTestId("dragging").textContent).toBe("true");
    fireEvent.pointerMove(handle(), { clientY: 450, pointerId: 1 });
    expect(heightText()).toBe(String(start + 50));
    // Not persisted mid-drag.
    expect(window.localStorage.getItem(DOCK_HEIGHT_KEY)).toBeNull();
    fireEvent.pointerMove(handle(), { clientY: 400, pointerId: 1 });
    expect(heightText()).toBe(String(start + 100));
    fireEvent.pointerUp(handle(), { clientY: 400, pointerId: 1 });
    expect(screen.getByTestId("dragging").textContent).toBe("false");
    expect(window.localStorage.getItem(DOCK_HEIGHT_KEY)).toBe(String(start + 100));
    expect(rootVar()).toBe(`${start + 100}px`);
  });
  it("dragging down makes it shorter and never below the minimum", () => {
    render(<Host />);
    fireEvent.pointerDown(handle(), { clientY: 500, button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(handle(), { clientY: 5000, pointerId: 1 });
    expect(heightText()).toBe(String(MIN_DOCK_HEIGHT_PX));
    fireEvent.pointerUp(handle(), { clientY: 5000, pointerId: 1 });
    expect(window.localStorage.getItem(DOCK_HEIGHT_KEY)).toBe(String(MIN_DOCK_HEIGHT_PX));
  });
  it("never grows past the viewport cap (the board above always stays visible)", () => {
    render(<Host />);
    fireEvent.pointerDown(handle(), { clientY: 500, button: 0, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(handle(), { clientY: -5000, pointerId: 1 });
    expect(heightText()).toBe(String(maxDockHeight(VH)));
  });
  it("ignores a right-click drag", () => {
    render(<Host />);
    fireEvent.pointerDown(handle(), { clientY: 500, button: 2, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(handle(), { clientY: 400, pointerId: 1 });
    expect(heightText()).toBe(String(defaultDockHeight(VH)));
  });
  it("a pointer move with no drag in flight does nothing", () => {
    render(<Host />);
    fireEvent.pointerMove(handle(), { clientY: 100, pointerId: 1 });
    expect(heightText()).toBe(String(defaultDockHeight(VH)));
  });
});

describe("TerminalDockResizeHandle — keyboard + reset + a11y", () => {
  it("ArrowUp/ArrowDown nudge by the step (Shift ×4), Home/End jump to the bounds, all persisted", () => {
    render(<Host />);
    const start = defaultDockHeight(VH);
    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    expect(heightText()).toBe(String(start + DOCK_HEIGHT_KEY_STEP_PX));
    expect(window.localStorage.getItem(DOCK_HEIGHT_KEY)).toBe(String(start + DOCK_HEIGHT_KEY_STEP_PX));
    fireEvent.keyDown(handle(), { key: "ArrowDown", shiftKey: true });
    expect(heightText()).toBe(String(start + DOCK_HEIGHT_KEY_STEP_PX - 4 * DOCK_HEIGHT_KEY_STEP_PX));
    fireEvent.keyDown(handle(), { key: "End" });
    expect(heightText()).toBe(String(maxDockHeight(VH)));
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(heightText()).toBe(String(MIN_DOCK_HEIGHT_PX));
    expect(window.localStorage.getItem(DOCK_HEIGHT_KEY)).toBe(String(MIN_DOCK_HEIGHT_PX));
  });
  it("double-click resets to the default and forgets the stored preference", () => {
    window.localStorage.setItem(DOCK_HEIGHT_KEY, "520");
    render(<Host />);
    expect(heightText()).toBe("520");
    fireEvent.doubleClick(handle());
    expect(heightText()).toBe(String(defaultDockHeight(VH)));
    expect(window.localStorage.getItem(DOCK_HEIGHT_KEY)).toBeNull();
  });
  it("is an ARIA separator with live value bounds", () => {
    render(<Host />);
    const h = handle();
    expect(h.getAttribute("role")).toBe("separator");
    expect(h.getAttribute("aria-orientation")).toBe("horizontal");
    expect(h.getAttribute("aria-valuemin")).toBe(String(MIN_DOCK_HEIGHT_PX));
    expect(h.getAttribute("aria-valuemax")).toBe(String(maxDockHeight(VH)));
    expect(h.getAttribute("aria-valuenow")).toBe(String(defaultDockHeight(VH)));
    expect(h.getAttribute("tabindex")).toBe("0");
  });
});
