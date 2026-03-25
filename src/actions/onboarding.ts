"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { generateText, generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { logger } from "@/lib/logger";
import {
  AI_MODEL,
  logAiUsage,
  getPlatformAiCallsToday,
  PLATFORM_AI_DAILY_LIMIT,
} from "@/lib/ai-helpers";
import { initializeBoardColumns } from "@/actions/board";
import {
  validateTitle,
  validateOptionalDescription,
  validateBio,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  ValidationError,
} from "@/lib/validation";
import { applyKit, type ApplyKitResult } from "@/actions/kits";

export async function completeOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("users")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createIdeaFromOnboarding(data: {
  title: string;
  description?: string;
  tags?: string[];
  kitId?: string;
  visibility?: "public" | "private";
}): Promise<{ ideaId: string; kitResult?: ApplyKitResult }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const title = validateTitle(data.title);
  const description = data.description?.trim()
    ? validateOptionalDescription(data.description)
    : null;

  const tags = data.tags ?? [];
  if (tags.length > MAX_TAGS) {
    throw new ValidationError(`Maximum ${MAX_TAGS} tags allowed`);
  }
  for (const tag of tags) {
    if (tag.length > MAX_TAG_LENGTH) {
      throw new ValidationError(
        `Tag "${tag}" exceeds ${MAX_TAG_LENGTH} characters`
      );
    }
  }

  const { data: idea, error } = await supabase
    .from("ideas")
    .insert({
      title,
      description: description || title,
      author_id: user.id,
      tags,
      visibility: data.visibility ?? "public",
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Apply kit if selected
  let kitResult: ApplyKitResult | undefined;
  if (data.kitId) {
    try {
      kitResult = await applyKit(idea.id, data.kitId);
    } catch (err) {
      logger.warn("Kit application failed during onboarding", {
        ideaId: idea.id,
        kitId: data.kitId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't throw — idea is already created, kit failure is non-fatal
    }
  }

  return { ideaId: idea.id, kitResult };
}

export async function updateProfileFromOnboarding(data: {
  full_name?: string;
  bio?: string;
  github_username?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const updates: Record<string, unknown> = {};

  if (data.full_name !== undefined) {
    updates.full_name = data.full_name.trim() || null;
  }

  if (data.bio !== undefined) {
    updates.bio = validateBio(data.bio || null);
  }

  if (data.github_username !== undefined) {
    updates.github_username = data.github_username.trim() || null;
  }

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

const ONBOARDING_ENHANCE_TIMEOUT_MS = 30_000;

export async function enhanceOnboardingDescription(data: {
  title: string;
  description: string;
}): Promise<{ enhanced: string }> {
  const platformKey = process.env.ANTHROPIC_API_KEY;
  if (!platformKey) {
    throw new Error("AI enhancement is not available right now");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Only allow during onboarding — user must not have completed it yet
  const { data: profile } = await supabase
    .from("users")
    .select("onboarding_completed_at")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_completed_at) {
    throw new Error("AI enhancement during onboarding is no longer available");
  }

  // Enforce platform AI daily limit (per user)
  if (PLATFORM_AI_DAILY_LIMIT > 0) {
    const todayCount = await getPlatformAiCallsToday(supabase, user.id);
    if (todayCount >= PLATFORM_AI_DAILY_LIMIT) {
      throw new Error(
        "AI enhancement is temporarily unavailable — daily limit reached. Please try again tomorrow."
      );
    }
  }

  const title = data.title.trim();
  if (!title) throw new Error("Title is required");

  const description = data.description.trim();

  const anthropic = createAnthropic({ apiKey: platformKey });

  let text: string;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  try {
    const result = await generateText({
      model: anthropic(AI_MODEL),
      system:
        "You are a concise product writer. The user is creating their first idea on a project management platform. Expand their rough description into a clear, compelling 2-3 paragraph summary. Keep the original voice and intent — just make it clearer and more complete. Return ONLY the improved description, no preamble.",
      prompt: `**Title:** ${title}\n\n**Description:**\n${description || title}`,
      maxOutputTokens: 1000,
      abortSignal: AbortSignal.timeout(ONBOARDING_ENHANCE_TIMEOUT_MS),
    });
    text = result.text;
    usage = result.usage ?? {};
  } catch (err) {
    logger.error("Onboarding AI error", { error: err instanceof Error ? err.message : String(err) });
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("AI request timed out — please try again");
    }
    throw new Error("Failed to enhance description");
  }

  // Log platform AI usage for cost monitoring
  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "enhance_description",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId: null,
    keyType: "platform",
  });

  return { enhanced: text };
}

// ── Generate Board Tasks (free, platform key) ─────────────────────────────

const ONBOARDING_GENERATE_TIMEOUT_MS = 90_000;

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

export type OnboardingGeneratedTask = z.infer<typeof GeneratedTaskSchema>;

export async function generateBoardFromOnboarding(
  ideaId: string
): Promise<{ tasks: OnboardingGeneratedTask[]; count: number }> {
  const platformKey = process.env.ANTHROPIC_API_KEY;
  if (!platformKey) {
    logger.error("Onboarding board gen: ANTHROPIC_API_KEY not set");
    throw new Error("AI board generation is not available right now");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  logger.info("Onboarding board gen: starting", { ideaId, userId: user.id });

  // Only allow during onboarding
  const { data: profile } = await supabase
    .from("users")
    .select("onboarding_completed_at")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_completed_at) {
    throw new Error("Free board generation during onboarding is no longer available");
  }

  // Enforce platform AI daily limit
  if (PLATFORM_AI_DAILY_LIMIT > 0) {
    const todayCount = await getPlatformAiCallsToday(supabase, user.id);
    if (todayCount >= PLATFORM_AI_DAILY_LIMIT) {
      throw new Error(
        "AI generation is temporarily unavailable — daily limit reached. Please try again tomorrow."
      );
    }
  }

  // Fetch idea context
  const { data: idea } = await supabase
    .from("ideas")
    .select("id, title, description")
    .eq("id", ideaId)
    .eq("author_id", user.id)
    .single();

  if (!idea) throw new Error("Idea not found");

  // Fetch existing columns for context
  const { data: columns } = await supabase
    .from("board_columns")
    .select("title")
    .eq("idea_id", ideaId)
    .order("position");

  const existingColumns = (columns ?? []).map((c) => c.title);

  logger.info("Onboarding board gen: calling AI", { ideaId, columns: existingColumns.length });

  const anthropic = createAnthropic({ apiKey: platformKey });

  const contextParts = [
    "Generate a structured task board for this project. Create 6-10 tasks distributed across the board columns. Each task should have a clear title, brief description with implementation steps as markdown task list, appropriate column placement, and relevant labels.",
    "---",
    `**Project Title:** ${idea.title}`,
    `**Project Description:**\n${idea.description}`,
  ];

  if (existingColumns.length > 0) {
    contextParts.push(
      `**Existing Board Columns:** ${existingColumns.join(", ")}`,
      "Use existing column names where appropriate."
    );
  }

  let object: z.infer<typeof GeneratedBoardSchema>;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  try {
    ({ object, usage } = await generateObject({
      model: anthropic(AI_MODEL),
      system:
        "You are an expert project manager generating a structured task board for a software project on a kanban-style project management platform. If a task has subtasks or implementation steps, include them as a markdown task list in the description (e.g. \"- [ ] Step one\\n- [ ] Step two\").",
      prompt: contextParts.join("\n\n"),
      schema: GeneratedBoardSchema,
      maxOutputTokens: 8000,
      abortSignal: AbortSignal.timeout(ONBOARDING_GENERATE_TIMEOUT_MS),
    }));
  } catch (err) {
    logger.error("Onboarding board generation AI error", {
      ideaId,
      error: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      throw new Error("AI request timed out — please try again");
    }
    throw new Error("Failed to generate board tasks");
  }

  logger.info("Onboarding board gen: AI returned tasks", {
    ideaId,
    taskCount: object.tasks.length,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  });

  // Log usage (free — no credit deduction)
  await logAiUsage(supabase, {
    userId: user.id,
    actionType: "generate_board_tasks",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    model: AI_MODEL,
    ideaId,
    keyType: "platform",
  });

  const tasks = object.tasks.slice(0, 50);

  if (tasks.length === 0) {
    logger.warn("Onboarding board gen: AI returned zero tasks", { ideaId });
    throw new Error("AI did not generate any tasks — please try again from your board");
  }

  // ── Persist tasks to the database ──────────────────────────────────
  // Ensure board columns exist (they are normally lazy-initialized on first board visit)
  await initializeBoardColumns(ideaId);

  const { data: boardColumns } = await supabase
    .from("board_columns")
    .select("id, title, position")
    .eq("idea_id", ideaId)
    .order("position");

  if (!boardColumns || boardColumns.length === 0) {
    logger.error("Onboarding board gen: no board columns found", { ideaId });
    throw new Error("Board columns not found — kit may not have been applied correctly");
  }

  const columnByName = new Map(boardColumns.map((c) => [c.title, c.id]));
  const defaultColumnId = boardColumns[0].id;

  // Collect unique new column names from generated tasks
  const existingNames = new Set(boardColumns.map((c) => c.title));
  const newColNames = [
    ...new Set(
      tasks
        .map((t) => t.columnName)
        .filter((n): n is string => !!n && !existingNames.has(n))
    ),
  ];

  // Create any new columns
  if (newColNames.length > 0) {
    let maxPos = Math.max(...boardColumns.map((c) => c.position));
    const newCols = newColNames.map((name) => {
      maxPos += 1000;
      return { idea_id: ideaId, title: name, position: maxPos };
    });
    const { data: createdCols, error: colError } = await supabase
      .from("board_columns")
      .insert(newCols)
      .select("id, title");
    if (colError) {
      logger.error("Onboarding board gen: failed to create columns", { ideaId, error: colError.message });
    }
    if (createdCols) {
      for (const col of createdCols) {
        columnByName.set(col.title, col.id);
      }
    }
  }

  // Batch insert all tasks at once (instead of one-by-one)
  const TASK_POSITION_GAP = 1000;
  const colPositions = new Map<string, number>();
  const taskRows = tasks.map((task) => {
    const colId = (task.columnName && columnByName.get(task.columnName)) || defaultColumnId;
    const currentPos = colPositions.get(colId) ?? 0;
    const nextPos = currentPos + TASK_POSITION_GAP;
    colPositions.set(colId, nextPos);
    return {
      idea_id: ideaId,
      column_id: colId,
      title: task.title.slice(0, 200),
      description: task.description ?? null,
      position: nextPos,
    };
  });

  const { error: insertError } = await supabase
    .from("board_tasks")
    .insert(taskRows);

  if (insertError) {
    logger.error("Onboarding board gen: failed to insert tasks", {
      ideaId,
      error: insertError.message,
      code: insertError.code,
      taskCount: taskRows.length,
    });
    throw new Error(`Failed to save board tasks: ${insertError.message}`);
  }

  logger.info("Onboarding board gen: complete", { ideaId, tasksInserted: taskRows.length });

  return { tasks, count: tasks.length };
}
