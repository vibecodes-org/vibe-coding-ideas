"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Bookmark,
  Layers,
  Plus,
  Lock,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  ChevronUp,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listMyTemplates, importFromMyTemplate } from "@/actions/user-templates";
import { listLibraryTemplates } from "@/actions/admin-templates";
import { importTemplateWithLabel, createWorkflowTemplate } from "@/actions/workflow-templates";
import { RoleCombobox, useRoleSuggestions } from "@/components/ui/role-combobox";
import { TEMPLATE_LABEL_SUGGESTIONS, LABEL_COLORS } from "@/lib/constants";
import { getRoleBadgeClasses } from "@/components/board/task-workflow-section";
import type { WorkflowLibraryTemplate, UserWorkflowTemplate } from "@/types";
import type { WorkflowTemplateStep } from "@/types/database";

type TabKey = "my" | "platform" | "create";

function getLabelSwatchClass(color: string): string {
  return LABEL_COLORS.find((c) => c.value === color)?.swatchColor ?? "bg-zinc-500";
}

function getTemplateLabelHint(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  for (const { keywords, label, color } of TEMPLATE_LABEL_SUGGESTIONS) {
    if (keywords.test(trimmed)) {
      const badgeClass =
        LABEL_COLORS.find((c) => c.value === color)?.badgeClass ?? "bg-zinc-500/90 text-white";
      return { label, badgeClass };
    }
  }
  return null;
}

const DEFAULT_STEP: WorkflowTemplateStep = {
  title: "",
  role: "",
  requires_approval: false,
  deliverables: [],
};

interface AddTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  existingTemplateNames: string[];
  onCreated: (templateId?: string) => void;
  initialTab?: TabKey;
}

export function AddTemplateDialog({
  open,
  onOpenChange,
  ideaId,
  existingTemplateNames,
  onCreated,
  initialTab,
}: AddTemplateDialogProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("platform");

  // My Templates state
  const [myTemplates, setMyTemplates] = useState<UserWorkflowTemplate[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [mySelected, setMySelected] = useState<Set<string>>(new Set());
  const [myExpandedId, setMyExpandedId] = useState<string | null>(null);
  const [myAutoWire, setMyAutoWire] = useState(true);

  // Platform Templates state
  const [platformTemplates, setPlatformTemplates] = useState<WorkflowLibraryTemplate[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformSelected, setPlatformSelected] = useState<Set<string>>(new Set());
  const [platformExpandedId, setPlatformExpandedId] = useState<string | null>(null);
  const [platformAutoWire, setPlatformAutoWire] = useState(true);

  // Create Template state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<WorkflowTemplateStep[]>([{ ...DEFAULT_STEP }]);
  const [deliverableStrings, setDeliverableStrings] = useState<string[]>([""]);

  // Shared state
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const { poolRoles, userRoles } = useRoleSuggestions(ideaId);

  const existingNames = new Set(existingTemplateNames.map((n) => n.toLowerCase()));

  // Fetch data and determine default tab on open
  useEffect(() => {
    if (!open) return;

    // Fetch my templates
    setMyLoading(true);
    listMyTemplates()
      .then((data) => {
        setMyTemplates(data);
        // Determine default tab if no explicit initialTab
        if (!initialTab) {
          setActiveTab(data.length > 0 ? "my" : "platform");
        }
      })
      .catch(() => toast.error("Failed to load personal templates"))
      .finally(() => setMyLoading(false));

    // Fetch platform templates
    setPlatformLoading(true);
    listLibraryTemplates(true)
      .then((data) => setPlatformTemplates(data))
      .catch(() => toast.error("Failed to load template library"))
      .finally(() => setPlatformLoading(false));

    // Apply initialTab override
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  function resetAll() {
    setMySelected(new Set());
    setMyExpandedId(null);
    setMyAutoWire(true);
    setPlatformSelected(new Set());
    setPlatformExpandedId(null);
    setPlatformAutoWire(true);
    setName("");
    setDescription("");
    setSteps([{ ...DEFAULT_STEP }]);
    setDeliverableStrings([""]);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetAll();
    }
    onOpenChange(nextOpen);
  }

  // ── My Templates helpers ──

  function isAlreadyOnBoard(tplName: string) {
    return existingNames.has(tplName.toLowerCase());
  }

  function toggleMySelected(id: string) {
    setMySelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Platform Templates helpers ──

  function togglePlatformSelected(id: string) {
    setPlatformSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Create Template helpers ──

  function updateStep(idx: number, patch: Partial<WorkflowTemplateStep>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
    setDeliverableStrings((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setDeliverableStrings((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function addStep() {
    setSteps((prev) => [...prev, { ...DEFAULT_STEP }]);
    setDeliverableStrings((prev) => [...prev, ""]);
  }

  // ── Import handlers ──

  const handleImportMy = useCallback(async () => {
    if (mySelected.size === 0) return;
    setImporting(true);

    const toImport = myTemplates.filter((tpl) => mySelected.has(tpl.id));
    const results = await Promise.allSettled(
      toImport.map((tpl) => importFromMyTemplate(tpl.id, ideaId, myAutoWire))
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected").length;

    let labelsCreated = 0;
    let rulesCreated = 0;
    let lastCreatedId: string | undefined;
    for (const result of succeeded) {
      const val = result.value;
      lastCreatedId = val.templateId;
      if (val.labelId) labelsCreated++;
      if (val.autoRuleId) rulesCreated++;
    }

    if (succeeded.length > 0) {
      const parts = [`${succeeded.length} template${succeeded.length !== 1 ? "s" : ""}`];
      if (labelsCreated > 0) parts.push(`${labelsCreated} label${labelsCreated !== 1 ? "s" : ""}`);
      if (rulesCreated > 0) parts.push(`${rulesCreated} auto-rule${rulesCreated !== 1 ? "s" : ""}`);
      toast.success(`Imported ${parts.join(", ")}`);
    }
    if (failed > 0) {
      toast.error(`Failed to import ${failed} template${failed !== 1 ? "s" : ""}`);
    }

    setImporting(false);
    setMySelected(new Set());
    onOpenChange(false);
    onCreated(lastCreatedId);
  }, [mySelected, myTemplates, ideaId, myAutoWire, onOpenChange, onCreated]);

  const handleImportPlatform = useCallback(async () => {
    if (platformSelected.size === 0) return;
    setImporting(true);

    const toImport = platformTemplates.filter((tpl) => platformSelected.has(tpl.id));
    const results = await Promise.allSettled(
      toImport.map((tpl) =>
        importTemplateWithLabel(
          ideaId,
          {
            name: tpl.name,
            description: tpl.description,
            steps: tpl.steps as WorkflowTemplateStep[],
            suggested_label_name: tpl.suggested_label_name,
            suggested_label_color: tpl.suggested_label_color,
          },
          platformAutoWire
        )
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected").length;

    let labelsCreated = 0;
    let rulesCreated = 0;
    let lastCreatedId: string | undefined;
    for (const result of succeeded) {
      const val = result.value;
      lastCreatedId = val.templateId;
      if (val.labelId) labelsCreated++;
      if (val.autoRuleId) rulesCreated++;
    }

    if (succeeded.length > 0) {
      const parts = [`${succeeded.length} template${succeeded.length !== 1 ? "s" : ""}`];
      if (labelsCreated > 0) parts.push(`${labelsCreated} label${labelsCreated !== 1 ? "s" : ""}`);
      if (rulesCreated > 0) parts.push(`${rulesCreated} auto-rule${rulesCreated !== 1 ? "s" : ""}`);
      toast.success(`Imported ${parts.join(", ")}`);
    }
    if (failed > 0) {
      toast.error(`Failed to import ${failed} template${failed !== 1 ? "s" : ""}`);
    }

    setImporting(false);
    setPlatformSelected(new Set());
    onOpenChange(false);
    onCreated(lastCreatedId);
  }, [platformSelected, platformTemplates, ideaId, platformAutoWire, onOpenChange, onCreated]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }
    if (steps.length === 0) {
      toast.error("At least one step is required");
      return;
    }
    if (steps.some((s) => !s.title.trim())) {
      toast.error("All steps must have a title");
      return;
    }

    setSaving(true);
    try {
      const finalSteps = steps.map((s, i) => ({
        ...s,
        deliverables: (deliverableStrings[i] ?? "")
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
      }));
      const result = await createWorkflowTemplate(
        ideaId,
        name.trim(),
        description.trim() || null,
        finalSteps
      );
      toast.success("Workflow template created", {
        description: "Scroll down to add a workflow trigger and auto-apply it to labelled tasks.",
      });
      resetAll();
      onOpenChange(false);
      onCreated(result.id);
    } catch {
      toast.error("Failed to create workflow template");
    } finally {
      setSaving(false);
    }
  }

  // ── Shared helpers ──

  const gateCount = (tplSteps: WorkflowTemplateStep[]) =>
    tplSteps.filter((s) => s.requires_approval).length;

  const currentSelected = activeTab === "my" ? mySelected : platformSelected;
  const isImportTab = activeTab === "my" || activeTab === "platform";

  // ── Tab definitions ──

  const tabs: { key: TabKey; label: string; icon: typeof Bookmark; count?: number }[] = [
    { key: "my", label: "My Templates", icon: Bookmark, count: myTemplates.length },
    { key: "platform", label: "Platform Templates", icon: Layers, count: platformTemplates.length },
    { key: "create", label: "Create New", icon: Plus },
  ];

  // ── Template card renderer (shared between My and Platform tabs) ──

  function renderTemplateCard<T extends { id: string; name: string; description: string | null }>(
    tpl: T,
    opts: {
      steps: WorkflowTemplateStep[];
      isSelected: boolean;
      isOnBoard: boolean;
      isExpanded: boolean;
      onToggleSelect: () => void;
      onToggleExpand: () => void;
      badges: React.ReactNode;
    }
  ) {
    const { steps: tplSteps, isSelected, isOnBoard, isExpanded, onToggleSelect, onToggleExpand, badges } = opts;
    const gates = gateCount(tplSteps);

    return (
      <div key={tpl.id} className="rounded-lg border border-border overflow-hidden">
        {/* Card header */}
        <div
          className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
            isSelected
              ? "bg-violet-500/10 border-violet-500/25"
              : isOnBoard
                ? "bg-muted/30 opacity-60"
                : "hover:bg-muted/30"
          }`}
          onClick={() => {
            if (!isOnBoard) onToggleSelect();
          }}
        >
          {/* Checkbox */}
          <div
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
              isOnBoard
                ? "border-muted-foreground/30 bg-muted/50"
                : isSelected
                  ? "border-violet-500 bg-violet-500"
                  : "border-muted-foreground/40"
            }`}
          >
            {(isSelected || isOnBoard) && <Check className="h-3 w-3 text-white" />}
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium truncate">{tpl.name}</span>
              {isOnBoard && (
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] border-emerald-500/25 bg-emerald-500/15 text-emerald-400"
                >
                  Already on board
                </Badge>
              )}
              {badges}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{tpl.description}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {tplSteps.length} step{tplSteps.length !== 1 ? "s" : ""}
              {gates > 0 && ` · ${gates} gate${gates !== 1 ? "s" : ""}`}
            </p>
          </div>

          {/* Expand toggle */}
          <button
            type="button"
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>

        {/* Expanded step preview */}
        {isExpanded && (
          <div className="border-t border-border bg-muted/10 px-3 py-2 space-y-1">
            {tplSteps.map((step, sIdx) => (
              <div key={sIdx} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {sIdx + 1}
                </span>
                <span className="flex-1 truncate">{step.title}</span>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${getRoleBadgeClasses(step.role)}`}
                >
                  {step.role}
                </Badge>
                {step.requires_approval && <Lock className="h-3 w-3 shrink-0 text-amber-400" />}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Auto-wire section ──

  function renderAutoWire(autoWire: boolean, setAutoWire: (v: boolean) => void) {
    return (
      <div className="border-t border-border pt-3 pb-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={autoWire} onCheckedChange={(v) => setAutoWire(v === true)} />
          <span className="text-xs">Also create labels &amp; auto-rules</span>
        </label>
        <p className="mt-1 text-[11px] text-muted-foreground ml-6">
          {autoWire
            ? "Importing will create suggested labels and auto-rules that trigger workflows when labels are applied."
            : "Labels and auto-rules will not be created. You can set these up manually later."}
        </p>
      </div>
    );
  }

  // ── My Templates tab content ──

  function renderMyTemplates() {
    if (myLoading) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading templates...
        </div>
      );
    }

    if (myTemplates.length === 0) {
      return (
        <div className="py-8 text-center">
          <Bookmark className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" strokeDasharray="4 2" />
          <p className="text-sm text-muted-foreground">No saved templates yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1 mb-3">
            Save templates from your boards to reuse them across projects.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setActiveTab("platform")}
          >
            Browse Platform Templates
          </Button>
        </div>
      );
    }

    return myTemplates.map((tpl) => {
      const tplSteps = tpl.steps as WorkflowTemplateStep[];
      const onBoard = isAlreadyOnBoard(tpl.name);

      return renderTemplateCard(tpl, {
        steps: tplSteps,
        isSelected: mySelected.has(tpl.id),
        isOnBoard: onBoard,
        isExpanded: myExpandedId === tpl.id,
        onToggleSelect: () => toggleMySelected(tpl.id),
        onToggleExpand: () => setMyExpandedId((prev) => (prev === tpl.id ? null : tpl.id)),
        badges: (
          <>
            {tpl.source_idea_title && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] gap-1 border-border bg-muted/30"
              >
                from: {tpl.source_idea_title}
              </Badge>
            )}
          </>
        ),
      });
    });
  }

  // ── Platform Templates tab content ──

  function renderPlatformTemplates() {
    if (platformLoading) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading templates...
        </div>
      );
    }

    if (platformTemplates.length === 0) {
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No templates available in the library yet.
        </div>
      );
    }

    return platformTemplates.map((tpl) => {
      const tplSteps = tpl.steps as WorkflowTemplateStep[];
      const onBoard = isAlreadyOnBoard(tpl.name);

      return renderTemplateCard(tpl, {
        steps: tplSteps,
        isSelected: platformSelected.has(tpl.id),
        isOnBoard: onBoard,
        isExpanded: platformExpandedId === tpl.id,
        onToggleSelect: () => togglePlatformSelected(tpl.id),
        onToggleExpand: () =>
          setPlatformExpandedId((prev) => (prev === tpl.id ? null : tpl.id)),
        badges: (
          <>
            {tpl.suggested_label_name && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] gap-1 border-border bg-muted/30"
                aria-label={`Suggested label: ${tpl.suggested_label_name}, ${tpl.suggested_label_color}`}
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${getLabelSwatchClass(tpl.suggested_label_color ?? "zinc")}`}
                />
                {tpl.suggested_label_name}
              </Badge>
            )}
          </>
        ),
      });
    });
  }

  // ── Create Template tab content ──

  function renderCreateForm() {
    return (
      <div className="space-y-4">
        {/* Name */}
        <div className="space-y-1.5">
          <Label className="text-xs">Template Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Standard Feature Workflow"
            className="h-8 text-sm"
            autoFocus={activeTab === "create"}
          />
          {(() => {
            const hint = getTemplateLabelHint(name);
            if (!hint) return null;
            return (
              <div className="flex items-center gap-1.5 mt-1.5 px-2.5 py-1.5 rounded-md border border-amber-500/20 bg-amber-500/[0.06] text-[11px] text-amber-400">
                <Lightbulb className="h-3 w-3 shrink-0" />
                <span>
                  After creating, you can auto-apply this with a{" "}
                  <span
                    className={`inline-flex items-center px-1.5 py-px rounded-full text-[10px] font-medium ${hint.badgeClass}`}
                  >
                    {hint.label}
                  </span>{" "}
                  label trigger
                </span>
              </div>
            );
          })()}
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label className="text-xs">Description (optional)</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this workflow covers..."
            className="min-h-[60px] resize-none text-sm"
          />
        </div>

        {/* Steps */}
        <div className="space-y-2">
          <Label className="text-xs">Steps</Label>

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
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    Description
                  </span>
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
                      onCheckedChange={(v) => updateStep(idx, { requires_approval: v })}
                    />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">Gate</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-7">
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    Deliverables
                  </span>
                  <Input
                    value={deliverableStrings[idx] ?? ""}
                    onChange={(e) =>
                      setDeliverableStrings((prev) => {
                        const next = [...prev];
                        next[idx] = e.target.value;
                        return next;
                      })
                    }
                    placeholder="Deliverables (optional) — e.g. HTML mockups, API spec"
                    className="h-7 flex-1 text-xs"
                  />
                </div>
              </div>

              <button
                type="button"
                className="mt-1 rounded p-1 text-muted-foreground hover:text-destructive"
                onClick={() => removeStep(idx)}
                disabled={steps.length <= 1}
              >
                <Trash2 className={`h-3.5 w-3.5 ${steps.length <= 1 ? "opacity-30" : ""}`} />
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
      </div>
    );
  }

  // ── Determine if auto-wire section should show ──

  const showAutoWire =
    (activeTab === "my" && !myLoading && myTemplates.length > 0) ||
    (activeTab === "platform" && !platformLoading && platformTemplates.length > 0);

  const currentAutoWire = activeTab === "my" ? myAutoWire : platformAutoWire;
  const setCurrentAutoWire = activeTab === "my" ? setMyAutoWire : setPlatformAutoWire;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Template</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border -mx-6 px-6">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors relative ${
                  isActive ? "text-violet-400" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab(tab.key)}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={`ml-1 inline-flex items-center justify-center rounded-full px-1.5 py-px text-[10px] font-medium ${
                      isActive
                        ? "bg-violet-500/10 text-violet-400"
                        : "bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {/* Active indicator */}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-violet-400 rounded-t" />
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto space-y-2 py-2">
          {activeTab === "my" && renderMyTemplates()}
          {activeTab === "platform" && renderPlatformTemplates()}
          {activeTab === "create" && renderCreateForm()}
        </div>

        {/* Auto-wire (only for import tabs) */}
        {isImportTab && showAutoWire && renderAutoWire(currentAutoWire, setCurrentAutoWire)}

        {/* Footer */}
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={importing || saving}
          >
            Cancel
          </Button>

          {activeTab === "my" && (
            <Button
              size="sm"
              disabled={mySelected.size === 0 || importing}
              onClick={handleImportMy}
            >
              {importing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Import{mySelected.size > 0 ? ` (${mySelected.size})` : ""}
            </Button>
          )}

          {activeTab === "platform" && (
            <Button
              size="sm"
              disabled={platformSelected.size === 0 || importing}
              onClick={handleImportPlatform}
            >
              {importing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Import{platformSelected.size > 0 ? ` (${platformSelected.size})` : ""}
            </Button>
          )}

          {activeTab === "create" && (
            <Button size="sm" disabled={saving} onClick={handleCreate}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Create Template
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
