import { describe, it, expect } from "vitest";
import { removeTemplateOptimistic } from "./user-template-helpers";

interface Item {
  id: string;
  name: string;
}

const A: Item = { id: "a", name: "Alpha" };
const B: Item = { id: "b", name: "Bravo" };
const C: Item = { id: "c", name: "Charlie" };

describe("removeTemplateOptimistic", () => {
  it("removes the item and returns a new list (happy path)", () => {
    const { next } = removeTemplateOptimistic([A, B, C], "b");
    expect(next).toEqual([A, C]);
  });

  it("does not mutate the original list", () => {
    const list = [A, B, C];
    removeTemplateOptimistic(list, "b");
    expect(list).toEqual([A, B, C]);
  });

  it("rollback re-inserts the removed item at its original index", () => {
    const { next, rollback } = removeTemplateOptimistic([A, B, C], "b");
    expect(rollback(next)).toEqual([A, B, C]);
  });

  it("rollback re-inserts even when the list has diverged (still missing the id)", () => {
    const { rollback } = removeTemplateOptimistic([A, B, C], "b");
    const divergent: Item[] = [A];
    const rolledBack = rollback(divergent);
    expect(rolledBack).toContainEqual(B);
    expect(rolledBack).toHaveLength(2);
  });

  it("rollback is a no-op if the id is already present (avoid duplicates)", () => {
    const { rollback } = removeTemplateOptimistic([A, B, C], "b");
    const current = [A, B, C];
    expect(rollback(current)).toBe(current);
  });

  it("returns the list unchanged when the id is not found", () => {
    const list = [A, B, C];
    const { next, rollback } = removeTemplateOptimistic(list, "missing");
    expect(next).toBe(list);
    expect(rollback(next)).toBe(next);
  });

  it("removes the first item and rollback puts it back at index 0", () => {
    const { next, rollback } = removeTemplateOptimistic([A, B, C], "a");
    expect(next).toEqual([B, C]);
    expect(rollback(next)).toEqual([A, B, C]);
  });

  it("removes the last item and rollback puts it back at the end", () => {
    const { next, rollback } = removeTemplateOptimistic([A, B, C], "c");
    expect(next).toEqual([A, B]);
    expect(rollback(next)).toEqual([A, B, C]);
  });
});
