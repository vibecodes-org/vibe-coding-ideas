"use client";

import { useState } from "react";
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
import { createWorkflowTemplate } from "@/actions/workflow-templates";
import type { WorkflowTemplateStep } from "@/types/database";

const DEFAULT_STEP: WorkflowTemplateStep = {
  title: "",
  role: "Dev",
  requires_approval: false,
};

interface CreateTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  onCreated: () => void;
}

export function CreateTemplateDialog({
  open,
  onOpenChange,
  ideaId,
  onCreated,
}: CreateTemplateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<WorkflowTemplateStep[]>([
    { ...DEFAULT_STEP },
  ]);
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setSteps([{ ...DEFAULT_STEP }]);
  }

  function updateStep(idx: number, patch: Partial<WorkflowTemplateStep>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function addStep() {
    setSteps((prev) => [...prev, { ...DEFAULT_STEP }]);
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

    setSaving(true);
    try {
      await createWorkflowTemplate(
        ideaId,
        name.trim(),
        description.trim() || null,
        steps,
      );
      toast.success("Workflow template created");
      reset();
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error("Failed to create workflow template");
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
          <DialogTitle>Create Workflow Template</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Template Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard Feature Workflow"
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
                    <Input
                      value={step.title}
                      onChange={(e) =>
                        updateStep(idx, { title: e.target.value })
                      }
                      placeholder="Step title"
                      className="h-7 flex-1 text-xs"
                    />
                    <Input
                      value={step.role}
                      onChange={(e) =>
                        updateStep(idx, { role: e.target.value })
                      }
                      placeholder="Role"
                      className="h-7 w-24 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-3 pl-7">
                    <Input
                      value={step.description ?? ""}
                      onChange={(e) =>
                        updateStep(idx, {
                          description: e.target.value || undefined,
                        })
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
                        Approval gate
                      </span>
                    </div>
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
              Create Template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
