import { streamObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  AI_MODEL,
  logAiUsage,
  decrementStarterCredit,
  resolveAiProvider,
} from "@/lib/ai-helpers";

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
    const { ideaId, prompt, personaPrompt } = body as {
      ideaId: string;
      prompt: string;
      personaPrompt?: string | null;
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
    const { data: columns } = await supabase
      .from("board_columns")
      .select("title")
      .eq("idea_id", ideaId)
      .order("position");

    const existingColumns = (columns ?? []).map((c) => c.title);

    const systemPrompt = personaPrompt
      ? `${personaPrompt}\n\nYou are generating a structured task board for a software project on a kanban-style project management platform. If a task has subtasks or implementation steps, include them as a markdown checklist in the description (e.g. "- [ ] Step one\\n- [ ] Step two").`
      : "You are an expert project manager generating a structured task board for a software project on a kanban-style project management platform. If a task has subtasks or implementation steps, include them as a markdown checklist in the description (e.g. \"- [ ] Step one\\n- [ ] Step two\").";

    const contextParts = [
      `${prompt}`,
      `---`,
      `**Idea Title:** ${idea.title}`,
      `**Idea Description:**\n${idea.description}`,
    ];

    if (existingColumns.length > 0) {
      contextParts.push(
        `**Existing Board Columns:** ${existingColumns.join(", ")}`,
        `Use existing column names where appropriate, or suggest new ones if needed.`
      );
    }

    const result = streamObject({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: contextParts.join("\n\n"),
      schema: GeneratedBoardSchema,
      maxOutputTokens: 8000,
      onFinish: async ({ usage }) => {
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
      },
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
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  } catch (err) {
    console.error("[AI Generate Tasks API Error]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
