/**
 * Shared pieces of the two enhance routes (/api/ai/enhance and
 * /api/ai/enhance-create): the deadline guard and the "continue" prompt.
 * Kept free of server-only imports so they are easy to unit test.
 */

/** Max tokens the existing-idea enhance may write. Hidden thinking shares this budget. */
export const ENHANCE_MAX_OUTPUT_TOKENS = 32000;

/** The routes declare maxDuration = 300 (a literal, as Next.js requires); stop 30 s early so we can end cleanly. */
export const ENHANCE_DEADLINE_MS = 270_000;

/** How long we wait for the usage numbers after a deadline stop before giving up. */
export const ENHANCE_USAGE_WAIT_MS = 5_000;

export const TRUNCATION_MARKER = "\n\n__TRUNCATED__";

/**
 * An AbortSignal that fires `deadlineMs` after `startedAt` (immediately if that
 * moment has passed). Call `clear()` once the response has finished.
 */
export function createDeadlineSignal(
  startedAt: number,
  deadlineMs: number = ENHANCE_DEADLINE_MS
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const remaining = Math.max(0, startedAt + deadlineMs - Date.now());
  const timer = setTimeout(() => controller.abort(), remaining);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/** Resolves when the signal aborts (immediately if it already has). */
export function whenAborted(signal: AbortSignal): Promise<"aborted"> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve("aborted");
    signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
}

/** Instruction appended when the user asks to continue a cut-off result. */
export function buildContinuationInstruction(textSoFar: string): string {
  return `

---
**Your output so far (it was cut off before it finished):**
${textSoFar}

Write ONLY the remaining part of the enhanced description, starting exactly where the text above stops (mid-sentence or mid-section if needed). Do NOT repeat, summarise or revise anything already written, and do not add any introduction.`;
}
