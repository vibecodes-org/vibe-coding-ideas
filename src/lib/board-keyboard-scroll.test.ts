import { describe, it, expect } from "vitest";
import {
  boardArrowScrollDelta,
  BOARD_ARROW_SCROLL_STEP_PX,
  ARROW_KEY_OWNER_SELECTOR,
  type ArrowKeyContext,
} from "./board-keyboard-scroll";

const base: ArrowKeyContext = {
  key: "ArrowRight",
  hasModifier: false,
  targetOwnsArrows: false,
  isDragging: false,
  canScrollSideways: true,
};

describe("boardArrowScrollDelta", () => {
  it("Right moves one column right, Left one column left", () => {
    expect(boardArrowScrollDelta(base)).toBe(BOARD_ARROW_SCROLL_STEP_PX);
    expect(boardArrowScrollDelta({ ...base, key: "ArrowLeft" })).toBe(-BOARD_ARROW_SCROLL_STEP_PX);
  });

  it("ignores every other key, including Up/Down (those scroll the page natively)", () => {
    for (const key of ["ArrowUp", "ArrowDown", "PageDown", "Home", "End", "a", " "]) {
      expect(boardArrowScrollDelta({ ...base, key })).toBe(0);
    }
  });

  it("stays out of the way when the focused element owns arrow keys (text caret, tabs, menus…)", () => {
    expect(boardArrowScrollDelta({ ...base, targetOwnsArrows: true })).toBe(0);
  });

  it("does nothing during a keyboard drag — arrows move the dragged card", () => {
    expect(boardArrowScrollDelta({ ...base, isDragging: true })).toBe(0);
  });

  it("does nothing with a modifier held — those are shortcuts", () => {
    expect(boardArrowScrollDelta({ ...base, hasModifier: true })).toBe(0);
  });

  it("does nothing when every column already fits on screen", () => {
    expect(boardArrowScrollDelta({ ...base, canScrollSideways: false })).toBe(0);
  });
});

describe("ARROW_KEY_OWNER_SELECTOR", () => {
  it("matches the controls whose arrow keys must not be hijacked", () => {
    const cases: Array<[string, boolean]> = [
      ['<input type="text">', true],
      ["<textarea></textarea>", true],
      ['<div contenteditable="true"></div>', true],
      ['<button role="tab"></button>', true],
      ['<div role="dialog"><button id="t"></button></div>', true],
      ['<div role="menu"><div role="menuitem" id="t"></div></div>', true],
      ['<div class="xterm"><textarea id="t"></textarea></div>', true],
      ["<button></button>", false],
      ["<a href='#'></a>", false],
      ['<div role="button"></div>', false],
    ];
    for (const [html, expected] of cases) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const target = (wrapper.querySelector("#t") ?? wrapper.firstElementChild) as HTMLElement;
      expect(!!target.closest(ARROW_KEY_OWNER_SELECTOR), html).toBe(expected);
    }
  });
});
