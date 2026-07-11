/**
 * Pure helpers for the Step-Level Comments API (docs/design-step-comments-api.html).
 *
 * get_task attaches each workflow step's own `comments` (newest-first, capped)
 * and `comments_truncated`; claim_next_step surfaces prior approval comments
 * as `approval_notes` plus an APPROVER GUIDANCE instruction block. Both
 * surfaces share the same row shape (a `workflow_step_comments` row joined to
 * `users(full_name)`) and null-handling rules, so the shaping logic lives
 * here once and is exercised by co-located unit tests.
 */

/** Max comments returned per step in get_task's `comments` array. */
export const MAX_STEP_COMMENTS = 10;

/** Max chars kept in a step comment's `content` before clamping. */
export const CONTENT_CLAMP_LENGTH = 2000;

/** Appended to a comment's `content` when it is clamped at CONTENT_CLAMP_LENGTH. */
export const TRUNCATION_SUFFIX = "…[truncated — full text in web UI]";

/** Max approval notes returned by claim_next_step's `approval_notes` array. */
export const MAX_APPROVAL_NOTES = 20;

/**
 * Raw shape of a `workflow_step_comments` row as selected for get_task, joined
 * to `users(full_name)`. Callers must have already filtered out type='output'
 * rows (the UI mirror of complete_step's `output` column, which is the
 * canonical source — see docs/design-step-comments-api.html §00) — this
 * module does not re-filter by type.
 */
export interface StepCommentRow {
  id: string;
  step_id: string;
  type: string;
  content: string;
  author_id: string;
  created_at: string;
  users?: { full_name: string | null } | null;
}

/** Shaped element of get_task's per-step `comments` array. */
export interface ShapedStepComment {
  id: string;
  type: string;
  content: string;
  author_id: string;
  author_name: string | null;
  created_at: string;
}

/** get_task's per-step computed fields. Always both present — never omitted. */
export interface StepCommentsForStep {
  comments: ShapedStepComment[];
  comments_truncated: boolean;
}

/**
 * Clamp comment content to CONTENT_CLAMP_LENGTH chars, appending
 * TRUNCATION_SUFFIX when clamped. Content exactly at the limit is left
 * untouched (only content STRICTLY longer than the limit is clamped).
 */
export function clampCommentContent(content: string): string {
  if (content.length <= CONTENT_CLAMP_LENGTH) return content;
  return content.slice(0, CONTENT_CLAMP_LENGTH) + TRUNCATION_SUFFIX;
}

function shapeStepComment(row: StepCommentRow): ShapedStepComment {
  return {
    id: row.id,
    type: row.type,
    content: clampCommentContent(row.content),
    author_id: row.author_id,
    author_name: row.users?.full_name ?? null,
    created_at: row.created_at,
  };
}

/**
 * Groups a batched workflow_step_comments query result (already filtered to
 * type != 'output', ordered newest-first) by step_id, and shapes each group
 * into get_task's `comments` / `comments_truncated` fields.
 *
 * Every id in `stepIds` gets an entry in the returned map — `comments: []`,
 * `comments_truncated: false` when a step has no rows — so callers never need
 * to branch on map-key existence (fields are always present per §04/§05 of
 * the design).
 */
export function groupStepComments(
  rows: StepCommentRow[],
  stepIds: string[]
): Map<string, StepCommentsForStep> {
  const byStep = new Map<string, StepCommentRow[]>();
  for (const row of rows) {
    const existing = byStep.get(row.step_id);
    if (existing) existing.push(row);
    else byStep.set(row.step_id, [row]);
  }

  const result = new Map<string, StepCommentsForStep>();
  for (const stepId of stepIds) {
    const stepRows = byStep.get(stepId) ?? [];
    result.set(stepId, {
      comments: stepRows.slice(0, MAX_STEP_COMMENTS).map(shapeStepComment),
      comments_truncated: stepRows.length > MAX_STEP_COMMENTS,
    });
  }
  return result;
}

/**
 * Raw shape of a `workflow_step_comments` row as selected for the
 * claim_next_step approval-notes query (type='approval' only), joined to
 * `users(full_name)`.
 */
export interface ApprovalNoteRow {
  step_id: string;
  content: string;
  author_id: string;
  created_at: string;
  users?: { full_name: string | null } | null;
}

/** Shaped element of claim_next_step's `approval_notes` array. */
export interface ApprovalNote {
  step_id: string;
  step_title: string;
  content: string;
  author_id: string;
  author_name: string | null;
  created_at: string;
}

/**
 * Maps type='approval' workflow_step_comments rows (chronological order) to
 * claim_next_step's `approval_notes` shape. `step_title` is resolved from the
 * prior-steps list already fetched for context chaining — no second query.
 * A row whose step_id isn't in `priorSteps` (shouldn't happen given the `.in`
 * scoping of the query) falls back to "Unknown step" rather than dropping the
 * note — a note is never silently discarded.
 */
export function buildApprovalNotes(
  rows: ApprovalNoteRow[],
  priorSteps: { id: string; title: string }[]
): ApprovalNote[] {
  const titleById = new Map(priorSteps.map((s) => [s.id, s.title]));
  return rows.map((row) => ({
    step_id: row.step_id,
    step_title: titleById.get(row.step_id) ?? "Unknown step",
    content: row.content,
    author_id: row.author_id,
    author_name: row.users?.full_name ?? null,
    created_at: row.created_at,
  }));
}

/**
 * Builds the verbatim "APPROVER GUIDANCE" instruction block (design §02/§06).
 * Returns "" when there are no notes — callers must not push an empty string
 * onto contextParts, since that would change the joined `instruction` string
 * (an extra blank paragraph) and break the byte-identical guarantee for the
 * no-notes path.
 */
export function buildApproverGuidanceBlock(notes: ApprovalNote[]): string {
  if (notes.length === 0) return "";
  const lines = notes.map(
    (n) => `- After "${n.step_title}" (${n.author_name ?? "unknown"}, ${n.created_at}): ${n.content}`
  );
  return (
    `APPROVER GUIDANCE: A human approved ${notes.length} prior step(s) in this run with notes (see the "approval_notes" array). ` +
    `Treat each note as a BINDING constraint on this and all later steps — "approved, but change X" means X is now a requirement:\n` +
    lines.join("\n")
  );
}
