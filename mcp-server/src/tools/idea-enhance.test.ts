import { describe, it, expect, vi } from "vitest";
import type { McpContext } from "../context";
import {
  getIdeaEnhancementPrompt,
  getIdeaEnhancementPromptSchema,
} from "./idea-enhance";

const AUTHOR_ID = "00000000-0000-4000-a000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-a000-000000000002";
const IDEA_ID = "00000000-0000-4000-a000-000000000040";

function ideaRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: IDEA_ID,
    title: "Offline-first recipe box PWA",
    description: "An app where you save recipes and they work offline.",
    author_id: AUTHOR_ID,
    project_kit: null,
    ...overrides,
  };
}

/** Chainable supabase mock: .from("ideas").select().eq().maybeSingle() */
function createContext(opts: {
  idea: unknown;
  error?: { message: string } | null;
  userId?: string;
  ownerUserId?: string;
}) {
  const fromFn = vi.fn();
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.idea, error: opts.error ?? null }),
  };
  fromFn.mockReturnValue(chain);

  const ctx: McpContext = {
    supabase: { from: fromFn } as unknown as McpContext["supabase"],
    userId: opts.userId ?? AUTHOR_ID,
    ownerUserId: opts.ownerUserId,
  };

  return { ctx, fromFn };
}

describe("getIdeaEnhancementPrompt — author happy path", () => {
  it("returns the full contract shape and never queries ai_usage_log", async () => {
    const { ctx, fromFn } = createContext({ idea: ideaRow() });

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });
    const result = await getIdeaEnhancementPrompt(ctx, params);

    expect(result.idea).toEqual({
      id: IDEA_ID,
      title: "Offline-first recipe box PWA",
      description: "An app where you save recipes and they work offline.",
    });
    expect(result.system_prompt).toBe(
      "You are an expert product manager and technical writer helping to enhance idea descriptions on a project management platform."
    );
    expect(result.enhancement_prompt).toBe(
      "Improve this idea description. Add more detail, user stories, technical scope, and a clear product vision. Keep the original intent and key points, but make it more comprehensive and well-structured."
    );
    expect(result.user_prompt).toBe(
      `${result.enhancement_prompt}\n\n---\n\n**Idea Title:** Offline-first recipe box PWA\n\n**Current Description:**\nAn app where you save recipes and they work offline.`
    );
    expect(result.attachments).toEqual({ used: [], omitted: [] });
    expect(result.instructions).toContain(`update_idea_description(idea_id: "${IDEA_ID}"`);
    expect(result.instructions).toContain("If the save errors, show the user the error; do not retry silently.");
    expect(result.next_tool).toBe("update_idea_description");

    // FR-2: no AI call, no usage logging.
    expect(fromFn).not.toHaveBeenCalledWith("ai_usage_log");
  });

  it("uses custom_prompt in place of the default enhancement_prompt", async () => {
    const { ctx } = createContext({ idea: ideaRow() });

    const params = getIdeaEnhancementPromptSchema.parse({
      idea_id: IDEA_ID,
      custom_prompt: "Make it more technical",
    });
    const result = await getIdeaEnhancementPrompt(ctx, params);

    expect(result.enhancement_prompt).toBe("Make it more technical");
    expect(result.user_prompt.startsWith("Make it more technical")).toBe(true);
  });

  it("recognizes ownerUserId (bot identity) as the caller, not the bot userId", async () => {
    const { ctx } = createContext({
      idea: ideaRow(),
      userId: "bot-id",
      ownerUserId: AUTHOR_ID,
    });

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });
    const result = await getIdeaEnhancementPrompt(ctx, params);

    expect(result.idea.id).toBe(IDEA_ID);
  });

  it("appends the kit-context suffix when the idea belongs to a project kit", async () => {
    const { ctx } = createContext({
      idea: ideaRow({ project_kit: { name: "Next.js SaaS" } }),
    });

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });
    const result = await getIdeaEnhancementPrompt(ctx, params);

    expect(result.system_prompt).toContain("This is a **Next.js SaaS** project");
  });
});

describe("getIdeaEnhancementPrompt — auth & not-found", () => {
  it("rejects a non-author with a clear error", async () => {
    const { ctx } = createContext({ idea: ideaRow(), userId: OTHER_USER_ID });

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });

    await expect(getIdeaEnhancementPrompt(ctx, params)).rejects.toThrow(
      "Only the idea author can enhance this idea's description."
    );
  });

  it("errors clearly when the idea doesn't exist", async () => {
    const { ctx } = createContext({ idea: null });

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });

    await expect(getIdeaEnhancementPrompt(ctx, params)).rejects.toThrow(/Idea not found/);
  });
});

describe("getIdeaEnhancementPrompt — attachments", () => {
  it("include_attachments:false skips the provider entirely — no block, empty receipt", async () => {
    const { ctx } = createContext({ idea: ideaRow() });
    const provider = vi.fn();

    const params = getIdeaEnhancementPromptSchema.parse({
      idea_id: IDEA_ID,
      include_attachments: false,
    });
    const result = await getIdeaEnhancementPrompt(ctx, params, provider);

    expect(provider).not.toHaveBeenCalled();
    expect(result.attachments).toEqual({ used: [], omitted: [] });
    expect(result.user_prompt).not.toContain("Attached Files");
  });

  it("an injected provider's block and usage appear in the payload", async () => {
    const { ctx } = createContext({ idea: ideaRow() });
    const provider = vi.fn().mockResolvedValue({
      promptBlock: "\n\n---\n**Attached Files:**\n\n## notes.md\nSome research notes",
      usage: { used: [{ id: "a1", name: "notes.md", truncated: false }], omitted: [] },
    });

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });
    const result = await getIdeaEnhancementPrompt(ctx, params, provider);

    expect(provider).toHaveBeenCalledWith(ctx.supabase, IDEA_ID);
    expect(result.user_prompt).toContain("## notes.md");
    expect(result.user_prompt).toContain("Some research notes");
    expect(result.attachments.used).toEqual([{ id: "a1", name: "notes.md", truncated: false }]);
  });

  it("a provider failure degrades to no attachment context — never fails the call", async () => {
    const { ctx } = createContext({ idea: ideaRow() });
    const provider = vi.fn().mockRejectedValue(new Error("storage offline"));

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });
    const result = await getIdeaEnhancementPrompt(ctx, params, provider);

    expect(result.attachments).toEqual({ used: [], omitted: [] });
    expect(result.user_prompt).not.toContain("Attached Files");
  });

  it("omits attachments when no provider is injected (e.g. transport didn't wire one)", async () => {
    const { ctx } = createContext({ idea: ideaRow() });

    const params = getIdeaEnhancementPromptSchema.parse({ idea_id: IDEA_ID });
    const result = await getIdeaEnhancementPrompt(ctx, params, undefined);

    expect(result.attachments).toEqual({ used: [], omitted: [] });
  });
});
