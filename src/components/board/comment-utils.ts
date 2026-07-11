/**
 * Pure predicates for task comment edit/delete permissions and the
 * "(edited)" indicator, extracted from TaskCommentsSection so the edge
 * cases (bot-owned authorship, null/matching timestamps) are unit-testable
 * in isolation.
 */

/**
 * Whether the current user may edit/delete a comment: they authored it
 * directly, or they own the bot identity that authored it.
 */
export function canModifyComment(
  authorId: string,
  currentUserId: string,
  userBotIds: string[]
): boolean {
  return authorId === currentUserId || userBotIds.includes(authorId);
}

/**
 * Whether a comment has been edited since creation, i.e. whether the
 * "(edited)" indicator should render. `updated_at` is only bumped by the
 * board_task_comment_updated_at_trigger on UPDATE, so a null/undefined value
 * or a value equal to created_at both mean "never edited".
 */
export function isCommentEdited(
  createdAt: string,
  updatedAt: string | null | undefined
): boolean {
  return Boolean(updatedAt) && updatedAt !== createdAt;
}
