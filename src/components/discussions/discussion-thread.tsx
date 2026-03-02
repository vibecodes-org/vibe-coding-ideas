"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  MessageSquare,
  Check,
  ArrowRightLeft,
  ClipboardCheck,
  Pin,
  Trash2,
  Pencil,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Markdown } from "@/components/ui/markdown";
import { MentionAutocomplete } from "@/components/board/mention-autocomplete";
import {
  updateDiscussion,
  deleteDiscussion,
  deleteDiscussionReply,
} from "@/actions/discussions";
import { enhanceDiscussionBody } from "@/actions/ai";
import { useMentionState } from "@/hooks/use-mentions";
import { sendDiscussionMentionNotifications } from "@/lib/mention-notifications";
import { formatRelativeTime } from "@/lib/utils";
import { DiscussionReplyForm } from "./discussion-reply-form";
import { DiscussionVoteButton } from "./discussion-vote-button";
import { ConvertToTaskDialog } from "./convert-to-task-dialog";
import { ReadyToConvertDialog } from "./ready-to-convert-dialog";
import { ReplyItem } from "./reply-item";
import type {
  IdeaDiscussionDetail,
  IdeaDiscussionReplyWithAuthor,
  IdeaDiscussionReplyWithChildren,
  User,
  BoardColumn,
} from "@/types";

const STATUS_CONFIG = {
  open: {
    label: "Open",
    icon: MessageSquare,
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  resolved: {
    label: "Resolved",
    icon: Check,
    className: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  ready_to_convert: {
    label: "Ready to Convert",
    icon: ClipboardCheck,
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  converted: {
    label: "Converted",
    icon: ArrowRightLeft,
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
} as const;

/** Organize flat replies into a tree (single-level nesting) */
export function buildReplyTree(
  replies: IdeaDiscussionReplyWithAuthor[]
): IdeaDiscussionReplyWithChildren[] {
  const topLevel: IdeaDiscussionReplyWithChildren[] = [];
  const childMap = new Map<string, IdeaDiscussionReplyWithAuthor[]>();

  for (const reply of replies) {
    if (reply.parent_reply_id) {
      const existing = childMap.get(reply.parent_reply_id) ?? [];
      existing.push(reply);
      childMap.set(reply.parent_reply_id, existing);
    } else {
      topLevel.push({ ...reply, children: [] });
    }
  }

  for (const parent of topLevel) {
    parent.children = childMap.get(parent.id) ?? [];
  }

  return topLevel;
}

// ─── Main Component ──────────────────────────────────────────────────────

interface DiscussionThreadProps {
  discussion: IdeaDiscussionDetail;
  ideaId: string;
  currentUser: User | null;
  isAuthorOrOwner: boolean;
  isTeamMember: boolean;
  columns: BoardColumn[];
  convertedTaskId?: string | null;
  hasVoted?: boolean;
  teamMembers?: User[];
  hasApiKey?: boolean;
}

export function DiscussionThread({
  discussion,
  ideaId,
  currentUser,
  isAuthorOrOwner,
  isTeamMember,
  columns,
  convertedTaskId,
  hasVoted = false,
  teamMembers = [],
  hasApiKey = false,
}: DiscussionThreadProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(discussion.title);
  const [editBody, setEditBody] = useState(discussion.body);
  const [isSaving, setIsSaving] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const config = STATUS_CONFIG[discussion.status];
  const StatusIcon = config.icon;

  const showAiEnhance = hasApiKey && discussion.body.trim().length > 10;

  const mention = useMentionState(teamMembers);

  async function handleEnhanceBody() {
    setEnhancing(true);
    try {
      const { enhanced } = await enhanceDiscussionBody(ideaId, discussion.title, discussion.body);
      await updateDiscussion(discussion.id, ideaId, { body: enhanced });
      toast.success("Body enhanced");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enhance");
    } finally {
      setEnhancing(false);
    }
  }

  const replyTree = useMemo(
    () => buildReplyTree(discussion.replies),
    [discussion.replies]
  );

  const canReply =
    isTeamMember && discussion.status !== "converted" && discussion.status !== "ready_to_convert" && !!currentUser;

  async function handleResolve() {
    try {
      await updateDiscussion(discussion.id, ideaId, { status: "resolved" });
      toast.success("Discussion marked as resolved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }

  async function handleReopen() {
    try {
      await updateDiscussion(discussion.id, ideaId, { status: "open" });
      toast.success("Discussion reopened");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reopen");
    }
  }

  async function handleTogglePin() {
    try {
      await updateDiscussion(discussion.id, ideaId, {
        pinned: !discussion.pinned,
      });
      toast.success(discussion.pinned ? "Discussion unpinned" : "Discussion pinned");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this discussion and all replies? This cannot be undone.")) return;
    setIsDeleting(true);
    try {
      await deleteDiscussion(discussion.id, ideaId);
      toast.success("Discussion deleted");
      router.push(`/ideas/${ideaId}/discussions`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete";
      if (message.includes("NEXT_REDIRECT")) throw err;
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleSaveEdit() {
    if (!editTitle.trim() || !editBody.trim()) {
      toast.error("Title and body are required");
      return;
    }
    const savedMentionedUserIds = new Set(mention.mentionedUserIds);
    setIsSaving(true);
    try {
      await updateDiscussion(discussion.id, ideaId, {
        title: editTitle,
        body: editBody,
      });

      if (currentUser) {
        sendDiscussionMentionNotifications(
          savedMentionedUserIds,
          currentUser.id,
          teamMembers,
          ideaId,
          discussion.id
        );
      }

      toast.success("Discussion updated");
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

  function handleCancelEdit() {
    setEditTitle(discussion.title);
    setEditBody(discussion.body);
    setIsEditing(false);
    mention.setMentionedUserIds(new Set());
    mention.setMentionQuery(null);
  }

  async function handleDeleteReply(replyId: string) {
    if (!confirm("Delete this reply?")) return;
    try {
      await deleteDiscussionReply(replyId, ideaId, discussion.id);
      toast.success("Reply deleted");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete reply");
    }
  }

  return (
    <div className="space-y-6">
      {/* Ready to convert banner */}
      {discussion.status === "ready_to_convert" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
          <ClipboardCheck className="h-4 w-4 text-amber-400" />
          <span className="text-amber-300">
            Queued for conversion — an agent will create a task shortly.
          </span>
        </div>
      )}

      {/* Converted banner */}
      {discussion.status === "converted" && convertedTaskId && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm">
          <ArrowRightLeft className="h-4 w-4 text-blue-400" />
          <span className="text-blue-300">
            This discussion was converted to a board task.{" "}
            <Link
              href={`/ideas/${ideaId}/board?taskId=${convertedTaskId}`}
              className="font-medium underline hover:text-blue-200"
            >
              View task on board
            </Link>
          </span>
        </div>
      )}

      {/* Thread header */}
      <div>
        {isEditing ? (
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="text-xl font-bold sm:text-2xl"
            autoFocus
          />
        ) : (
          <h1 className="text-xl font-bold sm:text-2xl">{discussion.title}</h1>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={config.className}>
            <StatusIcon className="mr-1 h-3 w-3" />
            {config.label}
          </Badge>
          {discussion.pinned && (
            <Badge
              variant="outline"
              className="border-amber-500/20 bg-amber-500/10 text-amber-400"
            >
              <Pin className="mr-1 h-3 w-3" />
              Pinned
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            Last activity {formatRelativeTime(discussion.last_activity_at)}
          </span>
          {/* Right-aligned action buttons */}
          {isAuthorOrOwner && discussion.status !== "converted" && (
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTogglePin}
                className="gap-1 text-muted-foreground h-8 px-2"
              >
                <Pin className="h-3.5 w-3.5" />
                {discussion.pinned ? "Unpin" : "Pin"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
                className="gap-1 text-destructive hover:text-destructive h-8 px-2"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <div className="mx-1 h-4 w-px bg-border" />
              {discussion.status === "open" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResolve}
                    className="gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Resolve
                  </Button>
                  <ReadyToConvertDialog
                    discussion={discussion}
                    ideaId={ideaId}
                    columns={columns}
                    teamMembers={teamMembers}
                  />
                </>
              ) : discussion.status === "resolved" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReopen}
                    className="gap-1.5"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Reopen
                  </Button>
                  <ReadyToConvertDialog
                    discussion={discussion}
                    ideaId={ideaId}
                    columns={columns}
                    teamMembers={teamMembers}
                  />
                </>
              ) : discussion.status === "ready_to_convert" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReopen}
                    className="gap-1.5"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <ConvertToTaskDialog
                    discussion={discussion}
                    ideaId={ideaId}
                    columns={columns}
                  />
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Original post */}
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarImage src={discussion.author.avatar_url ?? undefined} />
            <AvatarFallback className="text-xs">
              {(discussion.author.full_name ?? "?")[0]}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">
            {discussion.author.full_name ?? "Anonymous"}
          </span>
          {discussion.author.is_bot && (
            <Badge variant="outline" className="text-[10px]">
              Agent
            </Badge>
          )}
          <Badge variant="outline" className="bg-violet-500/10 border-violet-500/20 text-violet-400 text-[10px]">
            Author
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatRelativeTime(discussion.created_at)}
          </span>
        </div>
        {isEditing ? (
          <div className="mt-3 space-y-3">
            <div className="relative">
              {mention.mentionQuery !== null && mention.hasMentions && (
                <MentionAutocomplete
                  filteredMembers={mention.filteredMembers}
                  selectedIndex={mention.mentionIndex}
                  onSelect={(user) =>
                    mention.handleMentionSelect(editBody, setEditBody, user)
                  }
                />
              )}
              <Textarea
                ref={mention.textareaRef}
                value={editBody}
                onChange={(e) => {
                  setEditBody(e.target.value);
                  mention.detectMention(e.target.value, e.target.selectionStart);
                }}
                onKeyDown={(e) =>
                  mention.handleKeyDown(e, editBody, setEditBody)
                }
                rows={8}
                className="min-h-[120px] resize-y text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSaveEdit}
                disabled={isSaving || !editTitle.trim() || !editBody.trim()}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 mb-2 text-sm">
            <Markdown teamMembers={teamMembers}>{discussion.body}</Markdown>
          </div>
        )}
        {/* Post footer: vote + edit */}
        {!isEditing && (
          <div className="mt-6 flex items-center gap-3 border-t border-border pt-4">
            <DiscussionVoteButton
              discussionId={discussion.id}
              ideaId={ideaId}
              upvotes={discussion.upvotes}
              hasVoted={hasVoted}
            />
            {isAuthorOrOwner && discussion.status !== "converted" && (
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
            {showAiEnhance && discussion.status !== "converted" && (
              <button
                onClick={handleEnhanceBody}
                disabled={enhancing}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {enhancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {enhancing ? "Enhancing..." : "Enhance"}
              </button>
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Replies */}
      <div>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4" />
          {discussion.reply_count} {discussion.reply_count === 1 ? "Reply" : "Replies"}
        </h2>

        {replyTree.length > 0 && (
          <div className="space-y-4">
            {replyTree.map((reply) => (
              <ReplyItem
                key={reply.id}
                reply={reply}
                ideaId={ideaId}
                discussionId={discussion.id}
                discussionAuthorId={discussion.author_id}
                currentUser={currentUser}
                isAuthorOrOwner={isAuthorOrOwner}
                canReply={canReply}
                onDelete={handleDeleteReply}
                teamMembers={teamMembers}
              />
            ))}
          </div>
        )}
      </div>

      {/* Reply composer */}
      {canReply && (
        <>
          <Separator />
          <DiscussionReplyForm
            discussionId={discussion.id}
            ideaId={ideaId}
            currentUser={currentUser}
            teamMembers={teamMembers}
          />
        </>
      )}
    </div>
  );
}
