import { z } from "zod";
import type { McpContext } from "../context";
import {
  buildEnhanceUserPrompt,
  buildKitContext,
  buildNewIdeaSystemPrompt,
  DEFAULT_ENHANCE_PROMPT,
} from "../../../src/lib/enhance-prompts";

export const getNewIdeaEnhancementPromptSchema = z.object({
  title: z.string().min(1).max(200).describe("Working title for the new idea."),
  description: z
    .string()
    .min(1)
    .max(50000)
    .describe("Draft/current description to enhance (markdown supported)."),
  kit_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Optional project kit to tailor the enhancement toward (e.g. 'Next.js SaaS', 'Chrome Extension'). Pass the same kit_id to create_idea to apply it at creation time."
    ),
  custom_prompt: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Optional user-supplied enhancement direction (e.g. 'make it more technical'). Replaces the default enhancement_prompt; everything else is unchanged."
    ),
});

/**
 * `instructions` field — mirrors `get_idea_enhancement_prompt`'s voice
 * (mcp-server/src/tools/idea-enhance.ts), adapted for a NEW (not-yet-created)
 * idea: the save step is `create_idea` instead of `update_idea_description`,
 * and it carries `kit_id` forward so the kit is applied atomically at
 * creation time.
 */
function buildInstructions(kitId: string | undefined): string {
  const kitArg = kitId ? `, kit_id: "${kitId}"` : "";
  return `This server did NOT call AI and will not. YOU must now generate the enhanced
description yourself, in this session, using your own model. Follow these steps
exactly:

1. Adopt system_prompt as your role for this task.

2. RECOMMENDED: before writing, ask the user 2-4 short clarifying questions in
   the terminal (target users, technical scope, goals, success criteria). Skip
   this only if the user asked for a quick pass or already gave clear
   direction. Fold their answers into your rewrite.

3. Generate the enhanced description by following user_prompt (it already
   contains the enhancement brief, the working title, and the current draft
   description). There are no attachments yet — the idea doesn't exist until
   step 6.

4. Your output MUST be only the enhanced description itself, as GitHub-
   flavoured markdown: no preamble, no closing commentary, no code fence
   around the document. Hard limit 50,000 characters — if you exceed it,
   tighten the prose; never truncate mid-section.

5. Show the user the full draft (title + enhanced description), then ask for
   explicit confirmation before creating anything.

6. NEVER create the idea without the user's confirmation. Once they confirm,
   create it with:
   create_idea(title: <title>, description: <your markdown>${kitArg})
   This creates the idea AND applies the kit (if any) in one call. If it
   errors, show the user the error; do not retry silently.

7. If the user requests changes, revise and re-confirm before creating. If
   they decline, do not create anything.`;
}

export async function getNewIdeaEnhancementPrompt(
  ctx: McpContext,
  params: z.infer<typeof getNewIdeaEnhancementPromptSchema>
) {
  // No idea exists yet, so there's no author to check — any authenticated
  // caller (ctx always carries a resolved userId once context is built) may
  // request an enhancement prompt for a draft they haven't created yet.

  let kitName: string | undefined;
  if (params.kit_id) {
    const { data: kit, error } = await ctx.supabase
      .from("project_kits")
      .select("id, name")
      .eq("id", params.kit_id)
      .maybeSingle();

    if (error) throw new Error(`Failed to look up kit: ${error.message}`);
    if (!kit) {
      throw new Error(
        `Kit not found: ${params.kit_id}. Call list_kits to find a valid kit_id, or omit kit_id.`
      );
    }
    kitName = kit.name;
  }

  // FR-2 parity with get_idea_enhancement_prompt: this tool never calls AI
  // and never writes ai_usage_log — it only assembles the context an agent
  // needs to generate the enhancement itself.

  const kitContext = buildKitContext(kitName);
  const systemPrompt = buildNewIdeaSystemPrompt({ kitContext });
  const enhancementPrompt = params.custom_prompt ?? DEFAULT_ENHANCE_PROMPT;
  const userPrompt = buildEnhanceUserPrompt({
    prompt: enhancementPrompt,
    title: params.title,
    description: params.description,
  });

  return {
    draft: {
      title: params.title,
      description: params.description,
      kit_id: params.kit_id,
      kit_name: kitName,
    },
    system_prompt: systemPrompt,
    enhancement_prompt: enhancementPrompt,
    user_prompt: userPrompt,
    instructions: buildInstructions(params.kit_id),
    next_tool: "create_idea",
  };
}
