"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Lock,
  Trash2,
  Pencil,
  Tag,
  Zap,
  ChevronUp,
  ChevronDown,
  Loader2,
  BookOpen,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CreateTemplateDialog } from "./create-template-dialog";
import { ImportTemplateLibraryDialog } from "./import-template-library-dialog";
import {
  listWorkflowTemplates,
  updateWorkflowTemplate,
  deleteWorkflowTemplate,
  listWorkflowAutoRules,
  createWorkflowAutoRule,
  deleteWorkflowAutoRule,
  applyAutoRuleRetroactively,
} from "@/actions/workflow-templates";
import { getRoleBadgeClasses } from "./task-workflow-section";
import type { WorkflowTemplate, WorkflowAutoRule, BoardLabel } from "@/types";
import type { WorkflowTemplateStep } from "@/types/database";

// ────────────────────────────────────────────
// Step list (read-only display in detail panel)
// ────────────────────────────────────────────

function StepRow({ step, index }: { step: WorkflowTemplateStep; index: number }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {index + 1}
      </span>
      <span className="flex-1 truncate text-sm font-medium">{step.title}</span>
      <Badge
        variant="outline"
        className={`shrink-0 text-[10px] ${getRoleBadgeClasses(step.role)}`}
      >
        {step.role}
      </Badge>
      {step.requires_approval && (
        <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Inline step editor (for editing existing templates)
// ────────────────────────────────────────────

interface StepEditorProps {
  steps: WorkflowTemplateStep[];
  onChange: (steps: WorkflowTemplateStep[]) => void;
}

function StepEditor({ steps, onChange }: StepEditorProps) {
  function updateStep(idx: number, patch: Partial<WorkflowTemplateStep>) {
    const next = steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  }

  function removeStep(idx: number) {
    onChange(steps.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  function addStep() {
    onChange([...steps, { title: "", role: "Dev", requires_approval: false }]);
  }

  return (
    <div className="space-y-2">
      {steps.map((step, idx) => (
        <div
          key={idx}
          className="flex items-start gap-2 rounded-md border border-border bg-muted/20 p-2"
        >
          {/* Reorder arrows */}
          <div className="flex flex-col gap-0.5 pt-1">
            <button
              type="button"
              disabled={idx === 0}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              onClick={() => moveStep(idx, -1)}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={idx === steps.length - 1}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              onClick={() => moveStep(idx, 1)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                {idx + 1}
              </span>
              <Input
                value={step.title}
                onChange={(e) => updateStep(idx, { title: e.target.value })}
                placeholder="Step title"
                className="h-7 flex-1 text-xs"
              />
              <Input
                value={step.role}
                onChange={(e) => updateStep(idx, { role: e.target.value })}
                placeholder="Role"
                className="h-7 w-24 text-xs"
              />
            </div>
            <div className="flex items-center gap-3 pl-7">
              <Input
                value={step.description ?? ""}
                onChange={(e) =>
                  updateStep(idx, { description: e.target.value || undefined })
                }
                placeholder="Description (optional)"
                className="h-7 flex-1 text-xs"
              />
              <div className="flex items-center gap-1.5">
                <Switch
                  size="sm"
                  checked={step.requires_approval ?? false}
                  onCheckedChange={(v) =>
                    updateStep(idx, { requires_approval: v })
                  }
                />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  Gate
                </span>
              </div>
            </div>
            <div className="pl-7">
              <Input
                value={(step.deliverables ?? []).join(", ")}
                onChange={(e) =>
                  updateStep(idx, {
                    deliverables: e.target.value
                      .split(",")
                      .map((d) => d.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Deliverables (comma-separated, optional)"
                className="h-7 text-xs"
              />
            </div>
          </div>

          <button
            type="button"
            className="mt-1 rounded p-1 text-muted-foreground hover:text-destructive"
            onClick={() => removeStep(idx)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={addStep}
      >
        <Plus className="h-3 w-3" />
        Add Step
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────
// Auto-rules section
// ────────────────────────────────────────────

interface AutoRulesSectionProps {
  rules: WorkflowAutoRule[];
  templates: WorkflowTemplate[];
  boardLabels: BoardLabel[];
  ideaId: string;
  isReadOnly: boolean;
  onRulesChange: () => void;
  selectedTemplateId: string;
}

function AutoRulesSection({
  rules,
  templates,
  boardLabels,
  ideaId,
  isReadOnly,
  onRulesChange,
  selectedTemplateId,
}: AutoRulesSectionProps) {
  const [addingRule, setAddingRule] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [templateId, setTemplateId] = useState(selectedTemplateId);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleAddRule() {
    if (!labelId || !templateId) return;
    setSaving(true);
    try {
      const rule = await createWorkflowAutoRule(ideaId, labelId, templateId, autoRun);
      setAddingRule(false);
      setLabelId("");
      setTemplateId("");
      setAutoRun(false);
      onRulesChange();

      // Auto-apply to existing tasks that already have this label
      try {
        const result = await applyAutoRuleRetroactively(rule.id);
        if (result.applied > 0) {
          toast.success(
            `Auto-rule created — applied to ${result.applied} existing task${result.applied !== 1 ? "s" : ""}`
          );
        } else {
          toast.success("Auto-rule created");
        }
        if (result.applied > 0) onRulesChange();
      } catch {
        // Rule was created successfully, just the retroactive apply failed
        toast.success("Auto-rule created (could not apply to existing tasks)");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create auto-rule");
    } finally {
      setSaving(false);
    }
  }

  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const [removeWorkflows, setRemoveWorkflows] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (!deleteRuleId) return;
    setDeleting(true);
    try {
      await deleteWorkflowAutoRule(deleteRuleId, {
        removeRelatedWorkflows: removeWorkflows,
      });
      toast.success(
        removeWorkflows
          ? "Auto-rule and related workflows deleted"
          : "Auto-rule deleted"
      );
      onRulesChange();
    } catch {
      toast.error("Failed to delete auto-rule");
    } finally {
      setDeleting(false);
      setDeleteRuleId(null);
      setRemoveWorkflows(false);
    }
  }

  async function handleRunNow(ruleId: string) {
    setRunningRuleId(ruleId);
    try {
      const result = await applyAutoRuleRetroactively(ruleId);
      if (result.applied === 0) {
        toast.info("No eligible tasks found — all matching tasks already have active workflows");
      } else {
        toast.success(
          `Applied workflow to ${result.applied} task${result.applied !== 1 ? "s" : ""}${
            result.skipped > 0 ? ` (${result.skipped} skipped)` : ""
          }`
        );
      }
      onRulesChange();
    } catch {
      toast.error("Failed to apply workflow retroactively");
    } finally {
      setRunningRuleId(null);
    }
  }

  const labelMap = new Map(boardLabels.map((l) => [l.id, l]));
  const templateMap = new Map(templates.map((t) => [t.id, t]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          Auto-Rules
        </h3>
        {!isReadOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[10px]"
            onClick={() => {
              setTemplateId(selectedTemplateId);
              setLabelId("");
              setAutoRun(false);
              setAddingRule(true);
            }}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      {rules.length === 0 && !addingRule && (
        <p className="text-xs text-muted-foreground">
          No auto-rules yet. When a label is applied to a task, an auto-rule can
          automatically attach a workflow template.
        </p>
      )}

      {rules.map((rule) => {
        const label = labelMap.get(rule.label_id);
        const template = templateMap.get(rule.template_id);
        return (
          <div
            key={rule.id}
            className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
          >
            <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium">
              {label?.name ?? "Unknown label"}
            </span>
            <span className="text-xs text-muted-foreground">→</span>
            <span className="text-xs">
              {template?.name ?? "Unknown template"}
            </span>
            {rule.auto_run && (
              <Badge
                variant="outline"
                className="text-[10px] border-emerald-500/25 bg-emerald-500/15 text-emerald-400"
              >
                Auto-run
              </Badge>
            )}
            {!isReadOnly && (
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  title="Apply to all matching tasks now"
                  className="rounded p-1 text-muted-foreground hover:text-violet-400 disabled:opacity-40"
                  disabled={runningRuleId === rule.id}
                  onClick={() => handleRunNow(rule.id)}
                >
                  {runningRuleId === rule.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteRuleId(rule.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {addingRule && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="flex items-center gap-2">
            <Select value={labelId} onValueChange={setLabelId}>
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue placeholder="Select label" />
              </SelectTrigger>
              <SelectContent>
                {boardLabels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">→</span>
            <span className="flex h-7 flex-1 items-center rounded-md border border-border bg-muted/30 px-2 text-xs font-medium">
              {templates.find((t) => t.id === selectedTemplateId)?.name ?? "This template"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Switch
                size="sm"
                checked={autoRun}
                onCheckedChange={setAutoRun}
              />
              <span className="text-xs text-muted-foreground">
                Auto-run when label applied
              </span>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setAddingRule(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-6 text-xs"
                disabled={!labelId || !templateId || saving}
                onClick={handleAddRule}
              >
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={!!deleteRuleId}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteRuleId(null);
            setRemoveWorkflows(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Auto-Rule</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the auto-rule that links{" "}
              <span className="font-medium text-foreground">
                {deleteRuleId
                  ? (labelMap.get(
                      rules.find((r) => r.id === deleteRuleId)?.label_id ?? ""
                    )?.name ?? "Unknown label")
                  : ""}
              </span>{" "}
              →{" "}
              <span className="font-medium text-foreground">
                {deleteRuleId
                  ? (templateMap.get(
                      rules.find((r) => r.id === deleteRuleId)?.template_id ?? ""
                    )?.name ?? "Unknown template")
                  : ""}
              </span>
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id="remove-workflows"
              checked={removeWorkflows}
              onCheckedChange={(checked) =>
                setRemoveWorkflows(checked === true)
              }
            />
            <label
              htmlFor="remove-workflows"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Also remove workflows from tasks created by this rule
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ────────────────────────────────────────────
// Main WorkflowsTab component
// ────────────────────────────────────────────

interface WorkflowsTabProps {
  ideaId: string;
  boardLabels: BoardLabel[];
  isReadOnly?: boolean;
}

export function WorkflowsTab({
  ideaId,
  boardLabels,
  isReadOnly = false,
}: WorkflowsTabProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [rules, setRules] = useState<WorkflowAutoRule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSteps, setEditSteps] = useState<WorkflowTemplateStep[]>([]);
  const [saving, setSaving] = useState(false);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const fetchData = useCallback(async () => {
    try {
      const [tpls, rls] = await Promise.all([
        listWorkflowTemplates(ideaId),
        listWorkflowAutoRules(ideaId),
      ]);
      setTemplates(tpls);
      setRules(rls);
      // Auto-select first if none selected
      if (!selectedId && tpls.length > 0) {
        setSelectedId(tpls[0].id);
      }
    } catch {
      toast.error("Failed to load workflow templates");
    } finally {
      setLoading(false);
    }
  }, [ideaId, selectedId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function startEditing() {
    if (!selected) return;
    setEditName(selected.name);
    setEditDescription(selected.description ?? "");
    setEditSteps(selected.steps.map((s) => ({ ...s })));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function saveEditing() {
    if (!selected) return;
    if (!editName.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (editSteps.length === 0) {
      toast.error("At least one step is required");
      return;
    }
    if (editSteps.some((s) => !s.title.trim())) {
      toast.error("All steps must have a title");
      return;
    }

    setSaving(true);
    try {
      await updateWorkflowTemplate(selected.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        steps: editSteps,
      });
      toast.success("Template updated");
      setEditing(false);
      await fetchData();
    } catch {
      toast.error("Failed to update template");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(templateId: string) {
    try {
      await deleteWorkflowTemplate(templateId);
      toast.success("Template deleted");
      if (selectedId === templateId) {
        setSelectedId(null);
      }
      setEditing(false);
      await fetchData();
    } catch {
      toast.error("Failed to delete template");
    }
  }

  function handleCreated() {
    fetchData();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const gateCount = (steps: WorkflowTemplateStep[]) =>
    steps.filter((s) => s.requires_approval).length;

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Left panel — template list */}
      <div className="flex w-60 shrink-0 flex-col rounded-lg border border-border bg-muted/20">
        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Templates
          </span>
          {!isReadOnly && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-[10px]"
                onClick={() => setLibraryOpen(true)}
              >
                <BookOpen className="h-3 w-3" />
                Library
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-[10px]"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-3 w-3" />
                New
              </Button>
            </div>
          )}
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto p-1.5">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-3 py-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/10">
                <Zap className="h-5 w-5 text-violet-400" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium">No workflow templates yet</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed max-w-[180px]">
                  Workflows define step-by-step processes for tasks. Create a template, then apply it to tasks manually or automatically via labels.
                </p>
              </div>
              {!isReadOnly && (
                <div className="flex flex-col items-center gap-1.5 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setLibraryOpen(true)}
                  >
                    <BookOpen className="h-3 w-3" />
                    Import from library
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="h-3 w-3" />
                    Create template
                  </Button>
                </div>
              )}
            </div>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                  selectedId === t.id
                    ? "bg-violet-500/10 border border-violet-500/25"
                    : "border border-transparent hover:bg-muted/50"
                }`}
                onClick={() => {
                  setSelectedId(t.id);
                  setEditing(false);
                }}
              >
                <p
                  className={`text-sm font-medium truncate ${
                    selectedId === t.id ? "text-violet-300" : ""
                  }`}
                >
                  {t.name}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {t.steps.length} step{t.steps.length !== 1 ? "s" : ""}
                  {gateCount(t.steps) > 0 &&
                    ` · ${gateCount(t.steps)} gate${gateCount(t.steps) !== 1 ? "s" : ""}`}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel — template detail */}
      <div className="flex flex-1 flex-col overflow-y-auto rounded-lg border border-border bg-muted/10 p-4">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-xs space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                {templates.length > 0
                  ? "Select a template to view details"
                  : "Create a template or import from the library to get started"}
              </p>
              {templates.length === 0 && (
                <div className="space-y-2 text-left rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-xs font-medium">How workflows work:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-muted-foreground">
                    <li>Create a <strong className="text-foreground">template</strong> with ordered steps and roles</li>
                    <li><strong className="text-foreground">Apply</strong> it to tasks manually or set up auto-rules</li>
                    <li>Agents <strong className="text-foreground">execute</strong> steps via MCP, or manage them from the UI</li>
                    <li>Steps with <strong className="text-foreground">approval gates</strong> pause for human review</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        ) : editing ? (
          /* ── Edit mode ── */
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Template Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Optional description..."
                className="min-h-[60px] resize-none text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Steps</Label>
              <StepEditor steps={editSteps} onChange={setEditSteps} />
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={saving}
                onClick={saveEditing}
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save Changes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={cancelEditing}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          /* ── Read mode ── */
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                {selected.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selected.description}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Used {selected.usage_count} time
                  {selected.usage_count !== 1 ? "s" : ""}
                </p>
              </div>
              {!isReadOnly && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={startEditing}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete template?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete &quot;{selected.name}&quot; and
                          remove any auto-rules using it. This action cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => handleDelete(selected.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>

            {/* Steps */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Steps
              </h3>
              <div className="space-y-1.5">
                {selected.steps.map((step, idx) => (
                  <StepRow key={idx} step={step} index={idx} />
                ))}
              </div>
            </div>

            {/* Auto-rules */}
            <AutoRulesSection
              rules={rules.filter((r) => r.template_id === selected.id)}
              templates={templates}
              boardLabels={boardLabels}
              ideaId={ideaId}
              isReadOnly={isReadOnly}
              onRulesChange={fetchData}
              selectedTemplateId={selected.id}
            />
          </div>
        )}
      </div>

      {/* Create dialog */}
      {!isReadOnly && (
        <CreateTemplateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          ideaId={ideaId}
          onCreated={handleCreated}
        />
      )}

      {/* Import from library dialog */}
      {!isReadOnly && (
        <ImportTemplateLibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          ideaId={ideaId}
          existingTemplateNames={templates.map((t) => t.name)}
          onImported={handleCreated}
        />
      )}
    </div>
  );
}
