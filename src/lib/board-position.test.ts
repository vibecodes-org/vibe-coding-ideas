import { describe, it, expect } from "vitest";
import { computeTopInsertPosition } from "./board-position";
import { POSITION_GAP } from "@/lib/constants";

describe("computeTopInsertPosition", () => {
  it("returns 0 for an empty column, matching the bottom Add-task fallback", () => {
    expect(computeTopInsertPosition([])).toBe(0);
  });

  it("lands POSITION_GAP below the current lowest position", () => {
    expect(computeTopInsertPosition([1000, 2000, 3000])).toBe(1000 - POSITION_GAP);
  });

  it("uses the minimum regardless of array order", () => {
    expect(computeTopInsertPosition([3000, 500, 2000])).toBe(500 - POSITION_GAP);
  });

  it("handles negative positions", () => {
    expect(computeTopInsertPosition([-500])).toBe(-500 - POSITION_GAP);
  });
});
