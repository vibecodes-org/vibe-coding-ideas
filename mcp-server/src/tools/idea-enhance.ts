import { z } from "zod";
import type { McpContext } from "../context";
import {
  buildEnhanceSystemPrompt,
  buildEnhanceUserPrompt,
  DEFAULT_ENHANCE_PROMPT,
} from "../../../src/lib/enhance-prompts";

/**
 * Attachment usage receipt shape returned by an injected attachment-context
 * provider. A superset of `EnhanceAttachmentUsage` (src/lib/attachment-context.ts)
 * — includes `pdf_unsupported_on_stdio` for the stdio transport's reader
 * (mcp-server/src/attachment-context-stdio.ts). Declared locally (not
 * imported from attachment-context.ts) because that file imports `unpdf`,
 * which isn't a mcp-server dependency.
 */
export interface EnhanceAttachmentUsageLike {
  used: Array<{ id: string; name: string; truncated: boolean }>;
  omitted: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Injectable attachment-context reader — mirrors the `onIdentityChange`
 * injection pattern in register-tools.ts so each transport can supply its own
 * implementation without this tool (or mcp-server generally) depending on
 * app-only libraries:
 *  - Remote (src/app/api/mcp/[[...transport]]/route.ts): injects the real
 *    `getAttachmentContext` from src/lib/attachment-context.ts (full parity,
 *    incl. PDF text extraction).
 *  - stdio (mcp-server/src/index.ts): injects `getStdioAttachmentContext`
 *    (text-only; PDFs reported as omitted).
 * When not provided, the tool omits attachment context entirely (empty
 * block) rather than failing.
 */
export type AttachmentContextProvider = (
  supabase: McpContext["supabase"],
  ideaId: string
) => Promise<{ promptBlock: string; usage: EnhanceAttachmentUsageLike }>;

const EMPTY_ATTACHMENT_USAGE: EnhanceAttachmentUsageLike = { used: [], omitted: [] };

export const getIdeaEnhancementPromptSchema = z.object({
  idea_id: z
    .string()
    .uuid()
    .describe("The idea whose description to enhance. Caller must be the idea's author."),
  custom_prompt: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Optional user-supplied enhancement direction (e.g. 'make it more technical'). Replaces the default enhancement_prompt; everything else is unchanged."
    ),
  include_attachments: z
    .boolean()
    .default(true)
    .describe(
      "Include the idea's text-bearing attachments (md/txt/html/PDF-with-text-layer) as context in user_prompt. Set false to skip for a faster, lighter payload."
    ),
});

/**
 * `instructions` field — verbatim from docs/mcp-idea-enhance-tool-dx.html
 * section 3, plus Condition 6(b): an explicit "don't retry silently on save
 * error" line appended to the save step. `<idea_id>` is interpolated with the
 * real UUID so step 6 is a literally copy-pasteable tool call.
 */
function buildInstructions(ideaId: string): string {
  return `This server did NOT call AI and will not. YOU must now generate the enhanced
description yourself, in this session, using your own model. Follow these steps
exactly:

1. Adopt system_prompt as your role for this task.

2. RECOMMENDED: before writing, ask the user 2-4 short clarifying questions in
   the terminal (target users, technical scope, goals, success criteria). Skip
   this only if the user asked for a quick pass or already gave clear
   direction. Fold their answers into your rewrite.

3. Generate the enhanced description by following user_prompt (it already
   contains the enhancement brief, the idea title, the current description,
   and any attachment context).

4. Your output MUST be only the enhanced description itself, as GitHub-
   flavoured markdown: no preamble, no closing commentary, no code fence
   around the document. Hard limit 50,000 characters — if you exceed it,
   tighten the prose; never truncate mid-section.

5. Show the user a concise summary of what changed (sections added, areas
   expanded, anything removed or reworded), then ask for explicit
   confirmation. Offer to show the full text if they want it.

6. NEVER save without the user's confirmation. Once they confirm, save with:
   update_idea_description(idea_id: "${ideaId}", description: <your markdown>)
   If the save errors, show the user the error; do not retry silently.

7. If the user requests changes, revise and re-confirm before saving. If they
   decline, do not save — their description is untouched.`;
}

export async function getIdeaEnhancementPrompt(
  ctx: McpContext,
  params: z.infer<typeof getIdeaEnhancementPromptSchema>,
  attachmentContextProvider?: AttachmentContextProvider
) {
  const { data: idea, error } = await ctx.supabase
    .from("ideas")
    .select("id, title, description, author_id, project_kit:project_kits!ideas_project_kit_id_fkey(name)")
    .eq("id", params.idea_id)
    .maybeSingle();

  if (error) throw new Error(`Failed to get idea: ${error.message}`);
  if (!idea) {
    throw new Error("Idea not found. Check idea_id, or call list_ideas to find the right one.");
  }

  const callerId = ctx.ownerUserId ?? ctx.userId;
  if (callerId !== idea.author_id) {
    throw new Error("Only the idea author can enhance this idea's description.");
  }

  // FR-2: this tool never calls AI and never writes ai_usage_log — it only
  // assembles the context an agent needs to generate the enhancement itself.

  let attachmentBlock = "";
  let attachmentUsage: EnhanceAttachmentUsageLike = EMPTY_ATTACHMENT_USAGE;

  if (params.include_attachments && attachmentContextProvider) {
    try {
      const result = await attachmentContextProvider(ctx.supabase, params.idea_id);
      attachmentBlock = result.promptBlock;
      attachmentUsage = result.usage;
    } catch {
      // Provider failure never fails the tool — degrade to no attachment
      // context, mirroring getAttachmentContext's never-throw contract.
    }
  }

  const kitName = (idea as unknown as { project_kit: { name: string } | null }).project_kit?.name;
  const kitContext = kitName
    ? `\nThis is a **${kitName}** project — tailor the description to concerns specific to ${kitName.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`
    : "";

  const systemPrompt = buildEnhanceSystemPrompt({ kitContext });
  const enhancementPrompt = params.custom_prompt ?? DEFAULT_ENHANCE_PROMPT;
  const userPrompt = buildEnhanceUserPrompt({
    prompt: enhancementPrompt,
    title: idea.title,
    description: idea.description,
    attachmentBlock,
  });

  return {
    idea: { id: idea.id, title: idea.title, description: idea.description },
    system_prompt: systemPrompt,
    enhancement_prompt: enhancementPrompt,
    user_prompt: userPrompt,
    attachments: attachmentUsage,
    instructions: buildInstructions(params.idea_id),
    next_tool: "update_idea_description",
  };
}
