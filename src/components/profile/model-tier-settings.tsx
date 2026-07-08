"use client";

import { useState, useTransition } from "react";
import { Cpu } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateModelTierMap } from "@/actions/profile";
import { setViewerModelTierMapCache } from "@/hooks/use-viewer-model-tier-map";
import {
  MODEL_TIER_PLATFORM_DEFAULT_MODEL,
  MODEL_TIER_WHEN_TO_USE,
  type ModelAlias,
  type ModelTierMap,
  type ModelTierValue,
} from "@/lib/constants";

// Radix Select can't use "" as an item value, so "follow the platform
// default" uses this sentinel (unset key in the stored map).
const PLATFORM_DEFAULT_VALUE = "__platform_default__";

const MODEL_OPTIONS: { value: ModelAlias; label: string; gloss: string }[] = [
  { value: "fable", label: "Fable", gloss: "Most capable — frontier reasoning" },
  { value: "opus", label: "Opus", gloss: "Deep reasoning — previous flagship" },
  { value: "sonnet", label: "Sonnet", gloss: "Balanced speed & quality" },
  { value: "haiku", label: "Haiku", gloss: "Fastest & lowest cost" },
];

const TIER_FIELDS: { tier: ModelTierValue; label: string }[] = [
  { tier: "frontier", label: "Frontier" },
  { tier: "standard", label: "Standard" },
  { tier: "cheap", label: "Cheap" },
];

interface ModelTierSettingsProps {
  /** The signed-in user's model_tier_map, fetched server-side (like hasKey). */
  map: ModelTierMap | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * "Model tier mapping" settings dialog (own-profile only, FR-13/14). Modelled
 * on api-key-settings.tsx: outline trigger → sm:max-w-md dialog. Save is the
 * only write path — Reset stages an all-cleared map locally, Cancel/Esc
 * discards staged changes (Design §02/§03).
 */
export function ModelTierSettings({
  map,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ModelTierSettingsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;
  const [isPending, startTransition] = useTransition();
  const [staged, setStaged] = useState<ModelTierMap>(map ?? {});

  // Re-stage from the persisted map on every open so a prior Cancel never
  // leaks into the next open.
  function handleOpenChange(next: boolean) {
    if (next) setStaged(map ?? {});
    setOpen(next);
  }

  const isDirty = TIER_FIELDS.some(
    ({ tier }) => (staged[tier] ?? null) !== (map?.[tier] ?? null)
  );
  const hasAnyOverride = TIER_FIELDS.some(({ tier }) => staged[tier] !== undefined);

  function handleTierChange(tier: ModelTierValue, value: string) {
    setStaged((prev) => {
      const next = { ...prev };
      if (value === PLATFORM_DEFAULT_VALUE) delete next[tier];
      else next[tier] = value;
      return next;
    });
  }

  function handleReset() {
    setStaged({});
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const saved = await updateModelTierMap(staged);
        setViewerModelTierMapCache(saved);
        toast.success("Model tiers saved");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save model tiers — try again");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Cpu className="h-4 w-4" />
            Model Tiers
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Model tier mapping
          </DialogTitle>
          <DialogDescription>
            Choose which Claude model runs each workflow tier. Tiers you leave unset use the platform default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {TIER_FIELDS.map(({ tier, label }) => {
            const selectValue = staged[tier] ?? PLATFORM_DEFAULT_VALUE;
            const platformLabel = MODEL_TIER_PLATFORM_DEFAULT_MODEL[tier];
            const selectedOption = MODEL_OPTIONS.find((m) => m.value === staged[tier]);
            const triggerId = `model-tier-map-${tier}`;

            return (
              <div key={tier} className="space-y-1.5">
                <Label htmlFor={triggerId} className="text-sm">
                  {label}{" "}
                  <span className="font-normal text-muted-foreground">— {MODEL_TIER_WHEN_TO_USE[tier]}</span>
                </Label>
                <Select
                  value={selectValue}
                  onValueChange={(v) => handleTierChange(tier, v)}
                  disabled={isPending}
                >
                  <SelectTrigger id={triggerId} aria-describedby="model-tier-fallback-help" className="w-full">
                    <SelectValue>
                      {selectedOption ? (
                        selectedOption.label
                      ) : (
                        <span className="text-muted-foreground">{platformLabel} (default)</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PLATFORM_DEFAULT_VALUE}>
                      Platform default ({platformLabel})
                    </SelectItem>
                    <SelectSeparator />
                    {MODEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          <p id="model-tier-fallback-help" className="text-[11px] text-muted-foreground">
            Workflow steps with a tier run on that tier&apos;s model. If a model isn&apos;t available on your plan
            or session, the orchestrator substitutes the closest available alternative and notes it in the step
            output.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isPending || !hasAnyOverride}
          >
            Reset to defaults
          </Button>
          <div className="flex flex-1 justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isPending || !isDirty}
              aria-describedby={!isDirty ? "model-tier-save-why" : undefined}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
        {!isDirty && (
          <p id="model-tier-save-why" className="-mt-2 text-right text-[11px] text-muted-foreground">
            Save enables when you change a tier.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
