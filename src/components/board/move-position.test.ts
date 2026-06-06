import { describe, it, expect } from "vitest";
import {
  computeWithinColumnMove,
  canMoveToTop,
  canMoveToBottom,
} from "./move-position";
import { POSITION_GAP } from "@/lib/constants";

const tasks = (...positions: number[]) =>
  positions.map((position, i) => ({ id: `t${i}`, position }));

describe("computeWithinColumnMove", () => {
  describe("move to top", () => {
    it("moves a middle task above the current first", () => {
      const result = computeWithinColumnMove(tasks(0, 1000, 2000), "t2", "top");
      expect(result).toEqual({
        newPosition: 0 - POSITION_GAP,
        orderedIds: ["t2", "t0", "t1"],
      });
    });

    it("moves the last task to the top", () => {
      const result = computeWithinColumnMove(tasks(0, 1000), "t1", "top");
      expect(result).toEqual({
        newPosition: -POSITION_GAP,
        orderedIds: ["t1", "t0"],
      });
    });

    it("returns null when the task is already first", () => {
      expect(computeWithinColumnMove(tasks(0, 1000, 2000), "t0", "top")).toBeNull();
    });

    it("sorts unsorted input before computing", () => {
      // Same tasks, supplied out of position order.
      const unsorted = [
        { id: "t2", position: 2000 },
        { id: "t0", position: 0 },
        { id: "t1", position: 1000 },
      ];
      const result = computeWithinColumnMove(unsorted, "t1", "top");
      expect(result).toEqual({
        newPosition: -POSITION_GAP,
        orderedIds: ["t1", "t0", "t2"],
      });
    });
  });

  describe("move to bottom", () => {
    it("moves a middle task below the current last", () => {
      const result = computeWithinColumnMove(tasks(0, 1000, 2000), "t0", "bottom");
      expect(result).toEqual({
        newPosition: 2000 + POSITION_GAP,
        orderedIds: ["t1", "t2", "t0"],
      });
    });

    it("returns null when the task is already last", () => {
      expect(
        computeWithinColumnMove(tasks(0, 1000, 2000), "t2", "bottom")
      ).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("returns null for an empty column", () => {
      expect(computeWithinColumnMove([], "t0", "top")).toBeNull();
      expect(computeWithinColumnMove([], "t0", "bottom")).toBeNull();
    });

    it("returns null for a single-card column", () => {
      expect(computeWithinColumnMove(tasks(0), "t0", "top")).toBeNull();
      expect(computeWithinColumnMove(tasks(0), "t0", "bottom")).toBeNull();
    });

    it("returns null when the task is not in the column", () => {
      expect(computeWithinColumnMove(tasks(0, 1000), "missing", "top")).toBeNull();
      expect(
        computeWithinColumnMove(tasks(0, 1000), "missing", "bottom")
      ).toBeNull();
    });
  });
});

describe("canMoveToTop / canMoveToBottom", () => {
  it("disables both at the edges of a two-card column", () => {
    const t = tasks(0, 1000); // t0 first, t1 last
    expect(canMoveToTop(t, "t0")).toBe(false);
    expect(canMoveToBottom(t, "t0")).toBe(true);
    expect(canMoveToTop(t, "t1")).toBe(true);
    expect(canMoveToBottom(t, "t1")).toBe(false);
  });

  it("disables both for a single-card column", () => {
    const t = tasks(0);
    expect(canMoveToTop(t, "t0")).toBe(false);
    expect(canMoveToBottom(t, "t0")).toBe(false);
  });
});
