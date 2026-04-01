"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { HelpLink } from "@/components/shared/help-link";
import { useRouter } from "next/navigation";
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
  Bookmark,
  Play,
  Check,
  ChevronsUpDown,
  AlertTriangle,
  Package,
  Lightbulb,
  Info,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RoleCombobox, useRoleSuggestions } from "@/components/ui/role-combobox";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { getLabelColorConfig } from "@/lib/utils";
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
import { AddTemplateDialog } from "./add-template-dialog";
import { SaveTemplateDialog } from "./save-template-dialog";
import { ApplyKitDialog } from "@/components/kits/apply-kit-dialog";
import {
  listWorkflowTemplates,
  updateWorkflowTemplate,
  deleteWorkflowTemplate,
  listWorkflowAutoRules,
  createWorkflowAutoRule,
  deleteWorkflowAutoRule,
  applyAutoRuleRetroactively,
} from "@/actions/workflow-templates";
import { isTemplateSaved } from "@/actions/user-templates";
import { createBoardLabel } from "@/actions/board";
import { LABEL_COLORS } from "@/lib/constants";
import { getRoleBadgeClasses } from "./task-workflow-section";
import { ApprovalLockIcon } from "./approval-lock-icon";
import { approvalCount } from "@/lib/workflow-helpers";
import { buildRoleMatcher, type AgentCandidate } from "@/lib/role-matching";
import type { WorkflowTemplate, WorkflowAutoRule, BoardLabel } from "@/types";
import type { WorkflowTemplateStep } from "@/types/database";

// ────────────────────────────────────────────
// Step list (read-only display in detail panel)
// ────────────────────────────────────────────

function StepRow({ step, index, isUnmatched }: { step: WorkflowTemplateStep; index: number; isUnmatched?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {index + 1}
      </span>
      <span className="flex-1 truncate text-sm font-medium">{step.title}</span>
      <span className="relative shrink-0">
        <Badge
          variant="outline"
          className={`text-[10px] ${getRoleBadgeClasses(step.role)}`}
        >
          {step.role}
        </Badge>
        {isUnmatched && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border-2 border-background bg-amber-400" />
        )}
      </span>
      {step.requires_approval && <ApprovalLockIcon />}
    </div>
  );
}

// ────────────────────────────────────────────
// Inline step editor (for editing existing templates)
// ────────────────────────────────────────────

interface StepEditorProps {
  steps: WorkflowTemplateStep[];
  onChange: (steps: WorkflowTemplateStep[]) => void;
  ideaId?: string;
  poolRoles?: import("@/components/ui/role-combobox").RoleSuggestion[];
  userRoles?: import("@/components/ui/role-combobox").RoleSuggestion[];
}

function StepEditor({ steps, onChange, ideaId, poolRoles, userRoles }: StepEditorProps) {
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
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Title</span>
              <Input
                value={step.title}
                onChange={(e) => updateStep(idx, { title: e.target.value })}
                placeholder="Step title"
                className="h-7 flex-1 text-xs"
              />
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Role</span>
              <RoleCombobox
                value={step.role}
                onChange={(val) => updateStep(idx, { role: val })}
                placeholder="Role"
                compact
                maxLength={100}
                ideaId={ideaId}
                poolRoles={poolRoles}
                userRoles={userRoles}
                className="w-32"
              />
            </div>
            <div className="flex items-center gap-3 pl-7">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Description</span>
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
                  Approval
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 pl-7">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Deliverables</span>
              <Input
                value={(step.deliverables ?? []).join(", ")}
                onChange={(e) =>
                  updateStep(idx, {
                    deliverables: e.target.value
                      .split(",")
                      .map((d, i, arr) => (i < arr.length - 1 ? d.trim() : d))
                      .filter((d, i, arr) => i === arr.length - 1 || d.length > 0),
                  })
                }
                placeholder="Deliverables (comma-separated, optional)"
                className="h-7 flex-1 text-xs"
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
  const router = useRouter();
  const [addingRule, setAddingRule] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("blue");
  const [templateId, setTemplateId] = useState(selectedTemplateId);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleCreateLabel() {
    if (!newLabelName.trim()) return;
    setSaving(true);
    try {
      const label = await createBoardLabel(ideaId, newLabelName.trim(), newLabelColor);
      setLabelId(label.id);
      setCreatingLabel(false);
      setNewLabelName("");
      setNewLabelColor("blue");
      setLabelPickerOpen(false);
      router.refresh();
    } catch {
      toast.error("Failed to create label");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddRule() {
    if (!labelId || !templateId) return;
    setSaving(true);
    try {
      const rule = await createWorkflowAutoRule(ideaId, labelId, templateId);
      setAddingRule(false);
      setLabelId("");
      setTemplateId("");
      onRulesChange();

      // Auto-apply to existing tasks that already have this label
      try {
        const result = await applyAutoRuleRetroactively(rule.id);
        if (result.applied > 0) {
          toast.success(
            `Workflow trigger created — applied to ${result.applied} existing task${result.applied !== 1 ? "s" : ""}`
          );
        } else {
          toast.success("Workflow trigger created");
        }
        if (result.applied > 0) onRulesChange();
      } catch {
        // Rule was created successfully, just the retroactive apply failed
        toast.success("Workflow trigger created (could not apply to existing tasks)");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workflow trigger");
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
          ? "Workflow trigger and related workflows deleted"
          : "Workflow trigger deleted"
      );
      onRulesChange();
    } catch {
      toast.error("Failed to delete workflow trigger");
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
          Workflow Triggers
        </h3>
        {!isReadOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[10px]"
            onClick={() => {
              setTemplateId(selectedTemplateId);
              setLabelId("");
              setAddingRule(true);
            }}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground/60 -mt-0.5">
        Automatically apply a workflow when a task gets a specific label.
      </p>

      {rules.length === 0 && !addingRule && (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-lg border border-dashed border-amber-500/20 bg-amber-500/[0.06] p-3"
        >
          <Lightbulb className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">
              Connect this template to a label
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Add a workflow trigger so this template is automatically applied when you label a task.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-6 gap-1 text-[11px] border-amber-500/20 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              onClick={() => {
                setTemplateId(selectedTemplateId);
                setLabelId("");
                setAddingRule(true);
              }}
            >
              <Zap className="h-3 w-3" />
              Add trigger
            </Button>
          </div>
        </div>
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
            <Badge
              className={`text-[10px] py-0 h-5 ${label ? getLabelColorConfig(label.color).badgeClass : ""}`}
            >
              {label?.name ?? "Unknown label"}
            </Badge>
            <span className="text-xs text-muted-foreground">→</span>
            <span className="text-xs">
              {template?.name ?? "Unknown template"}
            </span>
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
            <Popover open={labelPickerOpen} onOpenChange={(open) => { setLabelPickerOpen(open); if (!open) setCreatingLabel(false); }}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={labelPickerOpen}
                  className="h-7 flex-1 justify-between text-xs font-normal"
                >
                  {labelId ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${getLabelColorConfig(boardLabels.find((l) => l.id === labelId)?.color ?? "").swatchColor}`}
                      />
                      {boardLabels.find((l) => l.id === labelId)?.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Select label…</span>
                  )}
                  <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search labels…" className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
                      No labels found.
                    </CommandEmpty>
                    {boardLabels.map((l) => {
                      const colorConfig = getLabelColorConfig(l.color);
                      return (
                        <CommandItem
                          key={l.id}
                          value={l.name}
                          onSelect={() => {
                            setLabelId(l.id === labelId ? "" : l.id);
                            setLabelPickerOpen(false);
                          }}
                          className="text-xs"
                        >
                          <span
                            className={`mr-2 h-2.5 w-2.5 rounded-full ${colorConfig.swatchColor}`}
                          />
                          {l.name}
                          {l.id === labelId && (
                            <Check className="ml-auto h-3 w-3" />
                          )}
                        </CommandItem>
                      );
                    })}
                    {/* Create new label inline */}
                    {creatingLabel ? (
                      <div className="border-t p-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          className="h-7 text-xs"
                          placeholder="Label name"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleCreateLabel();
                            }
                          }}
                        />
                        <div className="flex flex-wrap gap-1">
                          {LABEL_COLORS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              className={`h-4 w-4 rounded-sm ${c.swatchColor} ${
                                newLabelColor === c.value ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
                              }`}
                              onClick={() => setNewLabelColor(c.value)}
                            />
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-6 flex-1 text-xs"
                            onClick={handleCreateLabel}
                            disabled={saving || !newLabelName.trim()}
                          >
                            Create
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => setCreatingLabel(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 border-t px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setCreatingLabel(true)}
                      >
                        <Plus className="h-3 w-3" />
                        Create new label
                      </button>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">→</span>
            <span className="flex h-7 flex-1 items-center rounded-md border border-border bg-muted/30 px-2 text-xs font-medium">
              {templates.find((t) => t.id === selectedTemplateId)?.name ?? "This template"}
            </span>
          </div>
          <div className="flex items-center justify-end">
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
            <AlertDialogTitle>Delete Workflow Trigger</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the workflow trigger that links{" "}
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
              Also remove workflows from tasks created by this trigger
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
  hasAgents?: boolean;
  kitName?: string | null;
  agentCandidates?: AgentCandidate[];
}

export function WorkflowsTab({
  ideaId,
  boardLabels,
  isReadOnly = false,
  hasAgents = false,
  kitName,
  agentCandidates = [],
}: WorkflowsTabProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [rules, setRules] = useState<WorkflowAutoRule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogTab, setAddDialogTab] = useState<"my" | "platform" | "create" | undefined>(undefined);
  const [kitDialogOpen, setKitDialogOpen] = useState(false);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSteps, setEditSteps] = useState<WorkflowTemplateStep[]>([]);
  const [saving, setSaving] = useState(false);

  // Explainer banner dismiss state
  const [explainerDismissed, setExplainerDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("workflows-explainer-dismissed") === "1";
  });

  // Save to My Templates state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savedTemplateIds, setSavedTemplateIds] = useState<Set<string>>(new Set());

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const { poolRoles, userRoles } = useRoleSuggestions(ideaId);

  // Role coverage: compute unmatched roles for the selected template
  const roleMatcher = useMemo(() => buildRoleMatcher(agentCandidates), [agentCandidates]);
  const unmatchedRoles = useMemo(() => {
    if (!selected || selected.steps.length === 0) return [];
    const seen = new Set<string>();
    return selected.steps
      .filter((s) => {
        if (!s.role || seen.has(s.role)) return false;
        seen.add(s.role);
        return roleMatcher(s.role).tier === "none";
      })
      .map((s) => s.role);
  }, [selected, roleMatcher]);

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

  // Check saved state when selected template changes
  useEffect(() => {
    if (!selected) return;
    if (savedTemplateIds.has(selected.id)) return;
    isTemplateSaved(selected.id, ideaId).then((saved) => {
      if (saved) {
        setSavedTemplateIds((prev) => new Set(prev).add(selected.id));
      }
    }).catch(() => {});
  }, [selected, ideaId, savedTemplateIds]);

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

  async function handleCreated(templateId?: string) {
    await fetchData();
    if (templateId) {
      setSelectedId(templateId);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }


  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Explainer banner */}
      {!explainerDismissed && (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Workflow templates define a sequence of steps that <strong className="font-medium text-foreground">AI agents</strong> follow when working on a task. Templates can be applied to tasks manually or <strong className="font-medium text-foreground">triggered automatically</strong> when a label is added. Each step has an assigned role — agents matching that role claim and execute the step via MCP, producing deliverables that chain into the next step. Steps marked as <strong className="font-medium text-foreground">approvals</strong> pause for human review before the workflow continues.
          </p>
          <button
            onClick={() => {
              setExplainerDismissed(true);
              localStorage.setItem("workflows-explainer-dismissed", "1");
            }}
            className="mt-0.5 shrink-0 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
      {/* Left panel — template list */}
      <div className="flex w-60 shrink-0 flex-col rounded-lg border border-border bg-muted/20">
        {/* Sidebar header */}
        <div className="border-b border-border px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Templates
              <HelpLink href="/guide/workflows" tooltip="How workflows work" />
            </span>
            {!isReadOnly && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-[10px]"
                onClick={() => { setAddDialogTab(undefined); setAddDialogOpen(true); }}
              >
                <Plus className="h-3 w-3" />
              </Button>
            )}
          </div>
          {kitName && (
            <span className="mt-1.5 inline-flex rounded-full bg-violet-500/[0.12] border border-violet-500/25 px-2 py-0.5 text-[10px] font-semibold tracking-normal text-violet-400">
              {kitName} Kit
            </span>
          )}
        </div>

        {/* Agent nudge — show when no templates AND no agents in pool */}
        {!loading && templates.length === 0 && !hasAgents && !isReadOnly && (
          <div className="mx-1.5 mb-2 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
            <p className="text-xs text-amber-400">
              <strong>Agents needed:</strong> Workflow steps are executed by AI agents.{" "}
              <a href="?tab=agents" className="underline hover:text-amber-300">
                Add agents to your team
              </a>{" "}
              before creating workflow templates.
            </p>
          </div>
        )}

        {/* Template list */}
        <div className="flex-1 overflow-y-auto p-1.5">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-3 py-6 text-center">
              {/* Dashed amber icon circle */}
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-dashed border-amber-500/25 bg-amber-500/[0.06]">
                <Zap className="h-5 w-5 text-amber-400" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-400">No templates yet</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed max-w-[180px]">
                  Automate your process with step-by-step workflows.
                </p>
              </div>
              {!isReadOnly && (
                <div className="flex w-full flex-col items-center gap-1.5 pt-1">
                  <Button
                    size="sm"
                    className="h-8 w-full gap-1.5 text-xs"
                    onClick={() => setKitDialogOpen(true)}
                  >
                    <Package className="h-3 w-3" />
                    Apply a Project Kit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-full gap-1 text-xs"
                    onClick={() => { setAddDialogTab("platform"); setAddDialogOpen(true); }}
                  >
                    <Plus className="h-3 w-3" />
                    Import from templates
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => { setAddDialogTab("create"); setAddDialogOpen(true); }}
                  >
                    <Plus className="h-3 w-3" />
                    Create from scratch
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
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span>
                    {t.steps.length} step{t.steps.length !== 1 ? "s" : ""}
                    {approvalCount(t.steps) > 0 &&
                      ` · ${approvalCount(t.steps)} approval${approvalCount(t.steps) !== 1 ? "s" : ""}`}
                  </span>
                  <Zap
                    className={`h-2.5 w-2.5 ${
                      rules.some((r) => r.template_id === t.id)
                        ? "text-emerald-400"
                        : "text-amber-400 opacity-70"
                    }`}
                  />
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
            <div className="max-w-sm space-y-4 text-center">
              {templates.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Select a template to view details
                </p>
              ) : (
                <>
                  {/* Dashed amber icon circle */}
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-amber-500/25 bg-amber-500/[0.06]">
                    <Zap className="h-6 w-6 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Automate your process</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Import a proven template or create your own from scratch.
                    </p>
                  </div>
                  <div className="space-y-3 text-left rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">How workflows work</p>
                    <ol className="list-none space-y-2 text-xs text-muted-foreground">
                      <li className="flex items-baseline gap-2">
                        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-[10px] font-bold text-amber-400">1</span>
                        <span>Create a <strong className="text-foreground font-medium">template</strong> with ordered steps and roles</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-[10px] font-bold text-amber-400">2</span>
                        <span><strong className="text-foreground font-medium">Apply</strong> it to tasks manually or set up workflow triggers</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-[10px] font-bold text-amber-400">3</span>
                        <span>Agents <strong className="text-foreground font-medium">execute</strong> steps via MCP, or manage them from the UI</span>
                      </li>
                      <li className="flex items-baseline gap-2">
                        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-[10px] font-bold text-amber-400">4</span>
                        <span>Steps marked as <strong className="text-foreground font-medium">approvals</strong> pause for human review</span>
                      </li>
                    </ol>
                  </div>
                  {!isReadOnly && (
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setKitDialogOpen(true)}
                      >
                        <Package className="h-3.5 w-3.5" />
                        Apply a Project Kit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => { setAddDialogTab("platform"); setAddDialogOpen(true); }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Import from templates
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => { setAddDialogTab("create"); setAddDialogOpen(true); }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Create template
                      </Button>
                    </div>
                  )}
                </>
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
              <StepEditor steps={editSteps} onChange={setEditSteps} ideaId={ideaId} poolRoles={poolRoles} userRoles={userRoles} />
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
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {selected.usage_count === 0 ? (
                    <span className="text-[10px] text-muted-foreground">
                      Not used yet{" "}
                      <span className="mx-0.5">&middot;</span>{" "}
                      <button
                        onClick={() => document.getElementById("workflow-triggers-section")?.scrollIntoView({ behavior: "smooth" })}
                        className="font-medium text-amber-400 hover:underline"
                      >
                        Set up a trigger &darr;
                      </button>
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      Used {selected.usage_count} time
                      {selected.usage_count !== 1 ? "s" : ""}
                    </span>
                  )}
                  {selected.steps.length > 0 && agentCandidates.length > 0 && (
                    unmatchedRoles.length === 0 ? (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                        <Check className="h-3 w-3" />
                        All roles covered
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          const params = new URLSearchParams(window.location.search);
                          params.set("tab", "agents");
                          window.history.pushState(null, "", `?${params.toString()}`);
                          window.dispatchEvent(new PopStateEvent("popstate"));
                        }}
                        className="flex items-center gap-1 text-[10px] font-medium text-amber-400 hover:underline"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {unmatchedRoles.length} role{unmatchedRoles.length !== 1 ? "s" : ""} need{unmatchedRoles.length === 1 ? "s" : ""} an agent
                      </button>
                    )
                  )}
                  {(() => {
                    const triggerCount = rules.filter((r) => r.template_id === selected.id).length;
                    return triggerCount > 0 ? (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                        <Zap className="h-3 w-3" />
                        {triggerCount} trigger{triggerCount !== 1 ? "s" : ""} active
                      </span>
                    ) : (
                      <button
                        onClick={() => document.getElementById("workflow-triggers-section")?.scrollIntoView({ behavior: "smooth" })}
                        className="flex items-center gap-1 text-[10px] font-medium text-amber-400 hover:underline"
                      >
                        <Zap className="h-3 w-3" />
                        No triggers
                      </button>
                    );
                  })()}
                </div>
              </div>
              {!isReadOnly && (
                <div className="flex items-center gap-1">
                  {savedTemplateIds.has(selected.id) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs opacity-60 cursor-default"
                      disabled
                    >
                      <Check className="h-3 w-3" />
                      Saved
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25"
                      onClick={() => setSaveDialogOpen(true)}
                    >
                      <Bookmark className="h-3 w-3" />
                      Save to My Templates
                    </Button>
                  )}
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
                          remove any workflow triggers using it. This action cannot be
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
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Steps
                </h3>
                {selected.steps.some((s) => s.requires_approval) && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Lock className="h-2.5 w-2.5 text-amber-400" />
                    = Requires approval
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {selected.steps.map((step, idx) => (
                  <StepRow key={idx} step={step} index={idx} isUnmatched={unmatchedRoles.includes(step.role)} />
                ))}
              </div>
              {unmatchedRoles.length > 0 && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <p className="text-xs text-amber-400">
                    {unmatchedRoles.map((role, i) => (
                      <span key={role}>
                        {i > 0 && ", "}
                        <strong>{role}</strong>
                      </span>
                    ))}
                    {unmatchedRoles.length === 1 ? " has " : " have "}
                    no matching agent.{" "}
                    <button
                      onClick={() => {
                        const params = new URLSearchParams(window.location.search);
                        params.set("tab", "agents");
                        window.history.pushState(null, "", `?${params.toString()}`);
                        window.dispatchEvent(new PopStateEvent("popstate"));
                      }}
                      className="underline hover:text-amber-300"
                    >
                      Add one in Agents tab
                    </button>
                  </p>
                </div>
              )}
            </div>

            {/* Auto-rules */}
            <div id="workflow-triggers-section">
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
          </div>
        )}
      </div>

      {/* Add template dialog (unified: My Templates / Platform / Create New) */}
      {!isReadOnly && (
        <AddTemplateDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          ideaId={ideaId}
          existingTemplateNames={templates.map((t) => t.name)}
          onCreated={handleCreated}
          initialTab={addDialogTab}
        />
      )}

      {/* Apply kit dialog */}
      {!isReadOnly && (
        <ApplyKitDialog
          open={kitDialogOpen}
          onOpenChange={setKitDialogOpen}
          ideaId={ideaId}
          onApplied={() => {
            fetchData();
          }}
        />
      )}

      {/* Save to My Templates dialog */}
      {selected && (
        <SaveTemplateDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          templateId={selected.id}
          ideaId={ideaId}
          templateName={selected.name}
          templateDescription={selected.description}
          steps={selected.steps}
          onSaved={() => {
            setSavedTemplateIds((prev) => new Set(prev).add(selected.id));
          }}
        />
      )}
      </div>
    </div>
  );
}
