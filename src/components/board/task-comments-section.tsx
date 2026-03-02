"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { MessageSquare, Trash2, Send, Bot, Pencil, X, Check } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { MentionAutocomplete } from "./mention-autocomplete";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime, getInitials } from "@/lib/utils";
import { logTaskActivity } from "@/lib/activity";
import { createTaskComment, deleteTaskComment, updateTaskComment } from "@/actions/board";
import { undoableAction } from "@/lib/undo-toast";
import type { BoardTaskCommentWithAuthor, User } from "@/types";

interface TaskCommentsSectionProps {
  taskId: string;
  ideaId: string;
  currentUserId: string;
  teamMembers: User[];
  userBotIds?: string[];
  isReadOnly?: boolean;
}

export function TaskCommentsSection({
  taskId,
  ideaId,
  currentUserId,
  teamMembers,
  userBotIds = [],
  isReadOnly = false,
}: TaskCommentsSectionProps) {
  const [comments, setComments] = useState<BoardTaskCommentWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionedUserIds, setMentionedUserIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    return teamMembers.filter((m) => m.full_name?.toLowerCase().includes(mentionQuery.toLowerCase()));
  }, [teamMembers, mentionQuery]);

  const fetchComments = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("board_task_comments")
      .select("*, author:users!board_task_comments_author_id_fkey(*)")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    setComments((data ?? []) as unknown as BoardTaskCommentWithAuthor[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`task-comments-${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "board_task_comments",
          filter: `task_id=eq.${taskId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from("board_task_comments")
            .select("*, author:users!board_task_comments_author_id_fkey(*)")
            .eq("id", payload.new.id)
            .single();

          if (data) {
            const comment = data as unknown as BoardTaskCommentWithAuthor;
            setComments((prev) => {
              if (prev.some((c) => c.id === comment.id)) return prev;
              // Replace optimistic temp entry from same author with real data
              const tempIdx = prev.findIndex(
                (c) => c.id.startsWith("temp-") && c.author_id === comment.author_id && c.content === comment.content
              );
              if (tempIdx !== -1) {
                const updated = [...prev];
                updated[tempIdx] = comment;
                return updated;
              }
              return [...prev, comment];
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "board_task_comments",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          setComments((prev) => prev.filter((c) => c.id !== payload.old.id));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "board_task_comments",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          setComments((prev) =>
            prev.map((c) =>
              c.id === payload.new.id
                ? { ...c, content: payload.new.content, updated_at: payload.new.updated_at }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [taskId]);

  function detectMention(value: string, cursorPos: number) {
    const textBeforeCursor = value.slice(0, cursorPos);
    // Match @ at start of text or after whitespace, followed by non-space chars (names selected from dropdown)
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

    // Track this user for notification on submit
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;

    // Optimistic: add comment immediately, clear input
    const tempId = `temp-${Date.now()}`;
    const currentUser = teamMembers.find((m) => m.id === currentUserId);
    const optimisticComment: BoardTaskCommentWithAuthor = {
      id: tempId,
      task_id: taskId,
      idea_id: ideaId,
      author_id: currentUserId,
      content: text,
      created_at: new Date().toISOString(),
      author: currentUser ?? null,
    } as BoardTaskCommentWithAuthor;

    setComments((prev) => [...prev, optimisticComment]);
    setContent("");
    setMentionQuery(null);
    const savedMentionedUserIds = new Set(mentionedUserIds);
    setMentionedUserIds(new Set());
    setSubmitting(true);

    try {
      await createTaskComment(taskId, ideaId, text);
      logTaskActivity(taskId, ideaId, currentUserId, "comment_added");
      // Send mention notifications with the saved set
      if (savedMentionedUserIds.size > 0) {
        const supabase = createClient();
        for (const userId of savedMentionedUserIds) {
          if (userId === currentUserId) continue;
          const member = teamMembers.find((m) => m.id === userId);
          if (!member) continue;
          if (member.notification_preferences?.task_mentions === false) continue;
          supabase
            .from("notifications")
            .insert({
              user_id: userId,
              actor_id: currentUserId,
              type: "task_mention" as const,
              idea_id: ideaId,
              task_id: taskId,
            })
            .then(({ error }) => {
              if (error) console.error("Failed to send mention notification:", error.message);
            });
        }
      }
    } catch {
      // Rollback
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setContent(text);
      toast.error("Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDelete(commentId: string) {
    // Optimistic: remove immediately
    const removedComment = comments.find((c) => c.id === commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));

    undoableAction({
      message: "Comment deleted",
      execute: () => deleteTaskComment(commentId, ideaId),
      undo: () => {
        if (removedComment) {
          setComments((prev) =>
            [...prev, removedComment].sort(
              (a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          );
        }
      },
      errorMessage: "Failed to delete comment",
    });
  }

  function handleStartEdit(comment: BoardTaskCommentWithAuthor) {
    setEditingId(comment.id);
    setEditContent(comment.content);
    requestAnimationFrame(() => editTextareaRef.current?.focus());
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

  async function handleSaveEdit(commentId: string) {
    const trimmed = editContent.trim();
    const original = comments.find((c) => c.id === commentId);
    if (!trimmed || trimmed === original?.content) {
      handleCancelEdit();
      return;
    }
    setSavingEdit(true);
    try {
      await updateTaskComment(commentId, ideaId, trimmed);
      // Optimistically update local state
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, content: trimmed, updated_at: new Date().toISOString() }
            : c
        )
      );
      setEditingId(null);
      setEditContent("");
    } catch {
      toast.error("Failed to update comment");
    } finally {
      setSavingEdit(false);
    }
  }

  function canModifyComment(comment: BoardTaskCommentWithAuthor) {
    return comment.author_id === currentUserId || userBotIds.includes(comment.author_id);
  }

  function isEdited(comment: BoardTaskCommentWithAuthor) {
    return comment.updated_at && comment.updated_at !== comment.created_at;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4" />
        <span className="text-sm font-medium">Comments{comments.length > 0 ? ` (${comments.length})` : ""}</span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : comments.length > 0 ? (
        <div>
          <div className="space-y-3">
            {comments.map((comment) => {
              const initials = getInitials(comment.author?.full_name);

              const isEditingThis = editingId === comment.id;

              return (
                <div key={comment.id} className="flex gap-2">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarImage src={comment.author?.avatar_url ?? undefined} />
                    <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium inline-flex items-center gap-1">
                        {comment.author?.is_bot && <Bot className="h-3 w-3 text-primary" />}
                        {comment.author?.full_name ?? "Unknown"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(comment.created_at)}
                        {isEdited(comment) && (
                          <span className="ml-1 text-muted-foreground/60">(edited)</span>
                        )}
                      </span>
                      {!isReadOnly && canModifyComment(comment) && !isEditingThis && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="text-muted-foreground/60 hover:text-foreground"
                                onClick={() => handleStartEdit(comment)}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Edit comment</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                className="text-muted-foreground/60 hover:text-destructive"
                                onClick={() => handleDelete(comment.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Delete comment</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>

                    {isEditingThis ? (
                      <div className="mt-1">
                        <Textarea
                          ref={editTextareaRef}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={2}
                          className="min-h-[50px] text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Escape") handleCancelEdit();
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveEdit(comment.id);
                          }}
                        />
                        <div className="mt-1 flex items-center gap-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleSaveEdit(comment.id)}
                                disabled={savingEdit || !editContent.trim()}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Save (Ctrl+Enter)</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={handleCancelEdit}
                                disabled={savingEdit}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Cancel (Esc)</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-0.5 text-xs prose-sm">
                        <Markdown teamMembers={teamMembers}>{comment.content}</Markdown>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No comments yet</p>
      )}

      {!isReadOnly && (
        <form onSubmit={handleSubmit} className="relative flex gap-2">
          {mentionQuery !== null && (
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
            placeholder="Write a comment... (@ to mention)"
            rows={2}
            className="min-h-[60px] text-xs"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="submit"
                size="icon"
                className="h-[60px] w-10 shrink-0"
                disabled={submitting || !content.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send comment</TooltipContent>
          </Tooltip>
        </form>
      )}
    </div>
  );
}
