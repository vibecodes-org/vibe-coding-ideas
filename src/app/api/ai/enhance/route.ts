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

export const maxDuration = 300; // Streaming keeps the connection alive; allow generous time

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
    const { ideaId, prompt, personaPrompt, answers, previousEnhanced, refinementFeedback } = body as {
      ideaId: string;
      prompt: string;
      personaPrompt?: string | null;
      answers?: Record<string, { question: string; answer: string }>;
      previousEnhanced?: string;
      refinementFeedback?: string;
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

    if (isRefinement) {
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

    // Charge upfront BEFORE the AI call — prevents "use now, pay never" if the
    // serverless function is killed mid-stream. Token usage is logged after.
    await chargeAiUpfront(supabase, { userId: user.id, keyType });

    const result = streamText({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 16000,
    });

    // Stream text, then log usage before closing
    // (onFinish runs async and may not complete before Vercel kills the function)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of result.textStream) {
          controller.enqueue(encoder.encode(chunk));
        }
        const [usage, finishReason] = await Promise.all([
          result.usage,
          result.finishReason,
        ]);
        // Log only — the credit was already charged upfront (free: true here).
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
        if (finishReason === "length") {
          logger.warn("AI enhance output truncated", { ideaId });
          controller.enqueue(encoder.encode("\n\n__TRUNCATED__"));
        }
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
