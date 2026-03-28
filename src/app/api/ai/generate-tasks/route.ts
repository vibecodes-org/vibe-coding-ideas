import { streamObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  AI_MODEL,
  logAiUsage,
  decrementStarterCredit,
  resolveAiProvider,
} from "@/lib/ai-helpers";
import { buildPromptContextParts, buildAutoRuleMappings } from "@/lib/ai-prompt-helpers";

export const maxDuration = 300;

const GeneratedTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  columnName: z.string().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
});

const GeneratedBoardSchema = z.object({
  tasks: z.array(GeneratedTaskSchema),
});

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const resolved = await resolveAiProvider(supabase, user.id);
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const { anthropic, keyType } = resolved;

    const body = await req.json();
    const { ideaId, prompt, personaPrompt, agentRole, agentSkills, agentBio } = body as {
      ideaId: string;
      prompt: string;
      personaPrompt?: string | null;
      agentRole?: string | null;
      agentSkills?: string[] | null;
      agentBio?: string | null;
    };

    if (!ideaId || !prompt) {
      return Response.json({ error: "Missing ideaId or prompt" }, { status: 400 });
    }

    const { data: idea } = await supabase
      .from("ideas")
      .select("id, title, description, author_id")
      .eq("id", ideaId)
      .single();

    if (!idea) {
      return Response.json({ error: "Idea not found" }, { status: 404 });
    }

    // Check team membership
    const isAuthor = idea.author_id === user.id;
    if (!isAuthor) {
      const { data: collab } = await supabase
        .from("collaborators")
        .select("id")
        .eq("idea_id", ideaId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!collab) {
        return Response.json(
          { error: "Only team members can generate board tasks" },
          { status: 403 }
        );
      }
    }

    // Fetch existing board state for context
    const [{ data: columns }, { data: labels }, { data: autoRules }] = await Promise.all([
      supabase
        .from("board_columns")
        .select("title, is_done_column")
        .eq("idea_id", ideaId)
        .order("position"),
      supabase
        .from("board_labels")
        .select("id, name")
        .eq("idea_id", ideaId),
      supabase
        .from("workflow_auto_rules")
        .select("label_id, template:workflow_templates!workflow_auto_rules_template_id_fkey(name, description)")
        .eq("idea_id", ideaId),
    ]);

    const existingColumns = (columns ?? [])
      .filter((c) => !c.is_done_column)
      .map((c) => c.title);
    const existingLabels = (labels ?? []).map((l) => l.name);
    const autoRuleMappings = buildAutoRuleMappings(
      (labels ?? []) as { id: string; name: string }[],
      (autoRules ?? []).map((r) => ({
        label_id: r.label_id,
        template: r.template as { name: string; description: string | null } | null,
      }))
    );

    const hasAgent = !!(personaPrompt || agentRole || agentSkills?.length);

    const systemPrompt = hasAgent
      ? `${personaPrompt ?? "You are a specialist AI agent."}\n\nYou are generating a structured task board for a software project on a kanban-style project management platform. Focus your task generation on your area of expertise — prioritize tasks you would own or contribute to. If a task has subtasks or implementation steps, include them as a markdown task list in the description (e.g. "- [ ] Step one\\n- [ ] Step two").`
      : "You are an expert project manager generating a structured task board for a software project on a kanban-style project management platform. If a task has subtasks or implementation steps, include them as a markdown task list in the description (e.g. \"- [ ] Step one\\n- [ ] Step two\").";

    const contextParts = buildPromptContextParts({
      prompt,
      ideaTitle: idea.title,
      ideaDescription: idea.description,
      existingColumns,
      existingLabels,
      autoRuleMappings,
      agentRole,
      agentSkills,
      agentBio,
    });

    const result = streamObject({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: contextParts.join("\n\n"),
      schema: GeneratedBoardSchema,
      maxOutputTokens: 8000,
    });

    // Stream partial objects as newline-delimited JSON
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for await (const partialObject of result.partialObjectStream) {
          const taskCount = partialObject.tasks?.length ?? 0;
          // Only emit when we have at least one task with a title
          if (taskCount > 0 && partialObject.tasks![taskCount - 1]?.title) {
            controller.enqueue(
              encoder.encode(JSON.stringify(partialObject) + "\n")
            );
          }
        }
        const usage = await result.usage;
        await logAiUsage(supabase, {
          userId: user.id,
          actionType: "generate_board_tasks",
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          model: AI_MODEL,
          ideaId,
          keyType,
        });
        if (keyType === "platform") {
          await decrementStarterCredit(supabase, user.id);
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  } catch (err) {
    logger.error("AI generate tasks API error", { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { error: err instanceof Error ? err.message : "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
