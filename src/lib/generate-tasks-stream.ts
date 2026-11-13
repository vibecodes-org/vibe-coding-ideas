/**
 * Pure pieces of the AI Generate Tasks route and dialog: the output budget, the
 * deadline, dropping a half-written last task, and the "Generate the rest"
 * continuation (request validation, prompt block, merge + dedupe).
 * Kept free of server-only imports so they are easy to unit test.
 */

import { z } from "zod";

// Shared by the Generate Tasks route and the daily model-watch check
// (src/lib/model-watch-checks.ts), so both test the same shape.
export const GeneratedTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  columnName: z.string().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
});

export const GeneratedBoardSchema = z.object({
  tasks: z.array(GeneratedTaskSchema),
});

/**
 * Hidden safety cap for a brand-new board's first task list. The AI is NOT told
 * this number; the code just keeps the first this-many tasks if it ever returns more.
 * "Generate tasks" has no such cap (the user picks tasks in a preview).
 */
export const NEW_BOARD_MAX_TASKS = 100;

/**
 * Shared guidance on how big a task is and how its description reads. Used by
 * onboarding, the Generate tasks route and the daily model check. Deliberately
 * gives no task count: the model decides how many the project needs.
 */
export const TASK_SIZING_GUIDANCE = `Each task is one meaningful piece of work that a single AI coding agent can carry from start to finish in the project's repository, through its own plan, build, review and test steps. Make it a whole capability a person would notice (for example "People can sign up and log in"), not one step of building it (for example "Create the login form"). Cover everything the idea asks for: every feature, every phase or milestone (later phases included), and every stated requirement that needs building or checking, such as performance, security, reliability or privacy targets, content or safety rules, art and assets, and measuring the stated success metrics. Leave out only work that isn't building or checking the product (interviews, wireframes, legal review). Create as many tasks as that takes and no more: don't split one capability across several tasks to make the list look thorough. Before you finish, go back through the idea section by section and add a task for anything not yet covered.

Write each description in two parts: first one or two sentences on what the task delivers and why it matters; then a line "Done when:" followed by short "- " bullet points (plain bullets, not checkboxes) naming the observable results that prove it works, such as what a person can now do or which tests pass. Don't write step-by-step implementation instructions or checklists: the agent doing the task plans its own approach.`;

/** System prompt for a brand-new board (onboarding) and the daily model check. */
export const NEW_BOARD_SYSTEM_PROMPT = `You are an expert project manager generating a structured task board for a software project on a kanban-style project management platform.\n\n${TASK_SIZING_GUIDANCE}`;

/** Max tokens one Generate (or Generate the rest) call may write. */
export const GENERATE_TASKS_MAX_OUTPUT_TOKENS = 32000;

/**
 * Stop ~30 s before the platform's 300 s function limit so we can end cleanly.
 * The route declares `export const maxDuration = 300` as a literal (Next.js
 * reads it statically); the two numbers move together.
 */
export const GENERATE_TASKS_DEADLINE_MS = 270_000;

/** How long we wait for the finish reason / usage after the stream ends. */
export const GENERATE_TASKS_FINISH_WAIT_MS = 5_000;

export const MAX_CONTINUE_AFTER_ITEMS = 1000;
const MAX_TITLE_CHARS = 200;
const MAX_NAME_CHARS = 60;
const MAX_LABELS_PER_TASK = 10;

export type CutShortReason = "length" | "time";

/** The fields the continuation logic needs from a task. */
export interface ContinuationTask {
  title: string;
  columnName?: string;
  labels?: string[];
  dueDate?: string;
}

/**
 * Drops the last task. When the model is cut off mid-JSON, the last task is the
 * one being written; earlier ones are closed. Conservative: if the cut fell
 * exactly between tasks, one good task is lost, which beats offering a broken one.
 */
export function completeTasksOnly<T>(tasks: readonly T[]): T[] {
  return tasks.slice(0, -1);
}

export type ParsedContinueAfter =
  | { ok: true; value: ContinueAfterTask[] }
  | { ok: false };

export interface ContinueAfterTask {
  title: string;
  columnName?: string;
  labels?: string[];
  dueDate?: string;
}

/**
 * Validates the optional `continueAfter` request field. Absent, null or an empty
 * array all mean "a normal first run" (ok with an empty list).
 */
export function parseContinueAfter(raw: unknown): ParsedContinueAfter {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.length > MAX_CONTINUE_AFTER_ITEMS) return { ok: false };

  const value: ContinueAfterTask[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false };
    const rec = item as Record<string, unknown>;
    if (typeof rec.title !== "string") return { ok: false };

    const task: ContinueAfterTask = { title: rec.title.trim().slice(0, MAX_TITLE_CHARS) };
    if (typeof rec.columnName === "string" && rec.columnName.trim()) {
      task.columnName = rec.columnName.trim().slice(0, MAX_NAME_CHARS);
    }
    if (Array.isArray(rec.labels)) {
      const labels = rec.labels
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        .slice(0, MAX_LABELS_PER_TASK)
        .map((l) => l.trim().slice(0, MAX_NAME_CHARS));
      if (labels.length > 0) task.labels = labels;
    }
    if (typeof rec.dueDate === "string" && rec.dueDate.trim()) {
      task.dueDate = rec.dueDate.trim().slice(0, MAX_NAME_CHARS);
    }
    value.push(task);
  }
  return { ok: true, value };
}

/** Instruction appended (as the very last prompt part) when continuing a cut-off list. */
export function buildContinuationTasksInstruction(
  continueAfter: readonly ContinuationTask[]
): string {
  const lines = continueAfter.map((t) => {
    let line = `- ${t.title}`;
    if (t.columnName) line += ` [${t.columnName}]`;
    if (t.labels && t.labels.length > 0) line += ` (${t.labels.join(", ")})`;
    if (t.dueDate) line += ` due ${t.dueDate}`;
    return line;
  });
  return `---
**Tasks already generated for this idea (the list was cut off before it finished):**
${lines.join("\n")}

Generate ONLY tasks for parts of the idea that this list does not already cover, continuing in the same order, level of detail, column names and label names, with due dates continuing after the last date above. Do NOT repeat, rephrase, split or merge any task in the list. If the list already covers the whole idea, return an empty task list.`;
}

/** Lowercase, strip accents/punctuation, collapse spaces. Exact match on this only. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `base` followed by each incoming task whose normalised title is not already in
 * `base` or earlier in `incoming`.
 */
export function mergeContinuation<T extends { title: string }>(
  base: readonly T[],
  incoming: readonly T[]
): T[] {
  const seen = new Set(base.map((t) => normaliseTitle(t.title)));
  const merged = [...base];
  for (const task of incoming) {
    const key = normaliseTitle(task.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(task);
  }
  return merged;
}
