"use client";

import { useState, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MentionAutocomplete } from "@/components/board/mention-autocomplete";
import { createComment } from "@/actions/comments";
import { createClient } from "@/lib/supabase/client";
import { logger } from "@/lib/logger";
import { COMMENT_TYPE_CONFIG } from "@/lib/constants";
import type { CommentType, User } from "@/types";

interface CommentFormProps {
  ideaId: string;
  parentCommentId?: string;
  onCancel?: () => void;
  teamMembers?: User[];
  currentUserId?: string;
}

export function CommentForm({
  ideaId,
  parentCommentId,
  onCancel,
  teamMembers = [],
  currentUserId,
}: CommentFormProps) {
  const [content, setContent] = useState("");
  const [type, setType] = useState<CommentType>("comment");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionedUserIds, setMentionedUserIds] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    return teamMembers.filter((m) =>
      m.full_name?.toLowerCase().includes(mentionQuery.toLowerCase())
    );
  }, [teamMembers, mentionQuery]);

  function detectMention(value: string, cursorPos: number) {
    const textBeforeCursor = value.slice(0, cursorPos);
    const match = textBeforeCursor.match(/(?:^|[\s])@(\S*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setContent(value);
    detectMention(value, e.target.selectionStart);
  }

  function handleMentionSelect(user: User) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = content.slice(0, cursorPos);
    const textAfterCursor = content.slice(cursorPos);

    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex === -1) return;

    const name = user.full_name ?? user.email;
    const newText = textBeforeCursor.slice(0, atIndex) + `@${name} ` + textAfterCursor;
    setContent(newText);
    setMentionQuery(null);

    setMentionedUserIds((prev) => new Set(prev).add(user.id));

    requestAnimationFrame(() => {
      textarea.focus();
      const newCursorPos = atIndex + name.length + 2;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery === null || filteredMembers.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((prev) => (prev < filteredMembers.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((prev) => (prev > 0 ? prev - 1 : filteredMembers.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleMentionSelect(filteredMembers[mentionIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMentionQuery(null);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSubmitting) return;

    const savedMentionedUserIds = new Set(mentionedUserIds);
    setIsSubmitting(true);
    try {
      await createComment(ideaId, content.trim(), type, parentCommentId);

      // Send mention notifications
      if (savedMentionedUserIds.size > 0 && currentUserId) {
        const supabase = createClient();
        for (const userId of savedMentionedUserIds) {
          if (userId === currentUserId) continue;
          const member = teamMembers.find((m) => m.id === userId);
          if (!member) continue;
          if (member.notification_preferences?.comment_mentions === false) continue;
          supabase
            .from("notifications")
            .insert({
              user_id: userId,
              actor_id: currentUserId,
              type: "comment_mention" as const,
              idea_id: ideaId,
            })
            .then(({ error }) => {
              if (error) logger.error("Failed to send mention notification", { error: error.message, userId });
            });
        }
      }

      setContent("");
      setType("comment");
      setMentionedUserIds(new Set());
      setMentionQuery(null);
      onCancel?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasMentions = teamMembers.length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        {mentionQuery !== null && hasMentions && (
          <MentionAutocomplete
            filteredMembers={filteredMembers}
            selectedIndex={mentionIndex}
            onSelect={handleMentionSelect}
          />
        )}
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            parentCommentId
              ? "Write a reply..."
              : hasMentions
                ? "Add a comment... (@ to mention)"
                : "Add a comment..."
          }
          rows={3}
        />
      </div>
      <div className="flex items-center justify-between">
        <Select value={type} onValueChange={(v) => setType(v as CommentType)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(COMMENT_TYPE_CONFIG) as [CommentType, typeof COMMENT_TYPE_CONFIG[CommentType]][]).map(
              ([value, config]) => (
                <SelectItem key={value} value={value}>
                  {config.label}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting || !content.trim()}>
            {isSubmitting ? "Posting..." : "Post"}
          </Button>
        </div>
      </div>
    </form>
  );
}
