"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Markdown } from "@/components/ui/markdown";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Loader2,
  XCircle,
  CircleDot,
  Lock,
  Send,
  ChevronRight,
  Bot,
  MessageSquare,
  RotateCcw,
  Play,
  CheckCircle2,
  X,
  SkipForward,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import {
  startWorkflowStep,
  completeWorkflowStep,
  failWorkflowStep,
  approveWorkflowStep,
  retryWorkflowStep,
  skipWorkflowStep,
  addStepComment,
} from "@/actions/workflow";
import { getInitials } from "@/lib/utils";
import type { TaskWorkflowStep, WorkflowStepComment } from "@/types";

const STATUS_CONFIG = {
  pending: {
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/20",
    text: "text-zinc-400",
    label: "Pending",
    icon: Clock,
  },
  in_progress: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-400",
    label: "In Progress",
    icon: Loader2,
  },
  completed: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
    label: "Completed",
    icon: Check,
  },
  failed: {
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-400",
    label: "Failed",
    icon: XCircle,
  },
  awaiting_approval: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-400",
    label: "Awaiting Approval",
    icon: CircleDot,
  },
  skipped: {
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/20",
    text: "text-zinc-500",
    label: "Skipped",
    icon: SkipForward,
  },
} as const;

type CommentWithAuthor = WorkflowStepComment & {
  author?: { full_name: string | null; avatar_url: string | null; is_bot: boolean } | null;
};

interface StepDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: TaskWorkflowStep;
  stepNumber: number;
  ideaId: string;
  allSteps?: TaskWorkflowStep[];
  isReadOnly?: boolean;
}

export function StepDetailDialog({
  open,
  onOpenChange,
  step,
  stepNumber,
  ideaId,
  allSteps = [],
  isReadOnly = false,
}: StepDetailDialogProps) {
  const [comments, setComments] = useState<CommentWithAuthor[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"complete" | "fail" | "reject" | null>(null);
  const [actionText, setActionText] = useState("");
  const [resetToStepId, setResetToStepId] = useState<string>("");
  const supabaseRef = useRef(createClient());
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // Earlier completed/in_progress steps that can be targeted for cascade rejection
  const earlierSteps = allSteps.filter(
    (s) =>
      s.id !== step.id &&
      (s.step_order ?? 0) < (step.step_order ?? 0) &&
      (s.status === "completed" || s.status === "in_progress")
  );

  const config = STATUS_CONFIG[step.status];
  const StatusIcon = config.icon;

  // Fetch comments
  useEffect(() => {
    if (!open) return;

    const supabase = supabaseRef.current;

    async function fetchComments() {
      const { data } = await supabase
        .from("workflow_step_comments")
        .select("*, users!workflow_step_comments_author_id_fkey(full_name, avatar_url, is_bot)")
        .eq("step_id", step.id)
        .order("created_at", { ascending: true });

      if (data) {
        setComments(
          data.map((c) => ({
            ...c,
            author: c.users as CommentWithAuthor["author"],
            users: undefined,
          })) as CommentWithAuthor[]
        );
      }
      setLoadingComments(false);
    }

    fetchComments();

    // Realtime subscription for comments
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
        () => { fetchComments(); }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [open, step.id]);

  // Auto-scroll to bottom when new comments arrive
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  async function handleAddComment() {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      await addStepComment(step.id, ideaId, newComment.trim());
      setNewComment("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(
    action: "start" | "complete" | "fail" | "approve" | "reject" | "retry" | "skip"
  ) {
    setActionLoading(true);
    try {
      switch (action) {
        case "start":
          await startWorkflowStep(step.id);
          toast.success("Step started");
          break;
        case "skip":
          await skipWorkflowStep(step.id);
          toast.success("Step skipped");
          break;
        case "complete":
          await completeWorkflowStep(step.id, actionText.trim() || undefined);
          toast.success(
            step.human_check_required ? "Step submitted for approval" : "Step completed"
          );
          setActiveAction(null);
          setActionText("");
          break;
        case "fail":
          await failWorkflowStep(step.id, actionText.trim() || undefined);
          toast.success("Step marked as failed");
          setActiveAction(null);
          setActionText("");
          break;
        case "approve":
          await approveWorkflowStep(step.id);
          toast.success("Step approved");
          break;
        case "reject": {
          const cascadeTarget = resetToStepId && resetToStepId !== "__none" ? resetToStepId : undefined;
          const rejectMessage = actionText.trim() || "Changes requested";
          await addStepComment(step.id, ideaId, rejectMessage, "changes_requested");
          await failWorkflowStep(step.id, undefined, cascadeTarget);
          toast.success(
            cascadeTarget
              ? "Step rejected — pipeline reset to earlier step"
              : "Step rejected — changes requested"
          );
          setActiveAction(null);
          setActionText("");
          setResetToStepId("");
          break;
        }
        case "retry":
          await retryWorkflowStep(step.id);
          toast.success("Step reset for retry");
          break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  const commentTypeStyles: Record<string, string> = {
    output: "border-l-2 border-l-blue-500/50 bg-blue-500/5",
    failure: "border-l-2 border-l-red-500/50 bg-red-500/5",
    approval: "border-l-2 border-l-emerald-500/50 bg-emerald-500/5",
    changes_requested: "border-l-2 border-l-amber-500/50 bg-amber-500/5",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="sr-only">Step Details</DialogTitle>

          {/* Step number + status */}
          <div className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${config.bg} text-sm font-bold ${config.text}`}
            >
              {step.status === "completed" ? (
                <Check className="h-4 w-4" />
              ) : (
                stepNumber
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{step.title}</p>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${config.bg} ${config.text} ${config.border}`}
                >
                  {step.status === "in_progress" && (
                    <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                  )}
                  {config.label}
                </Badge>
                {step.agent_role && (
                  <Badge variant="outline" className="text-[10px]">
                    {step.agent_role}
                  </Badge>
                )}
                {step.human_check_required && (
                  <Lock className="h-3 w-3 text-amber-400" />
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Description */}
          {step.description && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Description</p>
              <p className="text-sm whitespace-pre-wrap">{step.description}</p>
            </div>
          )}

          {/* Expected Deliverables */}
          {step.expected_deliverables && step.expected_deliverables.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Expected Deliverables</p>
              <div className="flex flex-wrap gap-1.5">
                {step.expected_deliverables.map((d, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20"
                  >
                    {d}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Output */}
          {step.output && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Output</p>
              <div className="rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-sm prose-sm">
                <Markdown>{step.output}</Markdown>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {step.started_at && (
              <span>Started: {new Date(step.started_at).toLocaleString()}</span>
            )}
            {step.completed_at && (
              <span>
                {step.status === "failed" ? "Failed" : "Completed"}:{" "}
                {new Date(step.completed_at).toLocaleString()}
              </span>
            )}
          </div>

          {/* Action buttons */}
          {!isReadOnly && (
            <div className="flex flex-wrap gap-2">
              {step.status === "pending" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                    onClick={() => handleAction("start")}
                    disabled={actionLoading}
                  >
                    <Play className="h-3 w-3" />
                    Start Step
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/10"
                    onClick={() => handleAction("skip")}
                    disabled={actionLoading}
                  >
                    <SkipForward className="h-3 w-3" />
                    Skip
                  </Button>
                </>
              )}
              {step.status === "in_progress" && (
                <>
                  {activeAction === "complete" ? (
                    <div className="flex flex-col gap-2 w-full">
                      <Textarea
                        value={actionText}
                        onChange={(e) => setActionText(e.target.value)}
                        placeholder="Output / Deliverable (optional)"
                        rows={3}
                        className="text-xs min-h-[60px]"
                      />
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                          onClick={() => handleAction("complete")}
                          disabled={actionLoading}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {step.human_check_required ? "Submit" : "Confirm"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          onClick={() => { setActiveAction(null); setActionText(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : activeAction === "fail" ? (
                    <div className="flex flex-col gap-2 w-full">
                      <Textarea
                        value={actionText}
                        onChange={(e) => setActionText(e.target.value)}
                        placeholder="What went wrong? (optional)"
                        rows={3}
                        className="text-xs min-h-[60px]"
                      />
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                          onClick={() => handleAction("fail")}
                          disabled={actionLoading}
                        >
                          <XCircle className="h-3 w-3" />
                          Confirm Failure
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          onClick={() => { setActiveAction(null); setActionText(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                        onClick={() => setActiveAction("complete")}
                        disabled={actionLoading}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        {step.human_check_required ? "Submit for Approval" : "Complete"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                        onClick={() => setActiveAction("fail")}
                        disabled={actionLoading}
                      >
                        <XCircle className="h-3 w-3" />
                        Fail
                      </Button>
                    </>
                  )}
                </>
              )}
              {step.status === "awaiting_approval" && (
                <>
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => handleAction("approve")}
                    disabled={actionLoading}
                  >
                    <Check className="h-3 w-3" />
                    Approve
                  </Button>
                  {activeAction === "reject" ? (
                    <div className="flex flex-col gap-2 w-full">
                      <Textarea
                        value={actionText}
                        onChange={(e) => setActionText(e.target.value)}
                        placeholder="Explain what needs to change..."
                        rows={2}
                        className="text-xs min-h-[50px]"
                      />
                      {earlierSteps.length > 0 && (
                        <Select value={resetToStepId} onValueChange={setResetToStepId}>
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Reset pipeline to step... (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">This step only</SelectItem>
                            {earlierSteps.map((s, i) => (
                              <SelectItem key={s.id} value={s.id}>
                                Step {(s.step_order ?? i + 1)}: {s.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                          onClick={() => {
                            if (resetToStepId === "__none") setResetToStepId("");
                            handleAction("reject");
                          }}
                          disabled={actionLoading}
                        >
                          <X className="h-3 w-3" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs"
                          onClick={() => { setActiveAction(null); setActionText(""); setResetToStepId(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                      onClick={() => setActiveAction("reject")}
                      disabled={actionLoading}
                    >
                      <X className="h-3 w-3" />
                      Request Changes
                    </Button>
                  )}
                </>
              )}
              {step.status === "failed" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() => handleAction("retry")}
                  disabled={actionLoading}
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </Button>
              )}
            </div>
          )}

          <Separator />

          {/* Comments section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">
                Comments {comments.length > 0 && `(${comments.length})`}
              </p>
            </div>

            {loadingComments ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading...</span>
              </div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No comments yet</p>
            ) : (
              <div className="space-y-2">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={`rounded-md px-3 py-2 text-sm ${
                      commentTypeStyles[comment.type] ?? "bg-muted/30"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={comment.author?.avatar_url ?? undefined} />
                        <AvatarFallback className="text-[8px]">
                          {getInitials(comment.author?.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs font-medium">
                        {comment.author?.full_name ?? "Unknown"}
                      </span>
                      {comment.author?.is_bot && (
                        <Bot className="h-2.5 w-2.5 text-primary" />
                      )}
                      {comment.type !== "comment" && (
                        <Badge variant="outline" className="text-[9px] py-0 h-4">
                          {comment.type.replace("_", " ")}
                        </Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {new Date(comment.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap">{comment.content}</p>
                  </div>
                ))}
                <div ref={commentsEndRef} />
              </div>
            )}

            {/* Add comment */}
            {!isReadOnly && (
              <div className="flex gap-2">
                <Textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  rows={2}
                  className="text-xs min-h-[60px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleAddComment();
                    }
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 self-end h-8 w-8"
                  onClick={handleAddComment}
                  disabled={submitting || !newComment.trim()}
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
