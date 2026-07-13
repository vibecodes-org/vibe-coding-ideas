import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import { createIdea, createIdeaSchema, updateIdeaDescription, updateIdeaDescriptionSchema } from "./ideas";
import { applyKitToIdea } from "./kits";

const AUTHOR_ID = "00000000-0000-4000-a000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";
const KIT_ID = "00000000-0000-4000-a000-000000000099";

vi.mock("./kits", () => ({
  applyKitToIdea: vi.fn(),
}));

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

const mockedApplyKitToIdea = vi.mocked(applyKitToIdea);

function createIdeaContext() {
  const insertChain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn(() =>
      Promise.resolve({
        data: { id: IDEA_ID, title: "New idea", status: "open" },
        error: null,
      })
    ),
  };
  const fromFn = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue(insertChain),
  });

  const ctx: McpContext = {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: AUTHOR_ID,
  };

  return { ctx, fromFn };
}

describe("createIdea — kit_id (atomic create + apply)", () => {
  it("kit_id absent: unchanged behaviour — no kit lookup, no `kit` field", async () => {
    mockedApplyKitToIdea.mockClear();
    const { ctx } = createIdeaContext();

    const params = createIdeaSchema.parse({ title: "New idea", description: "Desc" });
    const result = await createIdea(ctx, params);

    expect(result).toEqual({
      success: true,
      idea: { id: IDEA_ID, title: "New idea", status: "open" },
    });
    expect(mockedApplyKitToIdea).not.toHaveBeenCalled();
  });

  it("kit_id present: applies the kit via the shared applyKitToIdea helper and reports counts", async () => {
    mockedApplyKitToIdea.mockClear();
    mockedApplyKitToIdea.mockResolvedValue({
      success: true,
      agentsCreated: 2,
      agentsSkipped: 0,
      labelsCreated: 3,
      templatesImported: 1,
      triggersCreated: 1,
    });
    const { ctx } = createIdeaContext();

    const params = createIdeaSchema.parse({
      title: "New idea",
      description: "Desc",
      kit_id: KIT_ID,
    });
    const result = await createIdea(ctx, params);

    expect(mockedApplyKitToIdea).toHaveBeenCalledWith(ctx, IDEA_ID, KIT_ID);
    expect(result).toEqual({
      success: true,
      idea: { id: IDEA_ID, title: "New idea", status: "open" },
      kit: {
        applied: true,
        agentsCreated: 2,
        agentsSkipped: 0,
        labelsCreated: 3,
        templatesImported: 1,
        triggersCreated: 1,
      },
    });
  });

  it("kit application failure is non-fatal: idea is still returned with kit.applied=false", async () => {
    mockedApplyKitToIdea.mockClear();
    mockedApplyKitToIdea.mockRejectedValue(new Error("Kit not found or inactive"));
    const { ctx } = createIdeaContext();

    const params = createIdeaSchema.parse({
      title: "New idea",
      description: "Desc",
      kit_id: KIT_ID,
    });
    const result = await createIdea(ctx, params);

    expect(result.success).toBe(true);
    expect(result.idea).toEqual({ id: IDEA_ID, title: "New idea", status: "open" });
    expect(result.kit).toEqual({
      applied: false,
      error: "Kit not found or inactive",
    });
  });
});
