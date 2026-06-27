import {
  validateDiscussionTitle,
  validateDiscussionBody,
} from "@/lib/validation";
import type { DiscussionStatus } from "@/types";

/** Minimal shape of a board task needed to seed a discussion. */
export interface TaskToConvert {
  idea_id: string;
  title: string;
  description: string | null;
}

/** The validated `idea_discussions` insert payload. */
export interface DiscussionFromTask {
  idea_id: string;
  author_id: string;
  title: string;
  body: string;
  status: DiscussionStatus;
}

/**
 * Build the `idea_discussions` insert payload for a board task being converted
 * into a conversation. Pure mapping — extracted from the server action so the
 * field mapping and the body fallback are unit-testable without Supabase.
 *
 * Mirrors the inverse `convertDiscussionToTask`, which prepends a one-line
 * origin reference ("From discussion: …") above the carried-over body. Here we
 * prepend the symmetric "From board task: …" line so the conversation records
 * where it came from without destroying the user's description. When the task
 * has no (non-blank) description the origin line stands alone as the body —
 * `validateDiscussionBody` rejects blank bodies and most board tasks carry no
 * description.
 */
export function buildDiscussionFromTask(
  task: TaskToConvert,
  authorId: string
): DiscussionFromTask {
  const description = task.description?.trim();
  const origin = `From board task: ${task.title}`;
  return {
    idea_id: task.idea_id,
    author_id: authorId,
    title: validateDiscussionTitle(task.title),
    body: validateDiscussionBody(
      description ? `${origin}\n\n${description}` : origin
    ),
    status: "open",
  };
}
