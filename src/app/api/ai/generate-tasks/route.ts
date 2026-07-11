import { streamObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  AI_MODEL,
  chargeAiUsage,
  chargeAiUpfront,
  resolveAiProvider,
} from "@/lib/ai-helpers";
import { buildPromptContextParts, buildAutoRuleMappings } from "@/lib/ai-prompt-helpers";

export const maxDuration = 300;

// Hard bound on the streaming generation. Without it, a provider-side stall (the
// stream stops emitting tokens but never sends a `finish` chunk) leaves the dock
// spinning until Vercel's 300s function kill. 120s is generous for 15-20 tasks
// while still failing fast enough to show a retryable error.
const GENERATE_TIMEOUT_MS = 120_000;

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

    // ORIGINAL prompt — unchanged behaviour for normal ideas (incl. the markdown
    // subtask-checklist feature). This is what runs for the vast majority of ideas.
    const systemPrompt = hasAgent
      ? `${personaPrompt ?? "You are a specialist AI agent."}\n\nYou are generating a structured task board for a software project on a kanban-style project management platform. Focus your task generation on your area of expertise — prioritize tasks you would own or contribute to. Include any scaffolding or setup tasks relevant to your domain (e.g. a DevOps agent should include CI/CD and deployment setup). If a task has subtasks or implementation steps, include them as a markdown task list in the description (e.g. "- [ ] Step one\\n- [ ] Step two").`
      : "You are an expert project manager generating a structured task board for a software project on a kanban-style project management platform. Include project scaffolding and setup tasks (e.g. repo setup, dev environment, CI/CD, deployment config) — not just feature work. Order tasks so foundational/setup tasks come first. If a task has subtasks or implementation steps, include them as a markdown task list in the description (e.g. \"- [ ] Step one\\n- [ ] Step two\").";

    // Only very large, dense idea descriptions trigger the "everything in one giant
    // task" pathology (the model reproduces the idea's density into a single task
    // and fills the token budget before making a second — confirmed by telemetry).
    // Normal ideas never hit this, so they keep the ORIGINAL prompt above untouched;
    // only large ideas get an added decomposition nudge. Threshold in characters:
    // 12000 chars ≈ 2000 words — comfortably above a normal spec, well below YCS
    // TEST's ~20000-char programme spec.
    const LARGE_IDEA_CHARS = 12000;
    const isLargeIdea = (idea.description?.length ?? 0) > LARGE_IDEA_CHARS;

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

    // Large ideas ONLY: append a short nudge as the last thing the model reads
    // (recency). The ONLY failure this addresses is the model writing one giant
    // task description that eats the whole token budget before it makes a second
    // task. So the nudge targets exactly that — short descriptions, don't reproduce
    // the spec's detail verbatim, split long descriptions. It deliberately does NOT
    // suggest a task count: the model decomposes to the right number on its own
    // (30+ on normal ideas, which carry no count hint either), and a number would
    // only anchor it. Short descriptions are what let many tasks fit in the budget.
    if (isLargeIdea) {
      contextParts.push(
        "---",
        "This idea's description is long and detailed. Break it into separate tasks — one per discrete piece of work — rather than packing several areas into one large task, and keep each task's description short (about one sentence): summarize the work rather than reproducing acceptance criteria, tables, RICE scores, user stories, or long prose from the idea in a description. If a task's description is getting long, that means it should be split into several separate tasks. Match the size and shape of these examples:\n" +
          '- {"title": "Set up the project repository and CI", "description": "Create the repo and add a lint/test/build pipeline that runs on every PR.", "columnName": "To Do", "labels": ["infrastructure"]}\n' +
          '- {"title": "Design the sign-up flow", "description": "Wireframe the 3-step onboarding and get sign-off before build.", "columnName": "To Do", "labels": ["design"]}'
      );
    }

    // Charge upfront BEFORE the AI call — prevents "use now, pay never" when the
    // post-stream step fails due to expired auth context. Usage logged after.
    await chargeAiUpfront(supabase, { userId: user.id, keyType });

    // `streamError` captures a provider/stream failure. streamObject's default
    // onError only console.error's, and its `partialObjectStream` iterator SWALLOWS
    // error chunks (`case "error": break`), so without this hook a mid-stream
    // failure is invisible to us. Critically, ai@6 resolves `result.usage` ONLY in
    // its `case "finish"` branch — an errored/aborted stream never resolves it, so
    // `await result.usage` below would hang forever, the ReadableStream would never
    // close, and the dock would spin indefinitely (the reported bug).
    let streamError: unknown = null;
    const result = streamObject({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: contextParts.join("\n\n"),
      schema: GeneratedBoardSchema,
      maxOutputTokens: 8000,
      // A stall that emits no tokens (and no error) is bounded here rather than by
      // the 300s function timeout — the abort surfaces through onError below.
      abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      onError: ({ error }) => {
        streamError = error;
        logger.error("AI generate tasks stream error", {
          ideaId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    // Stream partial objects as newline-delimited JSON
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Progress telemetry — lets us tell a genuine stall ("stuck at 1 task")
        // apart from a slow-but-advancing generation when a run is aborted.
        const startedAt = Date.now();
        let maxTasksSeen = 0;
        let chunksEmitted = 0;
        try {
          for await (const partialObject of result.partialObjectStream) {
            const taskCount = partialObject.tasks?.length ?? 0;
            maxTasksSeen = Math.max(maxTasksSeen, taskCount);
            // Only emit when we have at least one task with a title
            if (taskCount > 0 && partialObject.tasks![taskCount - 1]?.title) {
              chunksEmitted += 1;
              controller.enqueue(
                encoder.encode(JSON.stringify(partialObject) + "\n")
              );
            }
          }
        } catch (err) {
          // partialObjectStream can also reject outright (not just emit an error
          // chunk); treat both the same.
          streamError = streamError ?? err;
        }

        // If the stream failed, tell the client explicitly. The dock keys off this
        // sentinel to show a retryable toast instead of treating a truncated
        // partial (e.g. a single task) as a complete result.
        if (streamError) {
          logger.error("AI generate tasks stream ended in error", {
            ideaId,
            isLargeIdea,
            maxTasksSeen,
            chunksEmitted,
            elapsedMs: Date.now() - startedAt,
          });
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                error: "Task generation was interrupted — please try again.",
              }) + "\n"
            )
          );
          controller.close();
          return;
        }

        logger.info("AI generate tasks stream completed", {
          ideaId,
          isLargeIdea,
          maxTasksSeen,
          chunksEmitted,
          elapsedMs: Date.now() - startedAt,
        });

        // Usage is best-effort billing/telemetry only (the credit was charged
        // upfront, free: true here) — NEVER let it block closing the response.
        // Guarded so a never-resolving `result.usage` can't hang the stream.
        try {
          const usage = await Promise.race([
            result.usage.catch(() => null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
          ]);
          if (usage) {
            await chargeAiUsage(supabase, {
              userId: user.id,
              actionType: "generate_board_tasks",
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              model: AI_MODEL,
              ideaId,
              keyType,
              free: true,
            });
          }
        } catch (err) {
          logger.warn("AI generate tasks usage logging failed", {
            ideaId,
            error: err instanceof Error ? err.message : String(err),
          });
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
