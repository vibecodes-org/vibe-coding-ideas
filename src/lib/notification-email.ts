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
  "status_change",
];

function quoteBlock(snippet: string): string {
  return `<blockquote style="margin:12px 0 0;padding:12px 16px;border-left:3px solid #52525b;background-color:#27272a;border-radius:6px;color:#d4d4d8;font-size:14px;line-height:1.5;">"${escapeHtml(snippet)}"</blockquote>`;
}

export interface BuildNotificationEmailParams {
  type: NotificationType;
  actorName: string;
  ideaTitle: string | null;
  taskTitle: string | null;
  /** Pre-stripped, pre-truncated plain-text snippet (see buildSnippet), or null. */
  snippet: string | null;
  ctaUrl: string;
}

export function buildNotificationEmail({
  type,
  actorName,
  ideaTitle,
  taskTitle,
  snippet,
  ctaUrl,
}: BuildNotificationEmailParams): { subject: string; html: string } | null {
  const ideaDisplay = ideaTitle
    ? `<strong style="color:#fafafa;">${escapeHtml(ideaTitle)}</strong>`
    : "your idea";
  const snippetHtml =
    snippet && SNIPPET_ELIGIBLE_TYPES.includes(type) ? quoteBlock(snippet) : "";

  switch (type) {
    case "comment": {
      return {
        subject: `${actorName} commented on your idea`,
        html: buildEmailHtml({
          heading: "New comment on your idea",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} left a comment on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Comment",
          ctaUrl,
          footerText: "You received this because someone commented on your idea.",
        }),
      };
    }

    case "collaborator": {
      return {
        subject: `${actorName} joined your idea`,
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
      return {
        subject: ideaTitle
          ? `Status updated: ${ideaTitle}`
          : "An idea you collaborate on was updated",
        html: buildEmailHtml({
          heading: "Idea status updated",
          bodyHtml: `<p style="margin:0;">The status of ${ideaDisplay} has been updated.</p>${snippetHtml}`,
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
      return {
        subject: `${actorName} mentioned you in a task`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} mentioned you in a comment on ${taskDisplay}${ideaTitle ? ` (${ideaDisplay})` : ""}.</p>${snippetHtml}`,
          ctaText: "View Task",
          ctaUrl,
          footerText: "You received this because you were mentioned in a task comment.",
        }),
      };
    }

    case "comment_mention": {
      return {
        subject: `${actorName} mentioned you in a comment`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} mentioned you in a comment on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Comment",
          ctaUrl,
          footerText: "You received this because you were mentioned in a comment.",
        }),
      };
    }

    case "collaboration_request": {
      return {
        subject: `${actorName} wants to collaborate on your idea`,
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
        subject: `Your collaboration request was reviewed`,
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
        subject: `${actorName} started a discussion on your idea`,
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
      return {
        subject: `${actorName} replied to a discussion`,
        html: buildEmailHtml({
          heading: "New discussion reply",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} replied to a discussion on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Discussion",
          ctaUrl,
          footerText: "You received this because someone replied to a discussion you participated in.",
        }),
      };
    }

    case "discussion_mention": {
      return {
        subject: `${actorName} mentioned you in a discussion`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeHtml(actorName)} mentioned you in a discussion on ${ideaDisplay}.</p>${snippetHtml}`,
          ctaText: "View Discussion",
          ctaUrl,
          footerText: "You received this because you were mentioned in a discussion.",
        }),
      };
    }

    default:
      return null;
  }
}
