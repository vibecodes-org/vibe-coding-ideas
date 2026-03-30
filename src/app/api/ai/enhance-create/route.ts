import { streamText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  AI_MODEL,
  logAiUsage,
  decrementStarterCredit,
  resolveAiProvider,
} from "@/lib/ai-helpers";

export const maxDuration = 300;

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
    const { title, description, kitType, prompt, personaPrompt, answers } = body as {
      title: string;
      description: string;
      kitType?: string;
      prompt: string;
      personaPrompt?: string | null;
      answers?: Record<string, { question: string; answer: string }>;
    };

    if (!title || !prompt) {
      return Response.json({ error: "Missing title or prompt" }, { status: 400 });
    }

    const kitContext = kitType
      ? `\nThis is a **${kitType}** project — tailor the description to concerns specific to ${kitType.toLowerCase()} projects (e.g. architecture, deployment, tooling, and workflows).`
      : "";

    const systemPrompt = personaPrompt
      ? `${personaPrompt}\n\nYou are helping to enhance a new project idea description on a project management platform.${kitContext}`
      : `You are an expert product manager and technical writer helping to enhance a new project idea description on a project management platform.${kitContext}`;

    let userPrompt: string;

    if (answers && Object.keys(answers).length > 0) {
      const qaSection = Object.values(answers)
        .map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`)
        .join("\n\n");

      userPrompt = `${prompt}

---
**Idea Title:** ${title}
**Current Description:**
${description || title}

---
**Clarifying Q&A:**
${qaSection}

Use the answers above to inform your enhanced description. Make the enhancement specific and tailored based on what you learned.`;
    } else {
      userPrompt = `${prompt}\n\n---\n\n**Idea Title:** ${title}\n\n**Current Description:**\n${description || title}`;
    }

    // Decrement credit upfront BEFORE the AI call — prevents "use now, pay never"
    if (keyType === "platform") {
      await decrementStarterCredit(supabase, user.id);
    }

    const result = streamText({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 4000,
    });

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
        await logAiUsage(supabase, {
          userId: user.id,
          actionType: "enhance_create_description",
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          model: AI_MODEL,
          ideaId: null,
          keyType,
        });
        if (finishReason === "length") {
          logger.warn("AI create enhance output truncated");
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    logger.error("AI create enhance API error", { error: err instanceof Error ? err.message : String(err) });
    return Response.json(
      { error: err instanceof Error ? err.message : "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
