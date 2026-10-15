/**
 * Pure pieces of the AI Generate Tasks route and dialog: the output budget, the
 * deadline, dropping a half-written last task, and the "Generate the rest"
 * continuation (request validation, prompt block, merge + dedupe).
 * Kept free of server-only imports so they are easy to unit test.
 */

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
