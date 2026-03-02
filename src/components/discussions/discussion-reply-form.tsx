"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MentionAutocomplete } from "@/components/board/mention-autocomplete";
import { createDiscussionReply } from "@/actions/discussions";
import { useMentionState } from "@/hooks/use-mentions";
import { sendDiscussionMentionNotifications } from "@/lib/mention-notifications";
import { MAX_DISCUSSION_REPLY_LENGTH } from "@/lib/validation";
import { getInitials } from "@/lib/utils";
import type { User } from "@/types";

interface DiscussionReplyFormProps {
  discussionId: string;
  ideaId: string;
  currentUser: User;
  parentReplyId?: string | null;
  onCancel?: () => void;
  compact?: boolean;
  teamMembers?: User[];
}

export function DiscussionReplyForm({
  discussionId,
  ideaId,
  currentUser,
  parentReplyId,
  onCancel,
  compact = false,
  teamMembers = [],
}: DiscussionReplyFormProps) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mention = useMentionState(teamMembers);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setContent(value);
    mention.detectMention(value, e.target.selectionStart);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    const savedMentionedUserIds = new Set(mention.mentionedUserIds);
    setIsSubmitting(true);
    try {
      const replyId = await createDiscussionReply(discussionId, ideaId, content, parentReplyId);

      // Send mention notifications (fire-and-forget)
      if (savedMentionedUserIds.size > 0 && currentUser.id) {
        sendDiscussionMentionNotifications(
          savedMentionedUserIds,
          currentUser.id,
          teamMembers,
          ideaId,
          discussionId,
          replyId
        );
      }

      setContent("");
      mention.setMentionedUserIds(new Set());
      mention.setMentionQuery(null);
      toast.success("Reply posted");
      router.refresh();
      onCancel?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to post reply");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className="mt-2 space-y-2">
        <div className="relative">
          {mention.mentionQuery !== null && mention.hasMentions && (
            <MentionAutocomplete
              filteredMembers={mention.filteredMembers}
              selectedIndex={mention.mentionIndex}
              onSelect={(user) => mention.handleMentionSelect(content, setContent, user)}
            />
          )}
          <Textarea
            ref={mention.textareaRef}
            placeholder={mention.hasMentions ? "Write a reply... (@ to mention)" : "Write a reply..."}
            value={content}
            onChange={handleInputChange}
            onKeyDown={(e) => mention.handleKeyDown(e, content, setContent)}
            maxLength={MAX_DISCUSSION_REPLY_LENGTH}
            rows={2}
            className="min-h-[60px] resize-y text-sm"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting || !content.trim()}>
            {isSubmitting ? "Replying..." : "Reply"}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Avatar className="h-5 w-5">
          <AvatarImage src={currentUser.avatar_url ?? undefined} />
          <AvatarFallback className="text-[8px]">
            {getInitials(currentUser.full_name)}
          </AvatarFallback>
        </Avatar>
        Reply as {currentUser.full_name ?? "Anonymous"}
      </div>
      <div className="relative">
        {mention.mentionQuery !== null && mention.hasMentions && (
          <MentionAutocomplete
            filteredMembers={mention.filteredMembers}
            selectedIndex={mention.mentionIndex}
            onSelect={(user) => mention.handleMentionSelect(content, setContent, user)}
          />
        )}
        <Textarea
          ref={mention.textareaRef}
          placeholder={mention.hasMentions ? "Write a reply... Tip: @ mention your agents to get their input!" : "Write a reply..."}
          value={content}
          onChange={handleInputChange}
          onKeyDown={(e) => mention.handleKeyDown(e, content, setContent)}
          maxLength={MAX_DISCUSSION_REPLY_LENGTH}
          rows={3}
          className="min-h-[80px] resize-y"
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Markdown supported</span>
        <Button type="submit" size="sm" disabled={isSubmitting || !content.trim()}>
          {isSubmitting ? "Replying..." : "Reply"}
        </Button>
      </div>
    </form>
  );
}
