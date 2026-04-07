import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { manageLabels, manageLabelsSchema } from "./labels";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = "00000000-0000-4000-a000-000000000001";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const LABEL_ID = "00000000-0000-4000-a000-000000000099";
const TASK_ID = "00000000-0000-4000-a000-000000000010";

function createChain(resolveWith: unknown = null) {
  const chain: Record<string, unknown> = {};

  for (const m of ["order", "limit", "range", "or", "filter", "delete"]) {
    chain[m] = vi.fn(() => chain);
  }

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.ilike = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.insert = vi.fn(() => chain);
  chain.update = vi.fn(() => chain);

  chain.single = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );
  chain.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: resolveWith, error: null })
  );

  // Make chain thenable for `await query`
  chain.then = (resolve: (val: unknown) => void) =>
    Promise.resolve({
      data: Array.isArray(resolveWith) ? resolveWith : [],
      error: null,
    }).then(resolve);

  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("manageLabels — create action deduplication", () => {
  it("returns existing label when name matches case-insensitively", async () => {
    const existingLabel = { id: LABEL_ID, name: "UX Redesign", color: "pink" };

    const labelsChain = createChain([existingLabel]);
    const fromFn = vi.fn(() => labelsChain);

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };

    const params = manageLabelsSchema.parse({
      idea_id: IDEA_ID,
      action: "create",
      name: "UX Redesign",
      color: "pink",
    });

    const result = await manageLabels(ctx, params);

    expect(result.success).toBe(true);
    expect(result.label).toEqual(existingLabel);
    expect(result.already_existed).toBe(true);

    // Should have queried board_labels with ilike, NOT inserted
    expect(fromFn).toHaveBeenCalledWith("board_labels");
    expect(labelsChain.ilike).toHaveBeenCalledWith("name", "UX Redesign");
    expect(labelsChain.insert).not.toHaveBeenCalled();
  });

  it("returns existing label even with different casing", async () => {
    const existingLabel = { id: LABEL_ID, name: "UX Redesign", color: "pink" };

    const labelsChain = createChain([existingLabel]);
    const fromFn = vi.fn(() => labelsChain);

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };

    const params = manageLabelsSchema.parse({
      idea_id: IDEA_ID,
      action: "create",
      name: "ux redesign",
      color: "pink",
    });

    const result = await manageLabels(ctx, params);

    expect(result.success).toBe(true);
    expect(result.already_existed).toBe(true);
    expect(labelsChain.ilike).toHaveBeenCalledWith("name", "ux redesign");
  });

  it("creates new label when no match exists", async () => {
    const newLabel = { id: LABEL_ID, name: "New Label", color: "blue" };

    // First call (select for dedup check) returns empty, second call (insert) returns new label
    const chain = createChain(newLabel);
    // Override the thenable to return empty array for the dedup check
    let callCount = 0;
    chain.then = (resolve: (val: unknown) => void) => {
      callCount++;
      if (callCount === 1) {
        // Dedup check — no existing labels
        return Promise.resolve({ data: [], error: null }).then(resolve);
      }
      // Insert
      return Promise.resolve({ data: newLabel, error: null }).then(resolve);
    };

    const fromFn = vi.fn(() => chain);

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: USER_ID,
    };

    const params = manageLabelsSchema.parse({
      idea_id: IDEA_ID,
      action: "create",
      name: "New Label",
    });

    const result = await manageLabels(ctx, params);

    expect(result.success).toBe(true);
    expect(result.already_existed).toBeUndefined();
    expect(chain.insert).toHaveBeenCalled();
  });
});
