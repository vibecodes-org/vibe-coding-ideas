"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Lock,
  Check,
  Loader2,
  XCircle,
  Clock,
  CircleDot,
  ChevronRight,
  Play,
  RotateCcw,
  AlertTriangle,
  Workflow,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import {
  approveWorkflowStep,
  retryWorkflowStep,
  startWorkflowStep,
  failWorkflowStep,
} from "@/actions/workflow";
import { applyWorkflowTemplate, listWorkflowTemplates } from "@/actions/workflow-templates";
import { StepDetailDialog } from "./step-detail-dialog";
import type { TaskWorkflowStep, WorkflowRun, WorkflowTemplate } from "@/types";

/** Map a role string to a color class for the role badge. */
export function getRoleBadgeClasses(role: string): string {
  const r = role.toLowerCase();
  if (/\bba\b|business|analyst|product|pm\b/.test(r))
    return "bg-blue-500/15 text-blue-400 border-blue-500/25";
  if (/\bux\b|design|ui\b|front|css/.test(r))
    return "bg-pink-500/15 text-pink-400 border-pink-500/25";
  if (/\bdev\b|engineer|code|back|full/.test(r))
    return "bg-violet-500/15 text-violet-400 border-violet-500/25";
  if (/\bqa\b|test|quality/.test(r))
    return "bg-cyan-500/15 text-cyan-400 border-cyan-500/25";
  if (/\bhuman\b|review|approv|manual/.test(r))
    return "bg-amber-500/15 text-amber-400 border-amber-500/25";
  return "bg-zinc-500/15 text-zinc-400 border-zinc-500/25";
}

const STATUS_CONFIG = {
  pending: {
    numBg: "bg-muted",
    numText: "text-muted-foreground",
    border: "border-border",
    badgeCls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
    label: "Pending",
    icon: Clock,
  },
  in_progress: {
    numBg: "bg-blue-500/20",
    numText: "text-blue-400",
    border: "border-blue-500/30",
    badgeCls: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    label: "In Progress",
    icon: Loader2,
  },
  completed: {
    numBg: "bg-emerald-500/20",
    numText: "text-emerald-400",
    border: "border-emerald-500/30",
    badgeCls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    label: "Done",
    icon: Check,
  },
  failed: {
    numBg: "bg-red-500/20",
    numText: "text-red-400",
    border: "border-red-500/30",
    badgeCls: "bg-red-500/15 text-red-400 border-red-500/25",
    label: "Failed",
    icon: XCircle,
  },
  awaiting_approval: {
    numBg: "bg-amber-500/20",
    numText: "text-amber-400",
    border: "border-amber-500/30",
    badgeCls: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    label: "Awaiting Approval",
    icon: CircleDot,
  },
} as const;

const RUN_STATUS_BADGE: Record<WorkflowRun["status"], { cls: string; label: string }> = {
  pending: { cls: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25", label: "Pending" },
  running: { cls: "bg-blue-500/15 text-blue-400 border-blue-500/25", label: "Running" },
  paused: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/25", label: "Paused" },
  completed: { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", label: "Completed" },
  failed: { cls: "bg-red-500/15 text-red-400 border-red-500/25", label: "Failed" },
};

interface TaskWorkflowSectionProps {
  taskId: string;
  ideaId: string;
  isReadOnly?: boolean;
}

export function TaskWorkflowSection({ taskId, ideaId, isReadOnly = false }: TaskWorkflowSectionProps) {
  const [steps, setSteps] = useState<TaskWorkflowStep[] | null>(null);
  const [run, setRun] = useState<(WorkflowRun & { template_name?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState<TaskWorkflowStep | null>(null);

  // Apply workflow state
  const [templates, setTemplates] = useState<WorkflowTemplate[] | null>(null);
  const [showApply, setShowApply] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [applying, setApplying] = useState(false);

  // Inline action loading state
  const [actionStepId, setActionStepId] = useState<string | null>(null);

  const supabaseRef = useRef(createClient());

  useEffect(() => {
    const supabase = supabaseRef.current;

    async function fetchData() {
      const [stepsRes, runRes] = await Promise.all([
        supabase
          .from("task_workflow_steps")
          .select("*")
          .eq("task_id", taskId)
          .order("step_order", { ascending: true }),
        supabase
          .from("workflow_runs")
          .select("*, workflow_templates(name)")
          .eq("task_id", taskId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (stepsRes.data) setSteps(stepsRes.data);
      if (runRes.data) {
        const templateData = runRes.data.workflow_templates as { name: string } | null;
        setRun({
          ...runRes.data,
          template_name: templateData?.name ?? undefined,
          workflow_templates: undefined,
        } as WorkflowRun & { template_name?: string });
      } else {
        setRun(null);
      }
      setLoading(false);
    }

    fetchData();

    const channel = supabase
      .channel(`workflow-steps-${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_workflow_steps", filter: `task_id=eq.${taskId}` },
        () => { fetchData(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workflow_runs", filter: `task_id=eq.${taskId}` },
        () => { fetchData(); }
      )
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [taskId]);

  // Load templates when user opens apply UI
  useEffect(() => {
    if (!showApply || templates !== null) return;
    listWorkflowTemplates(ideaId)
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [showApply, ideaId, templates]);

  async function handleApplyTemplate() {
    if (!selectedTemplateId) return;
    setApplying(true);
    try {
      await applyWorkflowTemplate(taskId, selectedTemplateId);
      toast.success("Workflow applied");
      setShowApply(false);
      setSelectedTemplateId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply workflow");
    } finally {
      setApplying(false);
    }
  }

  async function handleInlineAction(
    stepId: string,
    action: "approve" | "retry" | "start" | "fail"
  ) {
    setActionStepId(stepId);
    try {
      switch (action) {
        case "approve":
          await approveWorkflowStep(stepId);
          toast.success("Step approved");
          break;
        case "retry":
          await retryWorkflowStep(stepId);
          toast.success("Step reset for retry");
          break;
        case "start":
          await startWorkflowStep(stepId);
          toast.success("Step started");
          break;
        case "fail":
          await failWorkflowStep(stepId);
          toast.success("Step marked as failed");
          break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionStepId(null);
    }
  }

  const hasWorkflow = !loading && steps && steps.length > 0;
  const noWorkflow = !loading && (!steps || steps.length === 0);

  // Agent match feedback: count steps with no bot assigned
  const unmatchedSteps = steps?.filter(
    (s) => s.agent_role && !s.bot_id && s.status === "pending"
  ) ?? [];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading workflow...</span>
      </div>
    );
  }

  // No workflow — show "Apply Workflow" CTA (for non-read-only users)
  if (noWorkflow) {
    if (isReadOnly) return null;

    return (
      <>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Workflow</h3>
          {showApply ? (
            <div className="space-y-2">
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates === null ? (
                    <SelectItem value="__loading" disabled>Loading...</SelectItem>
                  ) : templates.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      No templates — create one in the Workflows tab
                    </SelectItem>
                  ) : (
                    templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({(t.steps as unknown[]).length} steps)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={handleApplyTemplate}
                  disabled={!selectedTemplateId || applying}
                >
                  {applying ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => { setShowApply(false); setSelectedTemplateId(""); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs border-dashed"
              onClick={() => setShowApply(true)}
            >
              <Workflow className="h-3.5 w-3.5" />
              Apply Workflow
            </Button>
          )}
        </div>
        <Separator />
      </>
    );
  }

  const completedCount = steps!.filter((s) => s.status === "completed").length;
  const totalCount = steps!.length;

  return (
    <>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Workflow</h3>
            {run && (
              <Badge
                variant="outline"
                className={`text-[10px] ${RUN_STATUS_BADGE[run.status].cls}`}
              >
                {RUN_STATUS_BADGE[run.status].label}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {completedCount} of {totalCount} steps completed
          </span>
        </div>

        {/* Template name */}
        {run?.template_name && (
          <p className="text-xs text-muted-foreground">
            Template: {run.template_name}
          </p>
        )}

        {/* Agent match warning */}
        {unmatchedSteps.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
            <p className="text-xs text-amber-400">
              {unmatchedSteps.length} step{unmatchedSteps.length > 1 ? "s have" : " has"} no
              matching agent:{" "}
              {unmatchedSteps.map((s) => s.agent_role).join(", ")}.
              Allocate agents with matching roles in the idea&apos;s agent pool.
            </p>
          </div>
        )}

        {/* Progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
          />
        </div>

        {/* Step list */}
        <div className="space-y-1.5">
          {steps!.map((step, idx) => {
            const config = STATUS_CONFIG[step.status];
            const isActionLoading = actionStepId === step.id;
            return (
              <div
                key={step.id}
                className={`group flex items-center gap-3 rounded-md border ${config.border} bg-muted/30 px-3 py-2.5 cursor-pointer transition-colors hover:bg-muted/60`}
                onClick={() => setSelectedStep(step)}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${config.numBg} text-xs font-semibold ${config.numText}`}
                >
                  {step.status === "completed" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    idx + 1
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {step.title}
                </span>

                {/* Inline action buttons — shown on hover for key statuses */}
                {!isReadOnly && step.status === "awaiting_approval" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-xs text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleInlineAction(step.id, "approve");
                    }}
                    disabled={isActionLoading}
                  >
                    {isActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Approve
                  </Button>
                )}
                {!isReadOnly && step.status === "failed" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleInlineAction(step.id, "retry");
                    }}
                    disabled={isActionLoading}
                  >
                    {isActionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Retry
                  </Button>
                )}

                {step.agent_role && (
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${getRoleBadgeClasses(step.agent_role)}`}
                  >
                    {step.agent_role}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${config.badgeCls}`}
                >
                  {step.status === "in_progress" && (
                    <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                  )}
                  {step.status === "completed" && (
                    <Check className="mr-1 h-2.5 w-2.5" />
                  )}
                  {step.status === "failed" && (
                    <XCircle className="mr-1 h-2.5 w-2.5" />
                  )}
                  {config.label}
                </Badge>
                {step.human_check_required && (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                )}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Step Detail Dialog */}
      {selectedStep && (
        <StepDetailDialog
          open={!!selectedStep}
          onOpenChange={(open) => { if (!open) setSelectedStep(null); }}
          step={selectedStep}
          stepNumber={steps!.findIndex((s) => s.id === selectedStep.id) + 1}
          ideaId={ideaId}
          allSteps={steps!}
          isReadOnly={isReadOnly}
        />
      )}
    </>
  );
}
