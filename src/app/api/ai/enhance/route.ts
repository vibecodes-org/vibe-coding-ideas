import { streamText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  AI_MODEL,
  chargeAiUsage,
  chargeAiUpfront,
  resolveAiProvider,
} from "@/lib/ai-helpers";
import {
  getAttachmentContext,
  encodeAttachmentUsageHeader,
  appendAttachmentBlock,
} from "@/lib/attachment-context";
import { buildEnhanceSystemPrompt, buildEnhanceUserPrompt } from "@/lib/enhance-prompts";
import {
  ENHANCE_MAX_OUTPUT_TOKENS,
  ENHANCE_USAGE_WAIT_MS,
  TRUNCATION_MARKER,
  buildContinuationInstruction,
  createDeadlineSignal,
  whenAborted,
} from "@/lib/enhance-stream";

// Next.js reads this statically, so it must be a literal. Keep it in step with ENHANCE_DEADLINE_MS (270 s) in src/lib/enhance-stream.ts.
export const maxDuration = 300; // Streaming keeps the connection alive; allow generous time

export async function POST(req: Request) {
  const startedAt = Date.now();
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
    const { ideaId, prompt, personaPrompt, answers, previousEnhanced, refinementFeedback, continueFrom } = body as {
      ideaId: string;
      prompt: string;
      personaPrompt?: string | null;
      answers?: Record<string, { question: string; answer: string }>;
      previousEnhanced?: string;
      refinementFeedback?: string;
      continueFrom?: string;
    };

    if (!ideaId || !prompt) {
      return Response.json({ error: "Missing ideaId or prompt" }, { status: 400 });
    }

    const { data: idea } = await supabase
      .from("ideas")
      .select("id, title, description, author_id, project_kit:project_kits!ideas_project_kit_id_fkey(name)")
      .eq("id", ideaId)
      .single();

    if (!idea) {
      return Response.json({ error: "Idea not found" }, { status: 404 });
    }
    if (idea.author_id !== user.id) {
      return Response.json(
        { error: "Only the idea author can enhance the description" },
        { status: 403 }
      );
    }

    // Read the idea's text-bearing attachments (md/html/text-layer PDFs) for prompt
    // context. getAttachmentContext never throws — a helper failure degrades to no
    // attachment context rather than 500ing the route (N1).
    const { promptBlock: attachmentPromptBlock, usage: attachmentUsage } =
      await getAttachmentContext(supabase, ideaId);

    // Build prompts (same logic as enhanceIdeaWithContext server action)
    const isRefinement = previousEnhanced && refinementFeedback;

    const kitType = (idea as unknown as { project_kit: { name: string } | null }).project_kit?.name;
    const kitContext = kitType
      ? `\nThis is a **${kitType}** project — tailor the description to concerns specific to ${kitType.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`
      : "";

    const systemPrompt = personaPrompt
      ? `${personaPrompt}\n\nYou are helping to enhance an idea description on a project management platform.${kitContext}`
      : buildEnhanceSystemPrompt({ kitContext });

    let userPrompt: string;

    if (continueFrom) {
      // Continue a cut-off result: same inputs as the first run, plus the text so
      // far, asking for ONLY the remaining part. Kept apart from refinement.
      const qaSection =
        answers && Object.keys(answers).length > 0
          ? "\n\n---\n**Clarifying Q&A:**\n" +
            Object.values(answers)
              .map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`)
              .join("\n\n")
          : "";
      userPrompt =
        `${prompt}\n\n---\n**Idea Title:** ${idea.title}\n**Current Description:**\n${idea.description}${qaSection}`;
    } else if (isRefinement) {
      userPrompt = `You previously enhanced an idea description. The user has feedback for revision.

**Original Description:**
${idea.description}

**Your Previous Enhancement:**
${previousEnhanced}

**User's Refinement Feedback:**
${refinementFeedback}

Revise the enhanced description based on this feedback. Keep changes targeted to what was requested.`;
    } else if (answers && Object.keys(answers).length > 0) {
      const qaSection = Object.values(answers)
        .map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`)
        .join("\n\n");

      userPrompt = `${prompt}

---
**Idea Title:** ${idea.title}
**Current Description:**
${idea.description}

---
**Clarifying Q&A:**
${qaSection}

Use the answers above to inform your enhanced description. Make the enhancement specific and tailored based on what you learned.`;
    } else {
      userPrompt = buildEnhanceUserPrompt({ prompt, title: idea.title, description: idea.description });
    }

    // Appends "" when there's no attachment context — byte parity for ideas with
    // no (eligible) attachments (AC-6).
    userPrompt = appendAttachmentBlock(userPrompt, attachmentPromptBlock);
    // The continue instruction goes last so it is the final thing the model reads.
    if (continueFrom) userPrompt += buildContinuationInstruction(continueFrom);

    // Charge upfront BEFORE the AI call — prevents "use now, pay never" if the
    // serverless function is killed mid-stream. Token usage is logged after.
    await chargeAiUpfront(supabase, { userId: user.id, keyType });

    // Deadline: stop ~30 s before the platform would kill the function, and end
    // like a length cut so the user gets the Continue button, not a dead stream.
    const deadline = createDeadlineSignal(startedAt);

    const result = streamText({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: ENHANCE_MAX_OUTPUT_TOKENS,
      abortSignal: deadline.signal,
    });

    // Stream text, then log usage before closing
    // (onFinish runs async and may not complete before Vercel kills the function)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const aborted = whenAborted(deadline.signal);
        let hitDeadline = false;
        try {
          const iterator = result.textStream[Symbol.asyncIterator]();
          while (true) {
            // Race against the deadline so a stream that ignores the abort can't hang us.
            const next = await Promise.race([iterator.next(), aborted]);
            if (next === "aborted") {
              hitDeadline = true;
              break;
            }
            if (next.done) break;
            controller.enqueue(encoder.encode(next.value));
          }
        } catch (err) {
          deadline.clear();
          if (!deadline.signal.aborted) {
            controller.error(err);
            return;
          }
          hitDeadline = true;
        }
        deadline.clear();
        // A stream that closed cleanly because of the abort still counts as a deadline stop.
        hitDeadline ||= deadline.signal.aborted;

        // Log only — the credit was already charged upfront (free: true here).
        const logUsage = async () => {
          const usage = await result.usage;
          await chargeAiUsage(supabase, {
            userId: user.id,
            actionType: "enhance_with_context",
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            model: AI_MODEL,
            ideaId,
            keyType,
            free: true,
            chargedUpfront: true,
          });
        };

        let cutShort = hitDeadline;
        if (hitDeadline) {
          // After a deadline stop the usage numbers may never arrive: log
          // best-effort, wait only briefly, never hang the response.
          try {
            await Promise.race([
              logUsage(),
              new Promise((resolve) => setTimeout(resolve, ENHANCE_USAGE_WAIT_MS)),
            ]);
          } catch (err) {
            logger.warn("AI enhance usage log failed after deadline", {
              ideaId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          logger.warn("AI enhance stopped at deadline", { ideaId });
        } else {
          const finishReason = await result.finishReason;
          await logUsage();
          if (finishReason === "length") {
            logger.warn("AI enhance output truncated", { ideaId });
            cutShort = true;
          }
        }
        if (cutShort) controller.enqueue(encoder.encode(TRUNCATION_MARKER));
        controller.close();
      },
    });

    // Encoded header is null when the idea has zero attachments — omit the
    // header entirely rather than send an empty-but-present one (AC-6).
    const attachmentUsageHeader = encodeAttachmentUsageHeader(attachmentUsage);
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8" };
    if (attachmentUsageHeader) {
      headers["X-Attachment-Usage"] = attachmentUsageHeader;
    }

    return new Response(stream, { headers });
  } catch (err) {
    logger.error("AI enhance API error", { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { error: err instanceof Error ? err.message : "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
