import { describe, it, expect } from "vitest";
import {
  computeTopInsertPosition,
  computeBottomInsertPosition,
  computeAdjacentInsertPosition,
  rebalanceColumnPositions,
  PositionGapExhaustedError,
} from "./board-position";
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

describe("computeBottomInsertPosition", () => {
  it("returns 0 for an empty column", () => {
    expect(computeBottomInsertPosition([])).toBe(0);
  });

  it("lands POSITION_GAP above the current highest position", () => {
    expect(computeBottomInsertPosition([1000, 2000, 3000])).toBe(3000 + POSITION_GAP);
  });

  it("uses the maximum regardless of array order", () => {
    expect(computeBottomInsertPosition([3000, 500, 2000])).toBe(3000 + POSITION_GAP);
  });

  it("handles negative positions", () => {
    expect(computeBottomInsertPosition([-500, -2000])).toBe(-500 + POSITION_GAP);
  });
});

describe("computeAdjacentInsertPosition", () => {
  it("splits the gap to the next-lower sibling when placing 'before'", () => {
    // Column: [1000, 2000, 3000]; place before the 2000 task.
    expect(computeAdjacentInsertPosition(2000, "before", [1000, 3000])).toBe(1500);
  });

  it("steps a full POSITION_GAP below when the sibling is first, placing 'before'", () => {
    expect(computeAdjacentInsertPosition(1000, "before", [2000, 3000])).toBe(1000 - POSITION_GAP);
  });

  it("splits the gap to the next-higher sibling when placing 'after'", () => {
    // Column: [1000, 2000, 3000]; place after the 2000 task.
    expect(computeAdjacentInsertPosition(2000, "after", [1000, 3000])).toBe(2500);
  });

  it("steps a full POSITION_GAP above when the sibling is last, placing 'after'", () => {
    expect(computeAdjacentInsertPosition(3000, "after", [1000, 2000])).toBe(3000 + POSITION_GAP);
  });

  it("ignores positions on the wrong side of the sibling", () => {
    // Only 500 is below 2000, so "before" should split against it, not 3000.
    expect(computeAdjacentInsertPosition(2000, "before", [500, 3000])).toBe(1250);
  });

  it("throws PositionGapExhaustedError instead of returning a fractional position once the gap is too small to split", () => {
    // Splitting 1000/2000 gives 1500, then 1500/2000 gives 1750, then
    // 1750/2000 gives 1875, then 1875/2000 gives 1937 (floored) ... the old
    // implementation kept dividing forever and eventually produced a
    // non-integer that Postgres would silently round on write. The fixed
    // version refuses to produce a value once the two neighbors are only 1
    // apart — nothing whole fits strictly between them.
    expect(() => computeAdjacentInsertPosition(1000, "before", [999])).toThrow(
      PositionGapExhaustedError
    );
  });

  it("never returns a fractional position, even for an odd-integer gap", () => {
    // 1000/1003 has no exact integer midpoint (1001.5) — the fixed
    // implementation must floor it to a whole number strictly between them.
    const result = computeAdjacentInsertPosition(1003, "before", [1000]);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThan(1000);
    expect(result).toBeLessThan(1003);
  });
});

describe("computeAdjacentInsertPosition + rebalanceColumnPositions — repeated same-spot inserts", () => {
  // Regression coverage for the exact bug QA found: computeAdjacentInsertPosition
  // used to do plain float division ((siblingPosition + neighbor) / 2) with no
  // integer floor and no rebalancing. Splitting the same gap over and over
  // (e.g. an agent workflow repeatedly inserting a new step "before" the
  // current first pending step) narrows it geometrically — 1500, 1250, 1125,
  // 1062.5, ... — until Postgres silently rounds a fractional position on
  // write and it collides with an existing sibling, reproducing the exact
  // "positions collide, order becomes arbitrary" failure this whole position
  // scheme was built to eliminate.
  //
  // This simulates a real caller (mirrors what `resolveMovePosition` in
  // mcp-server/src/tools/board-write.ts does): try the split, and on
  // PositionGapExhaustedError, rebalance the column and retry against the
  // fresh, evenly-spaced positions.
  function insertBeforeWithRebalance(
    columnOrder: string[], // task ids, in current display order
    positions: Map<string, number>,
    siblingId: string,
    newTaskId: string
  ): { columnOrder: string[]; positions: Map<string, number>; rebalanced: boolean } {
    const siblingPosition = positions.get(siblingId)!;
    const otherIds = columnOrder.filter((id) => id !== siblingId);
    const otherPositions = otherIds.map((id) => positions.get(id)!);

    let newPosition: number;
    let nextOrder = columnOrder;
    let nextPositions = positions;
    let rebalanced = false;

    try {
      newPosition = computeAdjacentInsertPosition(siblingPosition, "before", otherPositions);
    } catch (err) {
      if (!(err instanceof PositionGapExhaustedError)) throw err;
      rebalanced = true;

      const rebalancedPositions = rebalanceColumnPositions(columnOrder);
      nextPositions = rebalancedPositions;
      const rebalancedSiblingPosition = rebalancedPositions.get(siblingId)!;
      const rebalancedOtherPositions = otherIds.map((id) => rebalancedPositions.get(id)!);
      newPosition = computeAdjacentInsertPosition(
        rebalancedSiblingPosition,
        "before",
        rebalancedOtherPositions
      );
    }

    const siblingIndex = nextOrder.indexOf(siblingId);
    nextOrder = [...nextOrder.slice(0, siblingIndex), newTaskId, ...nextOrder.slice(siblingIndex)];
    nextPositions = new Map(nextPositions);
    nextPositions.set(newTaskId, newPosition);

    return { columnOrder: nextOrder, positions: nextPositions, rebalanced };
  }

  it("repeatedly inserting 'before' the same target never collides and stays integer, across 12 inserts (enough to exhaust and rebalance)", () => {
    // Start with a two-task column, gap-spaced the normal way. Splitting the
    // same gap "before" the same target roughly halves it each time
    // (1000 -> 500 -> 250 -> 125 -> ...), so by the 11th/12th insert the gap
    // is down to 1 and a rebalance must kick in.
    let columnOrder = ["target", "after-target"];
    let positions = new Map<string, number>([
      ["target", 2000],
      ["after-target", 3000],
    ]);

    const insertedOrder: string[] = [];
    let rebalanceCount = 0;

    for (let i = 0; i < 12; i++) {
      const newTaskId = `inserted-${i}`;
      const result = insertBeforeWithRebalance(columnOrder, positions, "target", newTaskId);
      columnOrder = result.columnOrder;
      positions = result.positions;
      if (result.rebalanced) rebalanceCount += 1;
      insertedOrder.push(newTaskId);

      // No two tasks ever share a position.
      const allPositions = columnOrder.map((id) => positions.get(id)!);
      expect(new Set(allPositions).size).toBe(allPositions.length);

      // Every position is a whole number (what the `integer` DB column requires).
      for (const p of allPositions) {
        expect(Number.isInteger(p)).toBe(true);
      }
    }

    // The gap did get exhausted at least once across this chain, so this
    // test actually exercises the rebalance path (not just the plain split).
    expect(rebalanceCount).toBeGreaterThanOrEqual(1);

    // Each new task was inserted directly before "target", so the final
    // order has all 12 inserted tasks immediately preceding it, in insertion
    // order, followed by "target" then "after-target" — matching what the
    // sequence of before_task_id calls intended, exactly as get_board's
    // .order("position").order("id") would list them.
    const sortedOrder = [...columnOrder].sort((a, b) => positions.get(a)! - positions.get(b)!);
    const targetIndex = sortedOrder.indexOf("target");
    expect(sortedOrder.slice(targetIndex - 12, targetIndex)).toEqual(insertedOrder);
    expect(sortedOrder[targetIndex + 1]).toBe("after-target");
  });
});
