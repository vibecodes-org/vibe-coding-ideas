"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RoleCombobox, type RoleSuggestion } from "@/components/ui/role-combobox";
import { ModelTierSelect, ModelTierBadge } from "@/components/shared/model-tier-select";
import { ApprovalLockIcon } from "./approval-lock-icon";
import {
  formatDeliverablesText,
  parseDeliverablesText,
} from "@/lib/deliverables-text";
import type { WorkflowTemplateStep } from "@/types/database";

interface TemplateStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: WorkflowTemplateStep;
  index: number;
  templateName: string;
  ideaId?: string;
  isReadOnly?: boolean;
  poolRoles?: RoleSuggestion[];
  userRoles?: RoleSuggestion[];
  onSave: (step: WorkflowTemplateStep) => Promise<void>;
}

/**
 * Edit one step of a workflow template. Same seven settings, labels, help
 * lines and order as the card's own step box (step-detail-dialog edit mode).
 */
export function TemplateStepDialog({
  open,
  onOpenChange,
  step,
  index,
  templateName,
  ideaId,
  isReadOnly = false,
  poolRoles,
  userRoles,
  onSave,
}: TemplateStepDialogProps) {
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description ?? "");
  const [role, setRole] = useState(step.role ?? "");
  const [tier, setTier] = useState<string | null>(step.model_tier ?? null);
  const [effort, setEffort] = useState<string | null>(
    step.model_tier ? (step.effort ?? null) : null
  );
  const [deliverables, setDeliverables] = useState(
    formatDeliverablesText(step.deliverables)
  );
  const [approval, setApproval] = useState(step.requires_approval ?? false);
  const [saving, setSaving] = useState(false);

  // Seed from the step each time the dialog opens; never sync while open.
  useEffect(() => {
    if (!open) return;
    setTitle(step.title);
    setDescription(step.description ?? "");
    setRole(step.role ?? "");
    setTier(step.model_tier ?? null);
    setEffort(step.model_tier ? (step.effort ?? null) : null);
    setDeliverables(formatDeliverablesText(step.deliverables));
    setApproval(step.requires_approval ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  async function handleSave() {
    // Untouched box: keep the stored list exactly (items may contain commas).
    const untouched = deliverables === formatDeliverablesText(step.deliverables);
    const list = untouched ? (step.deliverables ?? []) : parseDeliverablesText(deliverables);
    const updated: WorkflowTemplateStep = {
      ...step,
      title: title.trim(),
      description: description.trim() || undefined,
      role,
      requires_approval: approval,
      model_tier: tier ?? undefined,
      effort: tier ? (effort ?? undefined) : undefined,
      deliverables: list.length > 0 ? list : undefined,
    };
    if (!updated.deliverables) delete updated.deliverables;
    setSaving(true);
    try {
      await onSave(updated);
      toast.success("Step updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update step");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 p-0 sm:max-w-2xl lg:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="sr-only">Edit step</DialogTitle>
          <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="break-words text-sm font-semibold">
                {step.title || "Untitled step"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {step.role && (
                  <Badge variant="outline" className="text-[10px]">
                    {step.role}
                  </Badge>
                )}
                <ModelTierBadge tier={step.model_tier} effort={step.effort} />
                {step.requires_approval && <ApprovalLockIcon className="h-3 w-3" />}
                <span className="text-[11px] text-muted-foreground">{templateName}</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Saving changes this template. Cards already using it pick up the change on any
            step that hasn&apos;t started yet.
          </p>
          <fieldset disabled={isReadOnly || saving} className="m-0 min-w-0 space-y-3 border-0 p-0">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-step-title" className="text-xs">Title</Label>
              <Input
                id="tpl-step-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-sm"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-step-description" className="text-xs">Description</Label>
              <Textarea
                id="tpl-step-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="max-h-[45vh] min-h-[60px] overflow-y-auto text-sm"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-step-role" className="text-xs">Agent Role</Label>
              <RoleCombobox
                value={role}
                onChange={setRole}
                placeholder="e.g. developer, designer"
                maxLength={100}
                ideaId={ideaId}
                showHelperText
                helperText="Matched against agents when template is applied"
                poolRoles={poolRoles}
                userRoles={userRoles}
              />
            </div>
            <ModelTierSelect
              variant="full"
              value={tier}
              onChange={setTier}
              effort={effort}
              onEffortChange={setEffort}
              disabled={isReadOnly || saving}
            />
            <div className="space-y-1.5">
              <Label htmlFor="tpl-step-deliverables" className="text-xs">Expected Deliverables</Label>
              <Textarea
                id="tpl-step-deliverables"
                value={deliverables}
                onChange={(e) => setDeliverables(e.target.value)}
                className="max-h-[30vh] min-h-9 overflow-y-auto text-sm"
                rows={1}
                placeholder="Comma-separated, e.g. Design doc, API schema"
              />
              <p className="text-[11px] text-muted-foreground">
                Separate items with commas or new lines.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="tpl-step-approval"
                checked={approval}
                onCheckedChange={setApproval}
              />
              <Label htmlFor="tpl-step-approval" className="text-xs">Requires human approval</Label>
            </div>
          </fieldset>
          <div className="flex gap-2 pt-1">
            {!isReadOnly && (
              <Button
                size="sm"
                className="text-xs"
                onClick={handleSave}
                disabled={saving || !title.trim()}
              >
                {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                Save
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {isReadOnly ? "Close" : "Cancel"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
