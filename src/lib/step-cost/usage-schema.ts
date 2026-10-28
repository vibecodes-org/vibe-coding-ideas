import { z } from "zod";

// Card ba37039b: the token totals reported for one workflow step attempt.
// The shape is exactly what stepUsageCommand (./usage-command.ts) and the
// backfill script (scripts/step-usage-backfill.mjs) print, so a session can
// pass the JSON straight through. Used by complete_step / fail_step and by
// the admin report's import.

const tokenCount = z.number().int().min(0).max(1e12);

export const stepUsageSchema = z.object({
  models: z
    .array(
      z.object({
        model: z.string().min(1).max(80),
        calls: z.number().int().min(0).max(1e6).optional(),
        input_tokens: tokenCount,
        output_tokens: tokenCount,
        cache_read_tokens: tokenCount,
        cache_write_5m_tokens: tokenCount,
        cache_write_1h_tokens: tokenCount,
      })
    )
    .min(1)
    .max(12),
  output_estimated: z.boolean().optional(),
});

export type StepUsage = z.infer<typeof stepUsageSchema>;

/** One past attempt in a backfill file: which step, how it ended, what it used. */
export const backfillAttemptSchema = stepUsageSchema.extend({
  step_id: z.string().uuid(),
  outcome: z.enum(["completed", "awaiting_approval", "failed"]),
  ended_at: z.string().datetime({ offset: true }),
  /** Stage 3 of card 1117ac6b: a session-share-only attempt, stored even on a step that already has a cost. */
  adds_to_existing: z.boolean().optional(),
});

export const backfillFileSchema = z.object({
  kind: z.literal("vibecodes-step-usage-backfill"),
  version: z.literal(1),
  attempts: z.array(backfillAttemptSchema).max(20_000),
});

export type BackfillAttempt = z.infer<typeof backfillAttemptSchema>;
