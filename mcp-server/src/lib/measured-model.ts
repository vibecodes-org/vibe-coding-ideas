// Card 1553d11e: which model really ran a step, measured from the token rows a
// session reports (not from what it says it used), and the plain wording when
// that differs from what the user's settings asked for.

import type { StepUsage } from "../../../src/lib/step-cost/usage-schema";

export type ModelFamily = "opus" | "sonnet" | "haiku" | "fable";

const FAMILIES: ModelFamily[] = ["opus", "sonnet", "haiku", "fable"];

/** "claude-opus-4-7", "Opus", "opus" -> "opus"; anything else -> null. */
export function modelFamily(name: string | null | undefined): ModelFamily | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  return FAMILIES.find((f) => lower.includes(f)) ?? null;
}

/**
 * The model that did the step's main work: the family with the most output
 * tokens (so a few background haiku calls don't outweigh the helper). Ties
 * go to the first listed. Null when nothing is measured or no model is
 * recognised.
 */
export function mainMeasuredModel(usage: Pick<StepUsage, "models"> | null | undefined): ModelFamily | null {
  if (!usage?.models?.length) return null;
  const totals = new Map<ModelFamily, number>();
  for (const m of usage.models) {
    const fam = modelFamily(m.model);
    if (!fam) continue;
    totals.set(fam, (totals.get(fam) ?? 0) + m.output_tokens);
  }
  let best: ModelFamily | null = null;
  let bestTokens = -1;
  for (const [fam, tokens] of totals) {
    if (tokens > bestTokens) {
      best = fam;
      bestTokens = tokens;
    }
  }
  return best;
}

/**
 * The model the settings asked for when it differs from the measured one,
 * else null. `fallback` (the tier's backup model) is accepted too, but pass
 * it only when there is no saved asked-for model: a backup VibeCodes switched
 * to is already saved as the asked-for model. Unrecognised
 * names never count as a mismatch.
 */
export function measuredModelMismatch(
  measured: ModelFamily | null,
  asked: string | null | undefined,
  fallback?: string | null
): ModelFamily | null {
  const askedFamily = modelFamily(asked);
  if (!measured || !askedFamily) return null;
  if (measured === askedFamily) return null;
  if (measured === modelFamily(fallback)) return null;
  return askedFamily;
}

/** The note posted on the card (Nick-approved wording). */
export function modelMismatchComment(measured: string, asked: string): string {
  return (
    `This step ran on ${measured}, not ${asked} as your settings ask. This session's helpers were loaded before ` +
    `the setting changed. Later steps will be told to use ${asked}; if it happens again, restart or resume the session.`
  );
}

/** The notice in the complete_step / fail_step reply (Nick-approved wording). */
export function modelMismatchNotice(measured: string, asked: string): string {
  return (
    `This step's helper ran on ${measured} but your settings ask for ${asked}. From now on spawn each helper with ` +
    `the model and effort the claim gives. If your Agent tool can't take them, tell the user: 'Your model setting ` +
    `changed after this session started. Restart or Resume the session to use it.'`
  );
}
