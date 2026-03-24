"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProjectTypeSelector } from "./project-type-selector";
import { KitPreview } from "./kit-preview";
import { getActiveKitsWithSteps, applyKit } from "@/actions/kits";
import type { ApplyKitResult, KitWithSteps } from "@/actions/kits";

interface ApplyKitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  onApplied?: (result: ApplyKitResult) => void;
}

export function ApplyKitDialog({
  open,
  onOpenChange,
  ideaId,
  onApplied,
}: ApplyKitDialogProps) {
  const [kits, setKits] = useState<KitWithSteps[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelectedKitId(null);
    getActiveKitsWithSteps()
      .then(setKits)
      .catch(() => toast.error("Failed to load project kits"))
      .finally(() => setLoading(false));
  }, [open]);

  const selectedKit = kits.find((k) => k.id === selectedKitId) ?? null;
  const isCustom = selectedKit?.name === "Custom";
  const canApply = !!selectedKitId && !isCustom;

  const handleApply = async () => {
    if (!canApply) return;
    setApplying(true);
    try {
      const result = await applyKit(ideaId, selectedKitId!);
      const parts: string[] = [];
      if (result.agentsCreated > 0)
        parts.push(`${result.agentsCreated} agent${result.agentsCreated !== 1 ? "s" : ""}`);
      if (result.labelsCreated > 0)
        parts.push(`${result.labelsCreated} label${result.labelsCreated !== 1 ? "s" : ""}`);
      if (result.templateImported) parts.push("workflow imported");
      if (result.autoRuleCreated) parts.push("auto-rule created");

      toast.success(
        `${selectedKit!.name} kit applied${parts.length > 0 ? ` — ${parts.join(", ")}` : ""}`
      );
      onOpenChange(false);
      onApplied?.(result);
    } catch {
      toast.error("Failed to apply kit. Your idea was created — you can apply a kit from the Workflows tab.");
    } finally {
      setApplying(false);
    }
  };

  // Filter out Custom for the dialog
  const selectableKits = kits.filter((k) => k.name !== "Custom");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Apply a Project Kit
          </DialogTitle>
          <DialogDescription>
            Choose a project type to set up agents, workflows, labels, and
            auto-rules for this idea.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <ProjectTypeSelector
              kits={selectableKits}
              selectedKitId={selectedKitId}
              onSelect={setSelectedKitId}
              compact
            />
            {selectedKit && !isCustom && (
              <KitPreview kit={selectedKit} compact />
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!canApply || applying}>
            {applying ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Applying {selectedKit?.name} kit...
              </>
            ) : selectedKit ? (
              `Apply ${selectedKit.name} Kit`
            ) : (
              "Select a kit"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
