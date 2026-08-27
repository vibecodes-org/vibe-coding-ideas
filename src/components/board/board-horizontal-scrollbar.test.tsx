import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { BoardHorizontalScrollbar } from "./board-horizontal-scrollbar";

// jsdom has no layout, so scrollWidth/clientWidth are always 0. Pin them on
// the real row so the component sees a genuinely overflowing (or not) board.
function makeRow(scrollWidth: number, clientWidth: number) {
  const row = document.createElement("div");
  Object.defineProperty(row, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(row, "clientWidth", { value: clientWidth, configurable: true });
  document.body.appendChild(row);
  return row;
}

describe("BoardHorizontalScrollbar", () => {
  let row: HTMLDivElement;
  afterEach(() => row.remove());

  it("mirrors the row's scrollable width and is visible when the board overflows", () => {
    row = makeRow(3000, 1200);
    const ref = createRef<HTMLDivElement>();
    ref.current = row;

    const { getByTestId } = render(<BoardHorizontalScrollbar scrollContainerRef={ref} />);
    const proxy = getByTestId("board-horizontal-scrollbar");

    expect(proxy.className).not.toContain("invisible");
    expect((proxy.firstElementChild as HTMLElement).style.width).toBe("3000px");
  });

  it("hides itself when every column already fits", () => {
    row = makeRow(1000, 1200);
    const ref = createRef<HTMLDivElement>();
    ref.current = row;

    const { getByTestId } = render(<BoardHorizontalScrollbar scrollContainerRef={ref} />);
    expect(getByTestId("board-horizontal-scrollbar").className).toContain("invisible");
  });

  it("stays pinned above the terminal dock via the shared inset variable", () => {
    row = makeRow(3000, 1200);
    const ref = createRef<HTMLDivElement>();
    ref.current = row;

    const { getByTestId } = render(<BoardHorizontalScrollbar scrollContainerRef={ref} />);
    const proxy = getByTestId("board-horizontal-scrollbar");
    expect(proxy.className).toContain("sticky");
    expect(proxy.style.bottom).toBe("var(--vc-term-dock-inset, 0px)");
  });

  describe("two-way scroll sync", () => {
    beforeEach(() => {
      row = makeRow(3000, 1200);
    });

    it("dragging the proxy moves the real row", () => {
      const ref = createRef<HTMLDivElement>();
      ref.current = row;
      const { getByTestId } = render(<BoardHorizontalScrollbar scrollContainerRef={ref} />);
      const proxy = getByTestId("board-horizontal-scrollbar");

      proxy.scrollLeft = 640;
      fireEvent.scroll(proxy);

      expect(row.scrollLeft).toBe(640);
    });

    it("scrolling the real row (trackpad / drag edge-scroll) moves the proxy", () => {
      const ref = createRef<HTMLDivElement>();
      ref.current = row;
      const { getByTestId } = render(<BoardHorizontalScrollbar scrollContainerRef={ref} />);
      const proxy = getByTestId("board-horizontal-scrollbar");

      act(() => {
        row.scrollLeft = 480;
        row.dispatchEvent(new Event("scroll"));
      });

      expect(proxy.scrollLeft).toBe(480);
    });
  });
});
