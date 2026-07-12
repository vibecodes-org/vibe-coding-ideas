import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { updateIdeaDescription, updateIdeaDescriptionSchema } from "./ideas";

const AUTHOR_ID = "00000000-0000-4000-a000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";

describe("updateIdeaDescription — author check (Condition 3)", () => {
  it("rejects a non-author and never issues the update", async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: IDEA_ID, author_id: AUTHOR_ID },
        error: null,
      }),
    };
    const updateChain = { update: vi.fn().mockReturnThis() };
    const fromFn = vi.fn().mockReturnValue({ ...selectChain, ...updateChain });

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: OTHER_USER_ID,
    };

    const params = updateIdeaDescriptionSchema.parse({
      idea_id: IDEA_ID,
      description: "New description",
    });

    await expect(updateIdeaDescription(ctx, params)).rejects.toThrow(
      "Only the idea author can update the description"
    );
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it("allows the author to update", async () => {
    let updateCalled = false;
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: IDEA_ID, author_id: AUTHOR_ID },
        error: null,
      }),
      update: vi.fn(() => {
        updateCalled = true;
        return chain;
      }),
      single: vi.fn(() =>
        Promise.resolve({ data: { id: IDEA_ID, title: "T" }, error: null })
      ),
    };
    const fromFn = vi.fn().mockReturnValue(chain);

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: AUTHOR_ID,
    };

    const params = updateIdeaDescriptionSchema.parse({
      idea_id: IDEA_ID,
      description: "New description",
    });

    const result = await updateIdeaDescription(ctx, params);

    expect(result.success).toBe(true);
    expect(updateCalled).toBe(true);
  });

  it("allows the real human (ownerUserId) behind a bot identity to update", async () => {
    let updateCalled = false;
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: IDEA_ID, author_id: AUTHOR_ID },
        error: null,
      }),
      update: vi.fn(() => {
        updateCalled = true;
        return chain;
      }),
      single: vi.fn(() =>
        Promise.resolve({ data: { id: IDEA_ID, title: "T" }, error: null })
      ),
    };
    const fromFn = vi.fn().mockReturnValue(chain);

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: "bot-id",
      ownerUserId: AUTHOR_ID,
    };

    const params = updateIdeaDescriptionSchema.parse({
      idea_id: IDEA_ID,
      description: "New description",
    });

    const result = await updateIdeaDescription(ctx, params);

    expect(result.success).toBe(true);
    expect(updateCalled).toBe(true);
  });

  it("errors clearly when the idea doesn't exist", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const fromFn = vi.fn().mockReturnValue(chain);

    const ctx: McpContext = {
      supabase: { from: fromFn } as unknown as McpContext["supabase"],
      userId: AUTHOR_ID,
    };

    const params = updateIdeaDescriptionSchema.parse({
      idea_id: IDEA_ID,
      description: "New description",
    });

    await expect(updateIdeaDescription(ctx, params)).rejects.toThrow(/Idea not found/);
  });
});
