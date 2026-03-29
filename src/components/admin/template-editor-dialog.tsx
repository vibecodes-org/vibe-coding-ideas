"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { createLibraryTemplate, updateLibraryTemplate } from "@/actions/admin-templates";
import { RoleCombobox } from "@/components/ui/role-combobox";
import { LABEL_COLORS } from "@/lib/constants";
import type { WorkflowTemplateStep } from "@/types/database";
import type { WorkflowLibraryTemplate } from "@/types";

const DEFAULT_STEP: WorkflowTemplateStep = {
  title: "",
  role: "",
  requires_approval: false,
  deliverables: [],
};

interface TemplateEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTemplate: WorkflowLibraryTemplate | null;
  onSuccess: () => void;
}

export function TemplateEditorDialog({
  open,
  onOpenChange,
  editTemplate,
  onSuccess,
}: TemplateEditorDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<WorkflowTemplateStep[]>([{ ...DEFAULT_STEP }]);
  const [saving, setSaving] = useState(false);
  const [deliverableStrings, setDeliverableStrings] = useState<string[]>([""]);
  const [suggestedLabelName, setSuggestedLabelName] = useState("");
  const [suggestedLabelColor, setSuggestedLabelColor] = useState("");

  const isEditing = !!editTemplate;

  useEffect(() => {
    if (editTemplate) {
      setName(editTemplate.name);
      setDescription(editTemplate.description ?? "");
      const loadedSteps = editTemplate.steps.length > 0
        ? editTemplate.steps.map((s) => ({ ...s }))
        : [{ ...DEFAULT_STEP }];
      setSteps(loadedSteps);
      setDeliverableStrings(loadedSteps.map((s) => (s.deliverables ?? []).join(", ")));
      setSuggestedLabelName(editTemplate.suggested_label_name ?? "");
      setSuggestedLabelColor(editTemplate.suggested_label_color ?? "");
    } else {
      setName("");
      setDescription("");
      setSteps([{ ...DEFAULT_STEP }]);
      setDeliverableStrings([""]);
      setSuggestedLabelName("");
      setSuggestedLabelColor("");
    }
  }, [editTemplate]);

  function reset() {
    setName("");
    setDescription("");
    setSteps([{ ...DEFAULT_STEP }]);
    setDeliverableStrings([""]);
    setSuggestedLabelName("");
    setSuggestedLabelColor("");
  }

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

  async function handleSubmit(e: React.FormEvent) {
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
    if (steps.some((s) => !s.role.trim())) {
      toast.error("All steps must have a role");
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
      const suggestedLabel = suggestedLabelName.trim()
        ? { name: suggestedLabelName.trim(), color: suggestedLabelColor || "zinc" }
        : null;
      if (isEditing) {
        await updateLibraryTemplate(editTemplate.id, {
          name: name.trim(),
          description: description.trim() || null,
          steps: finalSteps,
          suggested_label: suggestedLabel,
        });
        toast.success("Template updated");
      } else {
        await createLibraryTemplate(name.trim(), description.trim() || null, finalSteps, suggestedLabel);
        toast.success("Template created");
      }
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Template" : "Create Library Template"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Template Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Feature Development"
              className="h-8 text-sm"
              autoFocus
            />
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

          {/* Suggested Label */}
          <div className="space-y-2 rounded-md border border-violet-500/25 bg-violet-500/5 p-3">
            <Label className="text-xs text-violet-400">Suggested Label (optional)</Label>
            <p className="text-[11px] text-muted-foreground">
              When users import this template, this label and an auto-rule will be created automatically.
            </p>
            <Input
              value={suggestedLabelName}
              onChange={(e) => setSuggestedLabelName(e.target.value)}
              placeholder="e.g. Bug, Feature, Research"
              className="h-7 text-xs"
            />
            {suggestedLabelName.trim() && (
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Color</span>
                <div className="flex flex-wrap gap-1.5">
                  {LABEL_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      title={c.label}
                      className={`h-6 w-6 rounded ${c.swatchColor} transition-all ${
                        suggestedLabelColor === c.value
                          ? "ring-2 ring-white ring-offset-1 ring-offset-background"
                          : "hover:scale-110"
                      }`}
                      onClick={() => setSuggestedLabelColor(c.value)}
                    />
                  ))}
                </div>
              </div>
            )}
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
                        onCheckedChange={(v) => updateStep(idx, { requires_approval: v })}
                      />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        Gate
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 pl-7">
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">Deliverables</span>
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
                  <Trash2
                    className={`h-3.5 w-3.5 ${steps.length <= 1 ? "opacity-30" : ""}`}
                  />
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

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
