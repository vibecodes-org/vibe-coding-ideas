"use client";

import { useState, useEffect, useCallback } from "react";
import { usePostHog } from "posthog-js/react";
import { toast } from "sonner";
import { Loader2, Package, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
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
  const [loadError, setLoadError] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const posthog = usePostHog();

  const loadKits = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    setSelectedKitId(null);
    getActiveKitsWithSteps()
      .then(setKits)
      .catch(() => {
        setLoadError(true);
        toast.error("Failed to load project kits");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    loadKits();
  }, [open, loadKits]);

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
      const tplCount = result.templatesImported ?? (result.templateImported ? 1 : 0);
      const trgCount = result.triggersCreated ?? (result.autoRuleCreated ? 1 : 0);
      if (tplCount > 0) parts.push(`${tplCount} workflow${tplCount !== 1 ? "s" : ""}`);
      if (trgCount > 0) parts.push(`${trgCount} trigger${trgCount !== 1 ? "s" : ""}`);


      posthog?.capture("kit_applied", {
        surface: "apply_kit_dialog",
        kit: selectedKit!.name,
        agents_created: result.agentsCreated,
        labels_created: result.labelsCreated,
      });

      toast.success(
        `${selectedKit!.name} kit applied${parts.length > 0 ? ` — ${parts.join(", ")}` : ""}`
      );
      onOpenChange(false);
      onApplied?.(result);
    } catch {
      toast.error("Failed to apply kit. Try again, or set up agents & workflows from the Workflows tab.");
    } finally {
      setApplying(false);
    }
  };

  const selectableKits = kits.filter((k) => k.name !== "Custom");

  const body = loading ? (
    <div className="flex items-center justify-center py-8" aria-busy="true">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading project kits</span>
    </div>
  ) : loadError ? (
    <div className="flex items-start gap-2 rounded-md border border-rose-500/35 bg-rose-500/[0.07] px-3 py-2.5 text-xs text-rose-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Couldn&apos;t load project kits.{" "}
        <button
          type="button"
          onClick={loadKits}
          className="font-medium underline hover:text-rose-200"
        >
          Retry
        </button>
      </span>
    </div>
  ) : selectableKits.length === 0 ? (
    <div className="rounded-md border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
      No project kits are available yet.
      <br />
      You can still set up agents and workflows manually.
    </div>
  ) : (
    <div className="space-y-3">
      <ProjectTypeSelector
        kits={selectableKits}
        selectedKitId={selectedKitId}
        onSelect={setSelectedKitId}
        compact
        surface="apply_kit_dialog"
      />
      {selectedKit && !isCustom && (
        <KitPreview kit={selectedKit} />
      )}
      <div className="flex items-start gap-2 rounded-md border border-blue-500/25 bg-blue-500/[0.06] px-3 py-2.5 text-xs text-blue-200">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400" />
        <span>
          <strong className="font-semibold">No tasks are added.</strong> This kit
          sets up your agents, workflows, labels and triggers only &mdash; your
          existing board tasks stay exactly as they are.
        </span>
      </div>
    </div>
  );

  const footer = (
    <>
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
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Apply a Project Kit
            </DrawerTitle>
            <DrawerDescription>
              Choose a project type to set up agents, workflows, labels, and
              workflow triggers for this idea.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2 max-h-[60vh] overflow-y-auto">
            {body}
          </div>
          <DrawerFooter>
            {footer}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

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
            workflow triggers for this idea.
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
