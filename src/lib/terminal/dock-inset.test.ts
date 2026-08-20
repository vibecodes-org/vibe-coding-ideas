import { describe, expect, it } from "vitest";

import { DOCK_INSET_CSS_VAR, MIN_BOARD_VISIBLE_PX, resolveDockInset } from "./dock-inset";

describe("resolveDockInset", () => {
  it("reports a normal dock height as px", () => {
    expect(resolveDockInset(420, 1000)).toBe("420px");
  });

  it("rounds sub-pixel measurements (ResizeObserver reports fractions)", () => {
    expect(resolveDockInset(419.6, 1000)).toBe("420px");
    expect(resolveDockInset(419.2, 1000)).toBe("419px");
  });

  it("reserves nothing when the dock is absent or unmeasured", () => {
    // The board must be unchanged from its pre-dock behaviour, not broken.
    expect(resolveDockInset(0, 1000)).toBe("0px");
    expect(resolveDockInset(-50, 1000)).toBe("0px");
    expect(resolveDockInset(Number.NaN, 1000)).toBe("0px");
    expect(resolveDockInset(Number.POSITIVE_INFINITY, 1000)).toBe("0px");
  });

  it("covers the collapsed bar too — it steals board space even when shut", () => {
    // Collapsed the dock is still ~33px of fixed overlay. Reserving for it is
    // the whole point: those pixels hid the last card just as effectively.
    expect(resolveDockInset(33, 1000)).toBe("33px");
  });

  it("never lets a bad measurement swallow the whole viewport", () => {
    expect(resolveDockInset(5000, 800)).toBe(`${800 - MIN_BOARD_VISIBLE_PX}px`);
  });

  it("clamps to zero rather than negative on a tiny viewport", () => {
    expect(resolveDockInset(400, 60)).toBe("0px");
  });

  it("trusts the measurement when the viewport is unknown", () => {
    // SSR / pre-mount: 0 means "no idea how tall the window is", and a
    // measurement we do have is better than discarding it.
    expect(resolveDockInset(420, 0)).toBe("420px");
    expect(resolveDockInset(420, Number.NaN)).toBe("420px");
  });

  it("does not collide with the dock's own body-height variable", () => {
    // --vc-term-dock-h is the resizable BODY; this one is the TOTAL footprint.
    // Two different numbers — reusing one name would under-reserve by the
    // height of the dock's chrome.
    expect(DOCK_INSET_CSS_VAR).toBe("--vc-term-dock-inset");
    expect(DOCK_INSET_CSS_VAR).not.toBe("--vc-term-dock-h");
  });
});
