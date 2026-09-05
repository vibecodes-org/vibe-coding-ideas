/**
 * Builds the subject + HTML body for a notification email.
 *
 * Extracted from the /api/notifications/email route so the copy — and the
 * snippet handling that feeds it — can be unit tested without going through
 * a Request/Response cycle. Keep this module pure (no Supabase, no fetch);
 * the route stays responsible for I/O.
 */

import { buildEmailHtml } from "@/lib/email-template";
import type { Database } from "@/types/database";

type NotificationType = Database["public"]["Enums"]["notification_type"];

export const SNIPPET_MAX_LENGTH = 200;

/**
 * Strips common markdown syntax down to its plain-text content, since
 * comments are authored as markdown (rendered via react-markdown) but the
 * email body is plain HTML — raw `**bold**` / `[link](url)` / code fences
 * read as noise rather than formatting once dropped into an email.
 */
export function stripMarkdown(text: string): string {
  return text
    // Fenced code blocks: keep the code, drop the ``` fences and language tag.
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    // Inline code: `code` -> code
    .replace(/`([^`]+)`/g, "$1")
    // Images: ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Links: [text](url) -> text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Bold/italic: **text**, __text__, *text*, _text_ -> text
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    // Strikethrough: ~~text~~ -> text
    .replace(/~~(.+?)~~/g, "$1")
    // Headings and blockquote markers at the start of a line
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    // Collapse runs of whitespace/newlines into single spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Truncates to at most `maxLength` characters, appending an ellipsis only
 * when text was actually cut. Text at or under the limit is returned as-is.
 */
export function truncateSnippet(text: string, maxLength = SNIPPET_MAX_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

/**
 * Turns a raw comment/description body into an email-ready snippet: markdown
 * stripped, whitespace collapsed, truncated. Returns null for empty/missing
 * input so callers can fall back to today's content-free sentence.
 */
export function buildSnippet(
  raw: string | null | undefined,
  maxLength = SNIPPET_MAX_LENGTH,
): string | null {
  if (!raw) return null;
  const plain = stripMarkdown(raw);
  return plain ? truncateSnippet(plain, maxLength) : null;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Notification types whose email includes a quoted snippet when one is available. */
const SNIPPET_ELIGIBLE_TYPES: NotificationType[] = [
  "comment",
  "task_mention",
  "comment_mention",
  "discussion_reply",
  "discussion_mention",
];

/**
 * Where the quoted snippet's raw text comes from, for a given notification.
 * `null` means there is nothing genuine to quote — render the plain
 * sentence instead, never a description that didn't actually trigger this
 * notification (see selectSnippetSource for the per-type rule).
 */
export type SnippetSource =
  | "comment"
  | "reply"
  | "task_description"
  | "discussion_body"
  | null;

export interface SnippetSourceInputs {
  type: NotificationType;
  /** Whether the notification row carries a real comment_id (idea comments — "comment"/"comment_mention" only). */
  hasCommentId: boolean;
  /**
   * Whether the notification row carries a real task_comment_id (a genuine
   * board_task_comments mention — "task_mention" only). `comment_id` cannot
   * carry this: it's FK'd to `comments`, not `board_task_comments` (see
   * supabase/migrations/00166_notifications_task_comment_id.sql).
   */
  hasTaskCommentId: boolean;
  /** Whether the notification row carries a real reply_id. */
  hasReplyId: boolean;
  commentBody: string | null;
  replyBody: string | null;
  taskDescription: string | null;
  discussionBody: string | null;
}

export interface SnippetSourceResult {
  source: SnippetSource;
  /** Raw (unstripped, untruncated) text to feed into buildSnippet, or null. */
  raw: string | null;
}

/**
 * Picks which piece of fetched content, if any, genuinely triggered this
 * notification and is safe to quote.
 *
 * The rule that matters: a description (idea or task) is only a legitimate
 * source when the description itself IS the thing that fired the
 * notification. Everywhere else, if there's no real comment/reply body,
 * quoting a description would misattribute it — e.g. `discussion_reply`
 * notifications never carry a reply_id (the trigger that inserts them
 * doesn't record which reply caused it), so without this gate the route
 * used to fall through to the idea's description and present it as if it
 * were the person's reply. Render nothing rather than guess.
 */
export function selectSnippetSource({
  type,
  // hasCommentId (idea comments) intentionally unused here: no branch below
  // needs it — "comment"/"comment_mention" always quote commentBody
  // unconditionally, and "task_mention" now gates on hasTaskCommentId only.
  // Kept in SnippetSourceInputs purely as documentation of what the route
  // actually has available, and to keep the route's call site symmetric.
  hasTaskCommentId,
  hasReplyId,
  commentBody,
  replyBody,
  taskDescription,
  discussionBody,
}: SnippetSourceInputs): SnippetSourceResult {
  switch (type) {
    // Always driven by a real comment row. If it can't be resolved (e.g. the
    // comment was deleted between insert and send), say nothing — don't
    // fall back to the idea description.
    case "comment":
    case "comment_mention":
      return { source: "comment", raw: commentBody };

    case "task_mention":
      // With a task_comment_id, this fired from an actual task comment
      // mention. Without one, it's either a task description edit (the
      // "@mention in the description" path) or a workflow-step-comment
      // mention that has no notifications column to carry its id (see
      // workflows.ts) — those two are indistinguishable from the row alone,
      // so both take the description branch; the step-comment case is a
      // known, accepted inaccuracy (see workflows.ts's comment).
      return hasTaskCommentId
        ? { source: "comment", raw: commentBody }
        : { source: "task_description", raw: taskDescription };

    // The trigger behind this notification never records which reply
    // caused it — there is no reply_id to look up, so there is no real
    // body to quote.
    case "discussion_reply":
      return { source: null, raw: null };

    case "discussion_mention":
      // With a reply_id, the mention was inside a reply. Without one, the
      // mention was in the discussion post itself (new discussion, or an
      // edit of its body) — that body genuinely is what triggered it.
      return hasReplyId
        ? { source: "reply", raw: replyBody }
        : { source: "discussion_body", raw: discussionBody };

    // The idea's description didn't change — its status did. Quoting the
    // description here was the same misattribution bug as the others: real
    // content that just happened to be fetchable, presented as if it were
    // the thing that triggered the notification. There's nothing to quote;
    // buildNotificationEmail states the new status directly instead.
    case "status_change":
      return { source: null, raw: null };

    default:
      return { source: null, raw: null };
  }
}

function quoteBlock(snippet: string): string {
  return `<blockquote style="margin:12px 0 0;padding:12px 16px;border-left:3px solid #52525b;background-color:#27272a;border-radius:6px;color:#d4d4d8;font-size:14px;line-height:1.5;">"${escapeHtml(snippet)}"</blockquote>`;
}

/** Max length of a title fragment quoted directly in a subject line. */
const SUBJECT_TITLE_MAX = 60;
/** Shorter cap for a title used as a parenthetical suffix in a subject line. */
const SUBJECT_PAREN_MAX = 40;

/** Truncates a title for use in a subject line, distinct from body-snippet truncation. */
function truncateForSubject(text: string, maxLength: number): string {
  return truncateSnippet(text, maxLength);
}

export interface BuildNotificationEmailParams {
  type: NotificationType;
  actorName: string;
  ideaTitle: string | null;
  taskTitle: string | null;
  /** Pre-stripped, pre-truncated plain-text snippet (see buildSnippet), or null. */
  snippet: string | null;
  ctaUrl: string;
  /**
   * Which source the snippet came from (see selectSnippetSource) — used to
   * pick accurate wording for types where the sentence differs by source
   * (e.g. task_mention: "in a comment" vs "in the description").
   */
  snippetSource?: SnippetSource;
  /**
   * Human-readable label for the idea's status at send time (e.g. "In
   * Progress"), used only by status_change. The notification row itself
   * never records what changed — this is the idea's CURRENT status, fetched
   * by the route, which is correct because the row is updated before the
   * notification fires. Null when unavailable — the sentence degrades to
   * "has been updated" with no destination named, never a guess.
   */
  newStatusLabel?: string | null;
  /**
   * Discussion title, used only by discussion_reply so its subject can name
   * the discussion instead of just the idea (see comment_mention/task_mention
   * for the equivalent pattern). Null when unavailable.
   */
  discussionTitle?: string | null;
}

export function buildNotificationEmail({
  type,
  actorName,
  ideaTitle,
  taskTitle,
  snippet,
  ctaUrl,
  snippetSource = null,
  newStatusLabel = null,
  discussionTitle = null,
}: BuildNotificationEmailParams): { subject: string; html: string } | null {
  const ideaDisplay = ideaTitle
    ? `<strong style="color:#fafafa;">${escapeHtml(ideaTitle)}</strong>`
    : "your idea";
  const ideaSubjectFragment = ideaTitle ? truncateForSubject(ideaTitle, SUBJECT_TITLE_MAX) : null;
  const snippetHtml =
    snippet && SNIPPET_ELIGIBLE_TYPES.includes(type) ? quoteBlock(snippet) : "";
  const preheaderText = snippetHtml ? (snippet ?? undefined) : undefined;

  switch (type) {
    case "comment": {
      return {
        subject: ideaSubjectFragment
          ? `${actorName} commented on "${ideaSubjectFragment}"`
          : `${actorName} commented on your idea`,
        html: buildEmailHtml({
          heading: "New comment on your idea",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} left a comment on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Comment",
          ctaUrl,
          footerText: "You received this because someone commented on your idea.",
          preheaderText,
        }),
      };
    }

    case "collaborator": {
      return {
        subject: ideaSubjectFragment
          ? `${actorName} joined "${ideaSubjectFragment}"`
          : `${actorName} joined your idea`,
        html: buildEmailHtml({
          heading: "New collaborator",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} is now collaborating on ${ideaDisplay}.</p>`,
          ctaText: "View Idea",
          ctaUrl,
          footerText: "You received this because of collaborator activity on your idea.",
        }),
      };
    }

    case "status_change": {
      // No snippet: the description never changed, so there's nothing
      // genuine to quote (see selectSnippetSource). State the new status
      // directly when it's available instead.
      const toClause = newStatusLabel
        ? ` to <strong style="color:#fafafa;">${escapeHtml(newStatusLabel)}</strong>`
        : "";
      return {
        subject: ideaSubjectFragment
          ? `Status updated: "${ideaSubjectFragment}"`
          : "An idea you collaborate on was updated",
        html: buildEmailHtml({
          heading: "Idea status updated",
          bodyHtml: `<p style="margin:0;">The status of ${ideaDisplay} has been updated${toClause}.</p>`,
          ctaText: "View Idea",
          ctaUrl,
          footerText: "You received this because you collaborate on this idea.",
        }),
      };
    }

    case "task_mention": {
      const taskDisplay = taskTitle
        ? `<strong style="color:#fafafa;">${escapeHtml(taskTitle)}</strong>`
        : "a task";
      const taskSubjectFragment = taskTitle
        ? truncateForSubject(taskTitle, SUBJECT_TITLE_MAX)
        : null;
      const subject = taskSubjectFragment
        ? `${actorName} mentioned you in "${taskSubjectFragment}"${ideaSubjectFragment ? ` (${truncateForSubject(ideaTitle!, SUBJECT_PAREN_MAX)})` : ""}`
        : `${actorName} mentioned you in a task`;
      // The wording distinguishes a real comment mention from a mention
      // made while editing the task's description — same notification
      // type, different thing actually happened.
      const mentionedIn =
        snippetSource === "task_description" ? "the description of" : "a comment on";
      return {
        subject,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} mentioned you in ${mentionedIn} ${taskDisplay}${ideaTitle ? ` (${ideaDisplay})` : ""}.</p>${snippetHtml}`,
          ctaText: "View Task",
          ctaUrl,
          footerText: "You received this because you were mentioned in a task.",
          preheaderText,
        }),
      };
    }

    case "comment_mention": {
      return {
        subject: ideaSubjectFragment
          ? `${actorName} mentioned you in a comment on "${ideaSubjectFragment}"`
          : `${actorName} mentioned you in a comment`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} mentioned you in a comment on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Comment",
          ctaUrl,
          footerText: "You received this because you were mentioned in a comment.",
          preheaderText,
        }),
      };
    }

    case "collaboration_request": {
      return {
        subject: ideaSubjectFragment
          ? `${actorName} wants to collaborate on "${ideaSubjectFragment}"`
          : `${actorName} wants to collaborate on your idea`,
        html: buildEmailHtml({
          heading: "New collaboration request",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} has requested to collaborate on ${ideaDisplay}.</p>`,
          ctaText: "Review Request",
          ctaUrl,
          footerText: "You received this because someone wants to collaborate on your idea.",
        }),
      };
    }

    case "collaboration_response": {
      return {
        subject: ideaSubjectFragment
          ? `Your collaboration request on "${ideaSubjectFragment}" was reviewed`
          : `Your collaboration request was reviewed`,
        html: buildEmailHtml({
          heading: "Collaboration request update",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} responded to your collaboration request on ${ideaDisplay}.</p>`,
          ctaText: "View Idea",
          ctaUrl,
          footerText: "You received this because your collaboration request was reviewed.",
        }),
      };
    }

    case "discussion": {
      return {
        subject: ideaSubjectFragment
          ? `${actorName} started a discussion on "${ideaSubjectFragment}"`
          : `${actorName} started a discussion on your idea`,
        html: buildEmailHtml({
          heading: "New discussion",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} started a new discussion on ${ideaDisplay}.</p>`,
          ctaText: "View Discussion",
          ctaUrl,
          footerText: "You received this because a new discussion was started on your idea.",
        }),
      };
    }

    case "discussion_reply": {
      // Name the discussion itself when its title is available (the row
      // carries discussion_id but not which reply — see selectSnippetSource
      // — so the title is the only real content the subject can offer).
      const discussionSubjectFragment = discussionTitle
        ? truncateForSubject(discussionTitle, SUBJECT_TITLE_MAX)
        : null;
      const subject = discussionSubjectFragment
        ? `${actorName} replied to "${discussionSubjectFragment}"${ideaSubjectFragment ? ` (${truncateForSubject(ideaTitle!, SUBJECT_PAREN_MAX)})` : ""}`
        : ideaSubjectFragment
          ? `${actorName} replied to a discussion on "${ideaSubjectFragment}"`
          : `${actorName} replied to a discussion`;
      return {
        subject,
        html: buildEmailHtml({
          heading: "New discussion reply",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} replied to a discussion on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Discussion",
          ctaUrl,
          footerText: "You received this because someone replied to a discussion you participated in.",
          preheaderText,
        }),
      };
    }

    case "discussion_mention": {
      return {
        subject: ideaSubjectFragment
          ? `${actorName} mentioned you in a discussion on "${ideaSubjectFragment}"`
          : `${actorName} mentioned you in a discussion`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} mentioned you in a discussion on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Discussion",
          ctaUrl,
          footerText: "You received this because you were mentioned in a discussion.",
          preheaderText,
        }),
      };
    }

    default:
      return null;
  }
}
