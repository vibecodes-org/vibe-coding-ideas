import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DOCK_INSET_CSS_VAR } from "@/lib/terminal/dock-inset";

import { useDockInset } from "./terminal-dock-inset";

// Captured ResizeObserver callbacks, so a test can simulate the dock changing
// height (expand, collapse, resize drag) without a real layout engine.
let observerCallbacks: ResizeObserverCallback[] = [];
const disconnect = vi.fn();

class StubResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    observerCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect = disconnect;
}

/** jsdom reports every element as 0px tall; fake the dock's rendered height. */
function setDockHeight(node: HTMLElement, px: number) {
  Object.defineProperty(node, "offsetHeight", { configurable: true, value: px });
}

function readInset() {
  return document.documentElement.style.getPropertyValue(DOCK_INSET_CSS_VAR);
}

function Dock({ height }: { height: number }) {
  const ref = useDockInset();
  return (
    <div
      data-testid="dock"
      ref={(node) => {
        if (node) setDockHeight(node, height);
        ref(node);
      }}
    />
  );
}

describe("useDockInset — the dock reserves its own space (card 534d2049)", () => {
  beforeEach(() => {
    observerCallbacks = [];
    disconnect.mockClear();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    window.innerHeight = 900;
    document.documentElement.style.removeProperty(DOCK_INSET_CSS_VAR);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty(DOCK_INSET_CSS_VAR);
  });

  it("publishes the dock's height so the page can keep clear of it", () => {
    render(<Dock height={420} />);
    expect(readInset()).toBe("420px");
  });

  it("reserves for the collapsed bar too — it hid the last card just as well", () => {
    render(<Dock height={33} />);
    expect(readInset()).toBe("33px");
  });

  it("follows the dock as it changes height (resize drag, expand, collapse)", () => {
    const { getByTestId } = render(<Dock height={420} />);
    expect(readInset()).toBe("420px");

    // The user drags the dock taller — a hard-coded reservation would go stale here.
    setDockHeight(getByTestId("dock"), 560);
    act(() => {
      for (const cb of observerCallbacks) cb([], {} as ResizeObserver);
    });
    expect(readInset()).toBe("560px");
  });

  it("gives the space back when the dock goes away", () => {
    const { unmount } = render(<Dock height={420} />);
    expect(readInset()).toBe("420px");

    unmount();
    // Absent, not "0px" — the board falls back to the CSS default and lays
    // out exactly as it did before the dock existed.
    expect(readInset()).toBe("");
    expect(disconnect).toHaveBeenCalled();
  });

  it("still measures once when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Dock height={420} />);
    expect(readInset()).toBe("420px");
  });
});
