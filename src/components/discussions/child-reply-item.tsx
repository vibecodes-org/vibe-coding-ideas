"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip, Pencil, Reply, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { MentionAutocomplete } from "@/components/board/mention-autocomplete";
import { updateDiscussionReply } from "@/actions/discussions";
import { useMentionState } from "@/hooks/use-mentions";
import { sendDiscussionMentionNotifications } from "@/lib/mention-notifications";
import { useBotRoles } from "@/components/bot-roles-context";
import { formatRelativeTime, getInitials } from "@/lib/utils";
import {
  DiscussionAttachmentsSection,
  type DiscussionAttachmentsHandle,
} from "./discussion-attachments-section";
import type { IdeaDiscussionReplyWithAuthor, User } from "@/types";

interface ChildReplyItemProps {
  reply: IdeaDiscussionReplyWithAuthor;
  parentAuthorName: string | null;
  ideaId: string;
  discussionId: string;
  discussionAuthorId: string;
  currentUser: User | null;
  isAuthorOrOwner: boolean;
  isTeamMember: boolean;
  onDelete: (id: string) => void;
  teamMembers?: User[];
}

export function ChildReplyItem({
  reply,
  parentAuthorName,
  ideaId,
  discussionId,
  discussionAuthorId,
  currentUser,
  isAuthorOrOwner,
  isTeamMember,
  onDelete,
  teamMembers = [],
}: ChildReplyItemProps) {
  const router = useRouter();
  const botRoles = useBotRoles();
  const attachmentsRef = useRef<DiscussionAttachmentsHandle>(null);
  const canDeleteReply =
    currentUser?.id === reply.author_id || isAuthorOrOwner || currentUser?.is_admin;
  const canEdit = currentUser?.id === reply.author_id;

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(reply.content);
  const [isSaving, setIsSaving] = useState(false);

  const mention = useMentionState(teamMembers);

  async function handleSave() {
    if (!editContent.trim()) {
      toast.error("Reply cannot be empty");
      return;
    }
    const savedMentionedUserIds = new Set(mention.mentionedUserIds);
    setIsSaving(true);
    try {
      await updateDiscussionReply(reply.id, ideaId, discussionId, editContent);

      if (currentUser) {
        sendDiscussionMentionNotifications(
          savedMentionedUserIds,
          currentUser.id,
          teamMembers,
          ideaId,
          discussionId,
          reply.id
        );
      }

      toast.success("Reply updated");
      setIsEditing(false);
      mention.setMentionedUserIds(new Set());
      mention.setMentionQuery(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setEditContent(reply.content);
    setIsEditing(false);
    mention.setMentionedUserIds(new Set());
    mention.setMentionQuery(null);
  }

  return (
    <div className="flex gap-3">
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarImage src={reply.author.avatar_url ?? undefined} />
        <AvatarFallback className="text-[10px]">
          {getInitials(reply.author.full_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {reply.author.full_name ?? "Anonymous"}
          </span>
          {reply.author.is_bot && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] cursor-help">
                  Agent
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {reply.author.full_name ?? "Agent"} ({botRoles?.[reply.author.id] ?? "Agent"})
              </TooltipContent>
            </Tooltip>
          )}
          {reply.author_id === discussionAuthorId && (
            <Badge variant="outline" className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px]">
              Author
            </Badge>
          )}
          {parentAuthorName && (
            <span className="text-xs text-muted-foreground">
              <Reply className="mr-0.5 inline h-3 w-3" />
              {parentAuthorName}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(reply.created_at)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {isTeamMember && !isEditing && (
              <button
                onClick={() => attachmentsRef.current?.triggerUpload()}
                className="text-xs text-muted-foreground hover:text-foreground"
                title="Attach file"
              >
                <Paperclip className="h-3 w-3" />
              </button>
            )}
            {canEdit && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
                title="Edit reply"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {canDeleteReply && !isEditing && (
              <button
                onClick={() => onDelete(reply.id)}
                className="text-xs text-muted-foreground hover:text-destructive"
                title="Delete reply"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        {isEditing ? (
          <div className="mt-1 space-y-2">
            <div className="relative">
              {mention.mentionQuery !== null && mention.hasMentions && (
                <MentionAutocomplete
                  filteredMembers={mention.filteredMembers}
                  selectedIndex={mention.mentionIndex}
                  onSelect={(user) =>
                    mention.handleMentionSelect(
                      editContent,
                      setEditContent,
                      user
                    )
                  }
                />
              )}
              <Textarea
                ref={mention.textareaRef}
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  mention.detectMention(
                    e.target.value,
                    e.target.selectionStart
                  );
                }}
                onKeyDown={(e) =>
                  mention.handleKeyDown(e, editContent, setEditContent)
                }
                rows={3}
                className="min-h-[60px] resize-y text-sm"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isSaving || !editContent.trim()}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm">
            <Markdown teamMembers={teamMembers}>{reply.content}</Markdown>
          </div>
        )}
        {/* Attachment chips */}
        {currentUser && (
          <DiscussionAttachmentsSection
            ref={attachmentsRef}
            discussionId={discussionId}
            ideaId={ideaId}
            currentUserId={currentUser.id}
            isAuthor={isAuthorOrOwner}
            isTeamMember={isTeamMember}
            replyId={reply.id}
          />
        )}
      </div>
    </div>
  );
}
