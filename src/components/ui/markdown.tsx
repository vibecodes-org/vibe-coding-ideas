"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { Paperclip, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { openAttachment } from "@/lib/attachment-open";
import type { User } from "@/types";

/** The subset of a `board_task_attachments` row the attachment-link matcher and opener need. */
export interface MarkdownAttachment {
  id: string;
  file_name: string;
  content_type: string;
  storage_path: string;
}

interface MarkdownProps {
  children: string;
  className?: string;
  teamMembers?: User[];
  /** Task attachments to linkify by filename. Omit for zero behaviour change. */
  attachments?: MarkdownAttachment[];
}

function renderMentions(text: string, teamMembers?: User[]): React.ReactNode[] {
  // Sort known names longest-first so "Matt Hammond" matches before "Matt"
  const knownNames = (teamMembers ?? [])
    .filter((m) => m.full_name)
    .map((m) => ({ name: m.full_name!, id: m.id, isBot: !!m.is_bot }))
    .sort((a, b) => b.name.length - a.name.length);

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyCounter = 0;

  while (remaining.length > 0) {
    const atIndex = remaining.indexOf("@");
    if (atIndex === -1) {
      parts.push(remaining);
      break;
    }

    // Add text before @
    if (atIndex > 0) {
      parts.push(remaining.slice(0, atIndex));
    }

    const afterAt = remaining.slice(atIndex + 1);

    // Try to match a known team member name (longest match wins)
    let matched = false;
    for (const { name, id, isBot } of knownNames) {
      if (afterAt.toLowerCase().startsWith(name.toLowerCase())) {
        const charAfter = afterAt[name.length];
        // Boundary: end-of-string or non-word character
        if (charAfter === undefined || !/\w/.test(charAfter)) {
          const href = isBot ? "/agents" : `/profile/${id}`;
          parts.push(
            <Link
              key={keyCounter++}
              href={href}
              className="font-medium text-blue-400 hover:text-blue-300 hover:underline"
            >
              @{afterAt.slice(0, name.length)}
            </Link>
          );
          remaining = afterAt.slice(name.length);
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      // Fallback: highlight unrecognized @mentions as styled spans
      const mentionMatch = afterAt.match(/^([A-Za-z][\w]*(?:\s[A-Za-z][\w]*)*)/);
      if (mentionMatch) {
        parts.push(
          <span key={keyCounter++} className="font-medium text-blue-400/70">
            @{mentionMatch[1]}
          </span>
        );
        remaining = afterAt.slice(mentionMatch[1].length);
      } else {
        // Standalone @ with no word following
        parts.push("@");
        remaining = afterAt;
      }
    }
  }

  return parts.length > 0 ? parts : [text];
}

export type AttachmentSegment =
  | { type: "text"; value: string }
  | { type: "attachment"; value: string; attachment: MarkdownAttachment };

/** Char immediately before/after a match must be absent or not one of these to count as a word boundary. */
const WORD_CHAR_RE = /[\w-]/;

/**
 * Pure matcher: splits `text` into plain-text and attachment segments by
 * matching known attachment filenames — longest-first (so "my-report.html"
 * wins over "report.html" when both are present), case-insensitive, with a
 * word-boundary rule so "shortlist.html" doesn't match inside
 * "old-shortlist-DRAFT.html" or "(shortlist.html)." keeps the punctuation
 * outside the link. Exported standalone so it's testable without rendering.
 */
export function matchAttachmentSegments(
  text: string,
  attachments: MarkdownAttachment[] | undefined
): AttachmentSegment[] {
  if (!attachments || attachments.length === 0 || !text) {
    return [{ type: "text", value: text }];
  }

  const candidates = attachments
    .filter((a) => a.file_name.length > 0)
    .sort((a, b) => b.file_name.length - a.file_name.length);

  if (candidates.length === 0) {
    return [{ type: "text", value: text }];
  }

  const isBoundary = (ch: string | undefined) => ch === undefined || !WORD_CHAR_RE.test(ch);

  const segments: AttachmentSegment[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < text.length) {
    if (!isBoundary(text[i - 1])) {
      i++;
      continue;
    }

    let matchedAttachment: MarkdownAttachment | null = null;
    for (const attachment of candidates) {
      const name = attachment.file_name;
      const slice = text.slice(i, i + name.length);
      if (slice.length === name.length && slice.toLowerCase() === name.toLowerCase() && isBoundary(text[i + name.length])) {
        matchedAttachment = attachment;
        break; // candidates sorted longest-first
      }
    }

    if (matchedAttachment) {
      if (i > plainStart) {
        segments.push({ type: "text", value: text.slice(plainStart, i) });
      }
      const value = text.slice(i, i + matchedAttachment.file_name.length);
      segments.push({ type: "attachment", value, attachment: matchedAttachment });
      i += matchedAttachment.file_name.length;
      plainStart = i;
    } else {
      i++;
    }
  }

  if (plainStart < text.length || segments.length === 0) {
    segments.push({ type: "text", value: text.slice(plainStart) });
  }

  return segments;
}

/**
 * Clickable inline reference to a task attachment, rendered in place of its
 * filename in step outputs/comments. Mints a short-lived signed URL on
 * click (no href available up front) and opens it in a new tab — inline
 * types (image/pdf/html/text) open in-browser, everything else downloads.
 */
function AttachmentLink({ attachment, text }: { attachment: MarkdownAttachment; text: string }) {
  const [isMinting, setIsMinting] = useState(false);

  async function handleClick() {
    if (isMinting) return;
    setIsMinting(true);
    try {
      const supabase = createClient();
      await openAttachment(supabase, attachment);
    } catch {
      toast.error("Failed to open attachment — please try again.");
    } finally {
      setIsMinting(false);
    }
  }

  return (
    <button
      type="button"
      title={`Open attachment ${attachment.file_name}`}
      aria-busy={isMinting}
      disabled={isMinting}
      onClick={handleClick}
      className="inline-flex max-w-full items-baseline gap-1 rounded-sm text-left align-baseline font-medium text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300 hover:decoration-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60 cursor-pointer"
    >
      <Paperclip className="h-3 w-3 shrink-0 translate-y-px self-center" aria-hidden="true" />
      <span className="break-all">{text}</span>
      {isMinting && <Loader2 className="h-3 w-3 shrink-0 animate-spin self-center" aria-hidden="true" />}
    </button>
  );
}

/** Recursively process React children: replace string nodes with mention links and/or attachment links. */
function processInlineChildren(
  children: React.ReactNode,
  teamMembers?: User[],
  attachments?: MarkdownAttachment[]
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;

    const hasMention = child.includes("@");
    const hasAttachments = !!attachments && attachments.length > 0;
    if (!hasMention && !hasAttachments) return child;

    // Mentions run first — "@Name" is consumed before attachment matching
    // sees the remaining text, so a filename glued to "@" doesn't steal a
    // mention match (mentions win on their own token; attachments only
    // apply to what's left).
    const mentionParts = hasMention ? renderMentions(child, teamMembers) : [child];

    const finalParts: React.ReactNode[] = [];
    let key = 0;
    for (const part of mentionParts) {
      if (typeof part !== "string") {
        finalParts.push(part);
        continue;
      }
      const segments = matchAttachmentSegments(part, attachments);
      for (const segment of segments) {
        if (segment.type === "text") {
          if (segment.value) finalParts.push(segment.value);
        } else {
          finalParts.push(
            <AttachmentLink key={`attachment-${key++}`} attachment={segment.attachment} text={segment.value} />
          );
        }
      }
    }

    return <>{finalParts}</>;
  });
}

export function Markdown({ children, className, teamMembers, attachments }: MarkdownProps) {
  const m = (c: React.ReactNode) => processInlineChildren(c, teamMembers, attachments);

  return (
    <div className={`min-w-0 overflow-hidden break-words ${className ?? ""}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-4 mb-2">{m(children)}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-bold mt-3 mb-2">{m(children)}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-bold mt-3 mb-1">{m(children)}</h3>
        ),
        p: ({ children }) => <p className="mb-3 last:mb-0">{m(children)}</p>,
        ul: ({ children }) => (
          <ul className="mb-3 ml-6 list-disc space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 ml-6 list-decimal space-y-1">{children}</ol>
        ),
        li: ({ children }) => <li>{m(children)}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
          >
            {children}
          </a>
        ),
        code: ({ className, children, node, ...props }) => {
          // Block code: has language class OR parent is <pre>
          const isBlock = className?.includes("language-") ||
            node?.position?.start?.line !== node?.position?.end?.line;
          if (isBlock) {
            return (
              <code
                className={`block rounded-lg bg-muted p-4 text-sm whitespace-pre ${className ?? ""}`}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm break-all" {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => <pre className="mb-3 last:mb-0 overflow-x-auto max-w-full">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-2 border-primary/30 pl-4 italic text-muted-foreground">
            {m(children)}
          </blockquote>
        ),
        hr: () => <hr className="my-4 border-border" />,
        table: ({ children }) => (
          <div className="mb-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-border bg-muted px-3 py-2 text-left font-medium">
            {m(children)}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-3 py-2">{m(children)}</td>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold">{m(children)}</strong>
        ),
        em: ({ children }) => (
          <em>{m(children)}</em>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
    </div>
  );
}
