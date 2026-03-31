"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bookmark, Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { getRoleBadgeClasses } from "@/components/board/task-workflow-section";
import { saveToMyTemplates } from "@/actions/user-templates";
import type { WorkflowTemplateStep } from "@/types/database";

interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  ideaId: string;
  templateName: string;
  templateDescription: string | null;
  steps: WorkflowTemplateStep[];
  onSaved: () => void;
}

export function SaveTemplateDialog({
  open,
  onOpenChange,
  templateId,
  ideaId,
  templateName,
  templateDescription,
  steps,
  onSaved,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState(templateName);
  const [description, setDescription] = useState(templateDescription ?? "");
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens with new template
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setName(templateName);
      setDescription(templateDescription ?? "");
    }
    onOpenChange(isOpen);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }
    setSaving(true);
    try {
      await saveToMyTemplates(templateId, ideaId, name.trim(), description.trim() || undefined);
      toast.success("Template saved to My Templates");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-emerald-400" />
            Save to My Templates
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            This template will be copied to your personal collection for reuse on
            any board.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              className="h-8 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              className="min-h-[60px] resize-none text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this template"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Steps included</Label>
            <div className="rounded-md border border-border bg-muted/10 p-2 space-y-1">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 py-1"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {idx + 1}
                  </span>
                  <span className="flex-1 truncate text-xs">{step.title}</span>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[9px] ${getRoleBadgeClasses(step.role)}`}
                  >
                    {step.role}
                  </Badge>
                  {step.requires_approval && (
                    <Lock className="h-3 w-3 shrink-0 text-amber-400" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Bookmark className="h-3 w-3" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
