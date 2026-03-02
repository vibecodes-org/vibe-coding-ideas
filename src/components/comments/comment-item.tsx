"use client";

import { useState, useRef } from "react";
import { Reply, Check, Trash2, Pencil, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CommentTypeBadge } from "./comment-type-badge";
import { CommentForm } from "./comment-form";
import { incorporateComment, deleteComment, updateComment } from "@/actions/comments";
import { undoableAction } from "@/lib/undo-toast";
import { toast } from "sonner";
import { formatRelativeTime, getInitials } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import type { CommentWithAuthor, User } from "@/types";

interface CommentItemProps {
  comment: CommentWithAuthor;
  ideaId: string;
  ideaAuthorId: string;
  currentUserId?: string;
  userBotIds?: string[];
  teamMembers?: User[];
  depth?: number;
}

export function CommentItem({
  comment,
  ideaId,
  ideaAuthorId,
  currentUserId,
  userBotIds = [],
  teamMembers = [],
  depth = 0,
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [isIncorporating, setIsIncorporating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const [displayContent, setDisplayContent] = useState(comment.content);
  const [wasEdited, setWasEdited] = useState(
    comment.updated_at !== comment.created_at
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isIdeaAuthor = currentUserId === ideaAuthorId;
  const isCommentAuthor = currentUserId === comment.author_id;
  const isBotOwner = userBotIds.includes(comment.author_id);
  const canModify = isCommentAuthor || isBotOwner;

  const initials = getInitials(comment.author.full_name);

  const handleIncorporate = async () => {
    if (isIncorporating) return;
    setIsIncorporating(true);
    try {
      await incorporateComment(comment.id, ideaId);
    } catch {
      setIsIncorporating(false);
      toast.error("Failed to incorporate suggestion");
    }
  };

  const handleDelete = () => {
    setRemoved(true);
    undoableAction({
      message: "Comment deleted",
      execute: () => deleteComment(comment.id, ideaId),
      undo: () => setRemoved(false),
      errorMessage: "Failed to delete comment",
    });
  };

  const handleEdit = () => {
    setEditContent(displayContent);
    setEditing(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent(displayContent);
  };

  const handleSaveEdit = async () => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === displayContent) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateComment(comment.id, ideaId, trimmed);
      setDisplayContent(trimmed);
      setWasEdited(true);
      setEditing(false);
    } catch {
      toast.error("Failed to update comment");
    } finally {
      setSaving(false);
    }
  };

  if (removed) return null;

  return (
    <div className={depth > 0 ? "ml-6 border-l border-border pl-4" : ""}>
      <div className="py-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-7 w-7">
            <AvatarImage src={comment.author.avatar_url ?? undefined} />
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">
                {comment.author.full_name ?? "Anonymous"}
              </span>
              <CommentTypeBadge type={comment.type} />
              {(comment.is_incorporated || isIncorporating) && (
                <Badge
                  variant="outline"
                  className="bg-emerald-400/10 border-emerald-400/20 text-emerald-400 text-[10px]"
                >
                  <Check className="mr-1 h-3 w-3" />
                  Incorporated
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(comment.created_at)}
                {wasEdited && (
                  <span className="ml-1 text-muted-foreground/60">(edited)</span>
                )}
              </span>
            </div>

            {editing ? (
              <div className="mt-1.5">
                <Textarea
                  ref={textareaRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={3}
                  className="min-h-[60px] text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") handleCancelEdit();
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveEdit();
                  }}
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleSaveEdit}
                    disabled={saving || !editContent.trim()}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleCancelEdit}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    Ctrl+Enter to save
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-1 text-sm text-foreground/90">
                <Markdown teamMembers={teamMembers}>{displayContent}</Markdown>
              </div>
            )}

            {!editing && (
              <div className="mt-2 flex items-center gap-2">
                {currentUserId && depth < 3 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-muted-foreground"
                    onClick={() => setShowReplyForm(!showReplyForm)}
                  >
                    <Reply className="h-3 w-3" />
                    Reply
                  </Button>
                )}
                {isIdeaAuthor &&
                  comment.type === "suggestion" &&
                  !comment.is_incorporated &&
                  !isIncorporating && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-emerald-400"
                      onClick={handleIncorporate}
                    >
                      <Check className="h-3 w-3" />
                      Mark as incorporated
                    </Button>
                  )}
                {canModify && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-muted-foreground"
                    onClick={handleEdit}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                )}
                {canModify && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        {showReplyForm && (
          <div className="mt-3 ml-10">
            <CommentForm
              ideaId={ideaId}
              parentCommentId={comment.id}
              onCancel={() => setShowReplyForm(false)}
              teamMembers={teamMembers}
              currentUserId={currentUserId}
            />
          </div>
        )}
      </div>

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div>
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              ideaId={ideaId}
              ideaAuthorId={ideaAuthorId}
              currentUserId={currentUserId}
              userBotIds={userBotIds}
              teamMembers={teamMembers}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
