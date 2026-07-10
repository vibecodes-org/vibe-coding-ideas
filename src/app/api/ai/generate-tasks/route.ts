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

    // Bound the OUTPUT. A large, detailed idea (long description with acceptance
    // criteria, tables, epics) leads the model to reproduce that density into a
    // single task's description — it can spend the whole token budget on ONE task
    // (confirmed by telemetry: maxTasksSeen=1, ~76s, one task with a giant
    // description). Forcing DECOMPOSITION into many small tasks with tiny
    // descriptions spreads the budget and produces an actual board. Note: we do NOT
    // tell the model to "include implementation steps as a markdown task list" —
    // that instruction actively invites the long descriptions we're preventing.
    const OUTPUT_CONSTRAINTS =
      " Decompose the work into 15-25 small, separate tasks — never combine several work areas into one task. Keep each task's description to ONE short sentence, or at most 3 brief checklist items (~30 words max). Do NOT reproduce acceptance criteria, tables, RICE scores, user stories, or long prose from the idea in a description — summarize into short, actionable tasks. If a description is getting long, that is a signal to split it into several tasks.";

    const systemPrompt =
      (hasAgent
        ? `${personaPrompt ?? "You are a specialist AI agent."}\n\nYou are generating a structured task board for a project on a kanban-style project management platform. Focus your task generation on your area of expertise — prioritize tasks you would own or contribute to. Include any scaffolding or setup tasks relevant to your domain (e.g. a DevOps agent should include CI/CD and deployment setup).`
        : "You are an expert project manager generating a structured task board for a project on a kanban-style project management platform. Include foundational/setup tasks where relevant (e.g. for software: repo setup, dev environment, CI/CD) — not just feature work. Order tasks so foundational/setup tasks come first.") +
      OUTPUT_CONSTRAINTS;

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

    // Repeat the decomposition rules as the LAST thing the model reads before it
    // generates — recency weighting. This directly counters the pull of a long,
    // detailed idea description (which implicitly says "reproduce all this detail").
    // Belt-and-braces with OUTPUT_CONSTRAINTS in the system prompt above.
    // Positive few-shot example of the target size/shape. Anthropic's own guidance
    // for this model: a concrete example of the desired concision moves the model
    // far more than repeated "keep it short" instructions. Telemetry showed the
    // rules alone got tasks from 1 → 6 but descriptions stayed long (budget filled
    // at ~6 tasks); the example is what pushes them terse enough to fit 15-25.
    contextParts.push(
      "---",
      "OUTPUT RULES (follow exactly):\n" +
        "- Break the work above into 15-25 small, SEPARATE tasks. Do not combine multiple areas of work into one task.\n" +
        "- Each task's description: ONE short sentence (~30 words max). No acceptance criteria, tables, RICE scores, user stories, or multi-line prose — summarize.\n" +
        "- A single task with a long description is wrong; split it into several tasks instead.\n" +
        "\n" +
        "Match the size and shape of these examples exactly (note how short each description is):\n" +
        '- {"title": "Set up the project repository and CI", "description": "Create the repo and add a lint/test/build pipeline that runs on every PR.", "columnName": "To Do", "labels": ["infrastructure"]}\n' +
        '- {"title": "Design the sign-up flow", "description": "Wireframe the 3-step onboarding and get sign-off before build.", "columnName": "To Do", "labels": ["design"]}\n' +
        '- {"title": "Draft the pricing page copy", "description": "Write first-pass copy for the three tiers; flag any claims needing review.", "columnName": "Backlog", "labels": ["content"]}'
    );

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
