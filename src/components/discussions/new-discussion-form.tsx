"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2 } from "lucide-react";
import { MentionAutocomplete } from "@/components/board/mention-autocomplete";
import { createDiscussion } from "@/actions/discussions";
import { enhanceDiscussionBody } from "@/actions/ai";
import { useMentionState } from "@/hooks/use-mentions";
import { sendDiscussionMentionNotifications } from "@/lib/mention-notifications";
import { MAX_TITLE_LENGTH, MAX_DISCUSSION_BODY_LENGTH } from "@/lib/validation";
import type { User } from "@/types";

interface NewDiscussionFormProps {
  ideaId: string;
  teamMembers?: User[];
  currentUserId?: string;
  canUseAi?: boolean;
}

export function NewDiscussionForm({
  ideaId,
  teamMembers = [],
  currentUserId,
  canUseAi = false,
}: NewDiscussionFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  const showAiEnhance = canUseAi && body.trim().length > 0;

  async function handleEnhanceBody() {
    setEnhancing(true);
    try {
      const { enhanced } = await enhanceDiscussionBody(ideaId, title, body);
      setBody(enhanced);
      toast.success("Body enhanced");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enhance");
    } finally {
      setEnhancing(false);
    }
  }

  const mention = useMentionState(teamMembers);

  function handleBodyInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    mention.detectMention(value, e.target.selectionStart);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required");
      return;
    }

    const savedMentionedUserIds = new Set(mention.mentionedUserIds);
    setIsSubmitting(true);
    try {
      const discussionId = await createDiscussion(ideaId, title, body);

      // Send mention notifications (fire-and-forget)
      if (savedMentionedUserIds.size > 0 && currentUserId) {
        sendDiscussionMentionNotifications(
          savedMentionedUserIds,
          currentUserId,
          teamMembers,
          ideaId,
          discussionId
        );
      }

      toast.success("Discussion created");
      router.push(`/ideas/${ideaId}/discussions/${discussionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create discussion";
      if (message.includes("NEXT_REDIRECT")) throw err;
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="What would you like to discuss?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={MAX_TITLE_LENGTH}
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="body">Body</Label>
        <div className="relative">
          {mention.mentionQuery !== null && mention.hasMentions && (
            <MentionAutocomplete
              filteredMembers={mention.filteredMembers}
              selectedIndex={mention.mentionIndex}
              onSelect={(user) => mention.handleMentionSelect(body, setBody, user)}
            />
          )}
          <Textarea
            ref={mention.textareaRef}
            id="body"
            placeholder={
              mention.hasMentions
                ? "Provide context, share research, or outline your proposal... Tip: @ mention your agents to get their input!"
                : "Provide context, share research, or outline your proposal..."
            }
            value={body}
            onChange={handleBodyInputChange}
            onKeyDown={(e) => mention.handleKeyDown(e, body, setBody)}
            maxLength={MAX_DISCUSSION_BODY_LENGTH}
            rows={10}
            className="min-h-[200px] resize-y"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Markdown supported &middot; {body.length.toLocaleString()}/{MAX_DISCUSSION_BODY_LENGTH.toLocaleString()}
        </p>
      </div>
      <div className="flex gap-3">
        <Button type="submit" disabled={isSubmitting || !title.trim() || !body.trim()}>
          {isSubmitting ? "Creating..." : "Create Discussion"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        {showAiEnhance && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleEnhanceBody}
            disabled={enhancing || isSubmitting}
            className="gap-1.5 text-xs text-muted-foreground"
          >
            {enhancing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {enhancing ? "Enhancing..." : "Enhance with AI"}
          </Button>
        )}
      </div>
    </form>
  );
}
