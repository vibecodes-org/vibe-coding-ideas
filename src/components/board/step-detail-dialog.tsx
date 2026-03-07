"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Send, Trash2, AlertCircle, MessageSquare, Bot, CheckCircle2, UserCheck, ThumbsUp, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Markdown } from "@/components/ui/markdown";
import { createClient } from "@/lib/supabase/client";
import { addStepComment, deleteStepComment, approveWorkflowStep, requestChangesWorkflowStep } from "@/actions/workflow";
import { cn, formatRelativeTime, getInitials } from "@/lib/utils";
import { useBotRoles } from "@/components/bot-roles-context";
import { getRoleColor } from "@/lib/agent-colors";
import type { TaskWorkflowStepWithAgent, WorkflowStepCommentWithAuthor } from "@/types";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  in_progress: { label: "In Progress", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  completed: { label: "Completed", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-400 border-red-500/30" },
};

interface StepDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: TaskWorkflowStepWithAgent;
  ideaId: string;
  stepIndex: number;
  currentUserId?: string;
  isReadOnly?: boolean;
  allSteps?: TaskWorkflowStepWithAgent[];
}

export function StepDetailDialog({
  open,
  onOpenChange,
  step,
  ideaId,
  stepIndex,
  currentUserId,
  isReadOnly = false,
  allSteps = [],
}: StepDetailDialogProps) {
  const botRoles = useBotRoles();
  const [comments, setComments] = useState<WorkflowStepCommentWithAuthor[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [changesReason, setChangesReason] = useState("");
  const [changesTargetId, setChangesTargetId] = useState("");
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const isHumanStep = step.step_type === "human";
  const canReview = isHumanStep && !isReadOnly && currentUserId && (step.status === "pending" || step.status === "in_progress");
  // Previous steps that can be sent back for rework
  const previousSteps = allSteps.filter((s) => s.position < step.position && s.step_type === "agent");

  const ac = step.agent?.is_bot ? getRoleColor(botRoles?.[step.agent.id]) : null;
  const status = STATUS_LABELS[step.status] ?? STATUS_LABELS.pending;

  const fetchComments = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("workflow_step_comments")
      .select("*, author:users!workflow_step_comments_author_id_fkey(*)")
      .eq("step_id", step.id)
      .eq("idea_id", ideaId)
      .order("created_at", { ascending: true });

    setComments((data ?? []) as unknown as WorkflowStepCommentWithAuthor[]);
    setLoading(false);
  }, [step.id, ideaId]);

  useEffect(() => {
    if (open) {
      fetchComments();
    }
  }, [open, fetchComments]);

  // Realtime subscription for comments
  useEffect(() => {
    if (!open) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`step-comments-${step.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workflow_step_comments",
          filter: `step_id=eq.${step.id}`,
        },
        () => fetchComments()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, step.id, fetchComments]);

  // Scroll to bottom when new comments arrive
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      await addStepComment(step.id, ideaId, trimmed);
      setContent("");
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await deleteStepComment(commentId, ideaId);
    } catch {
      toast.error("Failed to delete comment");
    }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      await approveWorkflowStep(step.id, ideaId, content.trim() || null);
      setContent("");
      toast.success("Step approved");
    } catch {
      toast.error("Failed to approve step");
    } finally {
      setApproving(false);
    }
  }

  async function handleRequestChanges() {
    if (!changesReason.trim() || !changesTargetId) return;
    setRequestingChanges(true);
    try {
      await requestChangesWorkflowStep(step.id, changesTargetId, ideaId, changesReason.trim());
      setChangesReason("");
      setChangesTargetId("");
      toast.success("Changes requested");
    } catch {
      toast.error("Failed to request changes");
    } finally {
      setRequestingChanges(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Step {stepIndex}</span>
            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}>
              {status.label}
            </span>
          </div>
          <DialogTitle className="text-base">{step.title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {/* Agent or Human checkpoint */}
          {isHumanStep ? (
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/30">
                <UserCheck className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <div>
                <span className="text-sm font-medium text-amber-400">Human Validation</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={step.agent?.avatar_url ?? undefined} />
                <AvatarFallback className={cn("text-[9px]", ac?.avatarBg, ac?.avatarText)}>
                  {getInitials(step.agent?.full_name ?? "?")}
                </AvatarFallback>
              </Avatar>
              <div>
                <span className="text-sm font-medium">{step.agent?.full_name ?? "Unknown"}</span>
                {step.agent?.is_bot && (
                  <Bot className="inline ml-1 h-3 w-3 text-muted-foreground" />
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {step.description && (
            <div className="text-sm text-muted-foreground">
              {step.description}
            </div>
          )}

          <Separator />

          {/* Unified comment thread */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              Thread {comments.length > 0 && `(${comments.length})`}
            </div>

            {loading ? (
              <div className="text-xs text-muted-foreground py-2">Loading...</div>
            ) : comments.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">
                No activity yet. Agents can post outputs, questions, and feedback here.
              </div>
            ) : (
              <div className="space-y-3 py-1">
                {comments.map((comment) => {
                  const cac = comment.author?.is_bot ? getRoleColor(botRoles?.[comment.author.id]) : null;
                  const canDelete = comment.author_id === currentUserId && comment.type === "comment";

                  return (
                    <div key={comment.id}>
                      {/* Output comment */}
                      {comment.type === "output" && (
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            <Avatar className="h-4 w-4">
                              <AvatarImage src={comment.author?.avatar_url ?? undefined} />
                              <AvatarFallback className={cn("text-[6px]", cac?.avatarBg, cac?.avatarText)}>
                                {getInitials(comment.author?.full_name ?? "?")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] font-medium text-emerald-400">
                              Output
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {formatRelativeTime(comment.created_at)}
                            </span>
                          </div>
                          <div className="px-3 py-2 text-sm">
                            <Markdown>{comment.content}</Markdown>
                          </div>
                        </div>
                      )}

                      {/* Failure comment */}
                      {comment.type === "failure" && (
                        <div className="rounded-md border border-red-500/30 bg-red-500/5">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-red-500/20">
                            <AlertCircle className="h-3 w-3 text-red-400" />
                            <Avatar className="h-4 w-4">
                              <AvatarImage src={comment.author?.avatar_url ?? undefined} />
                              <AvatarFallback className={cn("text-[6px]", cac?.avatarBg, cac?.avatarText)}>
                                {getInitials(comment.author?.full_name ?? "?")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] font-medium text-red-400">
                              Failure
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {formatRelativeTime(comment.created_at)}
                            </span>
                          </div>
                          <div className="px-3 py-2 text-sm text-red-300/80">
                            <Markdown>{comment.content}</Markdown>
                          </div>
                        </div>
                      )}

                      {/* Approval comment */}
                      {comment.type === "approval" && (
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-emerald-500/20">
                            <ThumbsUp className="h-3 w-3 text-emerald-400" />
                            <Avatar className="h-4 w-4">
                              <AvatarImage src={comment.author?.avatar_url ?? undefined} />
                              <AvatarFallback className={cn("text-[6px]", cac?.avatarBg, cac?.avatarText)}>
                                {getInitials(comment.author?.full_name ?? "?")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] font-medium text-emerald-400">
                              Approved
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {formatRelativeTime(comment.created_at)}
                            </span>
                          </div>
                          <div className="px-3 py-2 text-sm">
                            <Markdown>{comment.content}</Markdown>
                          </div>
                        </div>
                      )}

                      {/* Changes requested comment */}
                      {comment.type === "changes_requested" && (
                        <div className="rounded-md border border-amber-500/30 bg-amber-500/5">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-500/20">
                            <RotateCcw className="h-3 w-3 text-amber-400" />
                            <Avatar className="h-4 w-4">
                              <AvatarImage src={comment.author?.avatar_url ?? undefined} />
                              <AvatarFallback className={cn("text-[6px]", cac?.avatarBg, cac?.avatarText)}>
                                {getInitials(comment.author?.full_name ?? "?")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-[11px] font-medium text-amber-400">
                              Changes Requested
                            </span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {formatRelativeTime(comment.created_at)}
                            </span>
                          </div>
                          <div className="px-3 py-2 text-sm text-amber-300/80">
                            <Markdown>{comment.content}</Markdown>
                          </div>
                        </div>
                      )}

                      {/* Regular comment */}
                      {comment.type === "comment" && (
                        <div className="group flex gap-2">
                          <Avatar className="h-5 w-5 mt-0.5 shrink-0">
                            <AvatarImage src={comment.author?.avatar_url ?? undefined} />
                            <AvatarFallback className={cn("text-[7px]", cac?.avatarBg, cac?.avatarText)}>
                              {getInitials(comment.author?.full_name ?? "?")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xs font-medium">
                                {comment.author?.full_name ?? "Unknown"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatRelativeTime(comment.created_at)}
                              </span>
                              {canDelete && !isReadOnly && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-4 w-4 opacity-0 group-hover:opacity-100"
                                      onClick={() => handleDelete(comment.id)}
                                    >
                                      <Trash2 className="h-2.5 w-2.5 text-muted-foreground" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <div className="text-sm">
                              <Markdown>{comment.content}</Markdown>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={commentsEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Human step approval actions */}
        {canReview && (
          <div className="space-y-3 pt-2 border-t border-amber-500/20">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-400">Review</span>
            </div>

            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Optional feedback..."
              className="min-h-[50px] text-sm resize-none"
            />

            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleApprove}
                disabled={approving}
              >
                <ThumbsUp className="h-3 w-3 mr-1.5" />
                {approving ? "Approving..." : "Approve"}
              </Button>

              {previousSteps.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                  onClick={() => {
                    setRequestingChanges(true);
                    if (!changesTargetId && previousSteps.length > 0) {
                      setChangesTargetId(previousSteps[previousSteps.length - 1].id);
                    }
                  }}
                  disabled={requestingChanges}
                >
                  <RotateCcw className="h-3 w-3 mr-1.5" />
                  Request Changes
                </Button>
              )}
            </div>

            {requestingChanges && previousSteps.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-500/20 p-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Send back to step:
                </label>
                <Select value={changesTargetId} onValueChange={setChangesTargetId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select step..." />
                  </SelectTrigger>
                  <SelectContent>
                    {previousSteps.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={changesReason}
                  onChange={(e) => setChangesReason(e.target.value)}
                  placeholder="What changes are needed?"
                  className="min-h-[60px] text-sm resize-none"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                    onClick={handleRequestChanges}
                    disabled={!changesReason.trim() || !changesTargetId}
                  >
                    Submit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRequestingChanges(false);
                      setChangesReason("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Comment input */}
        {!isReadOnly && currentUserId && (
          <form onSubmit={handleSubmit} className="flex gap-2 pt-2 border-t border-border/50">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Add a comment..."
              className="min-h-[60px] text-sm resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="h-8 w-8 self-end shrink-0"
              disabled={!content.trim() || submitting}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
