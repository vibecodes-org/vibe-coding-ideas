import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  getNewIdeaEnhancementPrompt,
  getNewIdeaEnhancementPromptSchema,
} from "./new-idea-enhance";

const KIT_ID = "00000000-0000-4000-a000-000000000099";

/** Chainable supabase mock: .from("project_kits").select().eq().maybeSingle() */
function createContext(opts: { kit?: unknown; error?: { message: string } | null } = {}) {
  const fromFn = vi.fn();
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.kit ?? null, error: opts.error ?? null }),
  };
  fromFn.mockReturnValue(chain);

  const ctx: McpContext = {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: "test-user",
  };

  return { ctx, fromFn };
}

describe("getNewIdeaEnhancementPrompt — no kit", () => {
  it("returns the full contract shape and never queries ai_usage_log", async () => {
    const { ctx, fromFn } = createContext();

    const params = getNewIdeaEnhancementPromptSchema.parse({
      title: "Offline recipe box",
      description: "Save recipes offline.",
    });
    const result = await getNewIdeaEnhancementPrompt(ctx, params);

    expect(result.draft).toEqual({
      title: "Offline recipe box",
      description: "Save recipes offline.",
      kit_id: undefined,
      kit_name: undefined,
    });
    expect(result.system_prompt).toBe(
      "You are an expert product manager and technical writer helping to enhance a new project idea description on a project management platform."
    );
    expect(result.enhancement_prompt).toBe(
      "Improve this idea description. Add more detail, user stories, technical scope, and a clear product vision. Keep the original intent and key points, but make it more comprehensive and well-structured."
    );
    expect(result.user_prompt).toBe(
      `${result.enhancement_prompt}\n\n---\n\n**Idea Title:** Offline recipe box\n\n**Current Description:**\nSave recipes offline.`
    );
    expect(result.instructions).toContain("create_idea(title:");
    expect(result.instructions).toContain(
      "If it\n   errors, show the user the error; do not retry silently."
    );
    expect(result.next_tool).toBe("create_idea");

    // No idea/kit lookup needed when kit_id is omitted, and never touches ai_usage_log.
    expect(fromFn).not.toHaveBeenCalled();
    expect(fromFn).not.toHaveBeenCalledWith("ai_usage_log");
  });

  it("does not fetch project_kits when kit_id is omitted", async () => {
    const { ctx, fromFn } = createContext();
    const params = getNewIdeaEnhancementPromptSchema.parse({
      title: "T",
      description: "D",
    });

    await getNewIdeaEnhancementPrompt(ctx, params);

    expect(fromFn).not.toHaveBeenCalled();
  });

  it("uses custom_prompt in place of the default enhancement_prompt", async () => {
    const { ctx } = createContext();
    const params = getNewIdeaEnhancementPromptSchema.parse({
      title: "T",
      description: "D",
      custom_prompt: "Make it more technical",
    });

    const result = await getNewIdeaEnhancementPrompt(ctx, params);

    expect(result.enhancement_prompt).toBe("Make it more technical");
    expect(result.user_prompt.startsWith("Make it more technical")).toBe(true);
  });
});

describe("getNewIdeaEnhancementPrompt — with kit_id", () => {
  it("looks up the kit and produces a kit-aware system_prompt + instructions with kit_id forwarded", async () => {
    const { ctx, fromFn } = createContext({ kit: { id: KIT_ID, name: "Next.js SaaS" } });

    const params = getNewIdeaEnhancementPromptSchema.parse({
      title: "T",
      description: "D",
      kit_id: KIT_ID,
    });
    const result = await getNewIdeaEnhancementPrompt(ctx, params);

    expect(fromFn).toHaveBeenCalledWith("project_kits");
    expect(result.draft.kit_id).toBe(KIT_ID);
    expect(result.draft.kit_name).toBe("Next.js SaaS");
    expect(result.system_prompt).toContain("This is a **Next.js SaaS** project");
    expect(result.instructions).toContain(`kit_id: "${KIT_ID}"`);
  });

  it("errors clearly when kit_id doesn't match a kit", async () => {
    const { ctx } = createContext({ kit: null });

    const params = getNewIdeaEnhancementPromptSchema.parse({
      title: "T",
      description: "D",
      kit_id: KIT_ID,
    });

    await expect(getNewIdeaEnhancementPrompt(ctx, params)).rejects.toThrow(
      /Kit not found/
    );
  });

  it("propagates a clear error on a supabase failure", async () => {
    const { ctx } = createContext({ error: { message: "connection reset" } });

    const params = getNewIdeaEnhancementPromptSchema.parse({
      title: "T",
      description: "D",
      kit_id: KIT_ID,
    });

    await expect(getNewIdeaEnhancementPrompt(ctx, params)).rejects.toThrow(
      /Failed to look up kit: connection reset/
    );
  });
});
