import { describe, it, expect } from "vitest";
import { TOTAL_STEPS, indicatorIndex } from "./onboarding-steps";

describe("onboarding step counter", () => {
  it("has 5 counted steps", () => {
    expect(TOTAL_STEPS).toBe(5);
  });

  it("maps Welcome and Profile to their own indicator slots", () => {
    expect(indicatorIndex(0)).toBe(0); // Welcome
    expect(indicatorIndex(1)).toBe(1); // Profile
  });

  it("treats the Project form, creating, and board-ready recap as one counted step", () => {
    // internal step 2 (form/creating) and step 3 (board-ready recap) both map to Project
    expect(indicatorIndex(2)).toBe(2);
    expect(indicatorIndex(3)).toBe(2);
  });

  it("maps Connect and Done to the final two slots", () => {
    expect(indicatorIndex(4)).toBe(3); // Connect Claude Code
    expect(indicatorIndex(5)).toBe(4); // Done
  });

  it("never returns an index outside the counted range", () => {
    for (let step = 0; step <= 5; step++) {
      const idx = indicatorIndex(step);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(TOTAL_STEPS);
    }
  });

  it("falls back to the first slot for unexpected values", () => {
    expect(indicatorIndex(-1)).toBe(0);
    expect(indicatorIndex(99)).toBe(0);
  });
});
