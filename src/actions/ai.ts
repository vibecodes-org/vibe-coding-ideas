"use server";

import { createClient } from "@/lib/supabase/server";
import { generateText, generateObject } from "ai";
import { z } from "zod";
import {
  AI_MODEL,
  logAiUsage,
  decrementStarterCredit,
  resolveAiProvider,
} from "@/lib/ai-helpers";
import type { AiAccess } from "@/lib/ai-helpers";

const AI_TIMEOUT_MS = 90_000; // 90s — fail gracefully before Vercel's 120s function timeout

/** Re-throw AI SDK errors as plain Error so Next.js RSC can serialize them. */
function toPlainError(err: unknown): never {
  console.error("[AI Action Error]", err);
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error("The AI request timed out. Please try again — the service may be under heavy load.");
    }
    throw new Error(err.message);
  }
  throw new Error("An unexpected AI error occurred");
}

/** Common auth + AI access check. Uses BYOK key if available, falls back to platform key with starter credits. */
async function requireAiAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const resolved = await resolveAiProvider(supabase, user.id);
  if (!resolved.ok) throw new Error(resolved.error);

  return { supabase, user, anthropic: resolved.anthropic, keyType: resolved.keyType };
}

// ── Check AI Access Status ──────────────────────────────────────────────

export async function getAiAccess(): Promise<AiAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { hasApiKey: false, starterCredits: 0, canUseAi: false };

  const { data: profile } = await supabase
    .from("users")
    .select("encrypted_anthropic_key, ai_starter_credits")
    .eq("id", user.id)
    .single();

  const hasKey = !!profile?.encrypted_anthropic_key;
  const credits = profile?.ai_starter_credits ?? 0;

  return {
    hasApiKey: hasKey,
    starterCredits: credits,
    canUseAi: hasKey || credits > 0,
  };
}

/** @deprecated Use getAiAccess() instead. Kept for backward compatibility. */
export async function hasApiKey(): Promise<boolean> {
  const access = await getAiAccess();
  return access.canUseAi;
}

// ── Enhance Idea Description ───────────────────────────────────────────

export async function enhanceIdeaDescription(
  ideaId: string,
  prompt: string,
  personaPrompt?: string | null
) {
  const { supabase, user, anthropic, keyType } = await requireAiAccess();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description, author_id")
    .eq("id", ideaId)
    .single();

  if (!idea) throw new Error("Idea not found");
  if (idea.author_id !== user.id) {
    throw new Error("Only the idea author can enhance the description");
  }

  const systemPrompt = personaPrompt
    ? `${personaPrompt}\n\nYou are helping to enhance an idea description on a project management platform.`
    : "You are an expert product manager and technical writer helping to enhance idea descriptions on a project management platform.";

  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number };
  let finishReason: string;
  try {
    ({ text, usage, finishReason } = await generateText({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: `${prompt}\n\n---\n\n**Idea Title:** ${idea.title}\n\n**Current Description:**\n${idea.description}`,
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }));
  } catch (err) {
    toPlainError(err);
  }

  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "enhance_description",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId,
    keyType,
  });
  if (keyType === "platform") await decrementStarterCredit(supabase, user.id);

  return { enhanced: text, original: idea.description, truncated: finishReason === "length" };
}

// ── Generate Clarifying Questions ───────────────────────────────────────

const ClarifyingQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      placeholder: z.string().optional(),
    })
  ),
});

export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestionsSchema>["questions"][number];

export async function generateClarifyingQuestions(
  ideaId: string,
  prompt: string,
  personaPrompt?: string | null
) {
  const { supabase, user, anthropic, keyType } = await requireAiAccess();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description, author_id")
    .eq("id", ideaId)
    .single();

  if (!idea) throw new Error("Idea not found");
  if (idea.author_id !== user.id) {
    throw new Error("Only the idea author can enhance the description");
  }

  const systemPrompt = personaPrompt
    ? `${personaPrompt}\n\nYou are helping to enhance an idea description. Before enhancing, you need to ask 2-4 focused clarifying questions to produce a better result.`
    : "You are an expert product manager helping to enhance an idea description. Before enhancing, you need to ask 2-4 focused clarifying questions to produce a better result.";

  let object: z.infer<typeof ClarifyingQuestionsSchema>;
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    ({ object, usage } = await generateObject({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: `The user wants to enhance the following idea. Read the idea and the user's enhancement prompt, then generate 2-4 targeted clarifying questions that would help you produce a much better enhancement. Focus on questions about target users, technical scope, project goals, success criteria, or any gaps in the current description.

**Enhancement Prompt:** ${prompt}

---

**Idea Title:** ${idea.title}

**Current Description:**
${idea.description}`,
      schema: ClarifyingQuestionsSchema,
      maxOutputTokens: 1000,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }));
  } catch (err) {
    toPlainError(err);
  }

  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "generate_questions",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId,
    keyType,
  });
  if (keyType === "platform") await decrementStarterCredit(supabase, user.id);

  return { questions: object.questions };
}

// ── Enhance Idea with Context (Multi-Turn) ──────────────────────────────

export async function enhanceIdeaWithContext(
  ideaId: string,
  prompt: string,
  options?: {
    personaPrompt?: string | null;
    answers?: Record<string, { question: string; answer: string }>;
    previousEnhanced?: string;
    refinementFeedback?: string;
  }
) {
  const { supabase, user, anthropic, keyType } = await requireAiAccess();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description, author_id")
    .eq("id", ideaId)
    .single();

  if (!idea) throw new Error("Idea not found");
  if (idea.author_id !== user.id) {
    throw new Error("Only the idea author can enhance the description");
  }

  const personaPrompt = options?.personaPrompt;
  const isRefinement = options?.previousEnhanced && options?.refinementFeedback;

  const systemPrompt = personaPrompt
    ? `${personaPrompt}\n\nYou are helping to enhance an idea description on a project management platform.`
    : "You are an expert product manager and technical writer helping to enhance idea descriptions on a project management platform.";

  let userPrompt: string;

  if (isRefinement) {
    userPrompt = `You previously enhanced an idea description. The user has feedback for revision.

**Original Description:**
${idea.description}

**Your Previous Enhancement:**
${options!.previousEnhanced}

**User's Refinement Feedback:**
${options!.refinementFeedback}

Revise the enhanced description based on this feedback. Keep changes targeted to what was requested.`;
  } else if (options?.answers && Object.keys(options.answers).length > 0) {
    const qaSection = Object.values(options.answers)
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
    userPrompt = `${prompt}\n\n---\n\n**Idea Title:** ${idea.title}\n\n**Current Description:**\n${idea.description}`;
  }

  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number };
  let finishReason: string;
  try {
    ({ text, usage, finishReason } = await generateText({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }));
  } catch (err) {
    toPlainError(err);
  }

  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "enhance_with_context",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId,
    keyType,
  });
  if (keyType === "platform") await decrementStarterCredit(supabase, user.id);

  return { enhanced: text, original: idea.description, truncated: finishReason === "length" };
}

// ── Apply Enhanced Description ──────────────────────────────────────────

export async function applyEnhancedDescription(
  ideaId: string,
  description: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("ideas")
    .update({ description })
    .eq("id", ideaId)
    .eq("author_id", user.id);

  if (error) throw new Error(error.message);
}

// ── Generate Board Tasks ────────────────────────────────────────────────

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

export async function generateBoardTasks(
  ideaId: string,
  prompt: string,
  personaPrompt?: string | null
) {
  const { supabase, user, anthropic, keyType } = await requireAiAccess();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description, author_id")
    .eq("id", ideaId)
    .single();

  if (!idea) throw new Error("Idea not found");

  const isAuthor = idea.author_id === user.id;
  if (!isAuthor) {
    const { data: collab } = await supabase
      .from("collaborators")
      .select("id")
      .eq("idea_id", ideaId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!collab) {
      throw new Error("Only team members can generate board tasks");
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
    ? `${personaPrompt}\n\nYou are generating a structured task board for a software project on a kanban-style project management platform. If a task has subtasks or implementation steps, include them as a markdown task list in the description (e.g. "- [ ] Step one\\n- [ ] Step two").`
    : "You are an expert project manager generating a structured task board for a software project on a kanban-style project management platform. If a task has subtasks or implementation steps, include them as a markdown task list in the description (e.g. \"- [ ] Step one\\n- [ ] Step two\").";

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

  let object: z.infer<typeof GeneratedBoardSchema>;
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    ({ object, usage } = await generateObject({
      model: anthropic(AI_MODEL),
      system: systemPrompt,
      prompt: contextParts.join("\n\n"),
      schema: GeneratedBoardSchema,
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }));
  } catch (err) {
    toPlainError(err);
  }

  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "generate_board_tasks",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId,
    keyType,
  });
  if (keyType === "platform") await decrementStarterCredit(supabase, user.id);

  // Cap at 50 tasks (Anthropic API doesn't support maxItems in schema)
  const tasks = object.tasks.slice(0, 50);

  return {
    tasks,
    count: tasks.length,
  };
}

// ── Enhance Task Description ─────────────────────────────────────────────

export async function enhanceTaskDescription(
  ideaId: string,
  taskTitle: string,
  taskDescription: string
) {
  const { supabase, user, anthropic, keyType } = await requireAiAccess();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description")
    .eq("id", ideaId)
    .single();

  if (!idea) throw new Error("Idea not found");

  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    ({ text, usage } = await generateText({
      model: anthropic(AI_MODEL),
      system: "You are a concise technical writer. Improve the task description's clarity and structure. STRICT RULES: Keep the output roughly the same length as the input (never more than 2x). Do NOT add boilerplate sections, templates, checklists, or context the user didn't provide. Just sharpen what's already there. Return ONLY the improved description — no preamble.",
      prompt: `**Task Title:** ${taskTitle}
**Current Description:**
${taskDescription}

**Context (for reference only, do NOT repeat in output):** Project "${idea.title}"`,
      maxOutputTokens: 1000,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }));
  } catch (err) {
    toPlainError(err);
  }

  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "enhance_task_description",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId,
    keyType,
  });
  if (keyType === "platform") await decrementStarterCredit(supabase, user.id);

  return { enhanced: text };
}

// ── Enhance Discussion Body ─────────────────────────────────────────────

export async function enhanceDiscussionBody(
  ideaId: string,
  discussionTitle: string,
  discussionBody: string
) {
  const { supabase, user, anthropic, keyType } = await requireAiAccess();

  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description")
    .eq("id", ideaId)
    .single();

  if (!idea) throw new Error("Idea not found");

  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number };
  try {
    ({ text, usage } = await generateText({
      model: anthropic(AI_MODEL),
      system: "You are a concise technical writer. Improve this discussion post's clarity, structure, and persuasiveness. STRICT RULES: Keep the output roughly the same length as the input (never more than 2x). Do NOT add boilerplate sections, templates, checklists, or context the user didn't provide. Just sharpen what's already there. Return ONLY the improved text — no preamble.",
      prompt: `**Discussion Title:** ${discussionTitle}
**Current Body:**
${discussionBody}

**Context (for reference only, do NOT repeat in output):** Project "${idea.title}"`,
      maxOutputTokens: 2000,
      abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
    }));
  } catch (err) {
    toPlainError(err);
  }

  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "enhance_discussion_body",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId,
    keyType,
  });
  if (keyType === "platform") await decrementStarterCredit(supabase, user.id);

  return { enhanced: text };
}
