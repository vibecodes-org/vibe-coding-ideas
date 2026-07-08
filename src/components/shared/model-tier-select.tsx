"use client";

import * as React from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SelectContent } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useViewerModelTierMap } from "@/hooks/use-viewer-model-tier-map";
import {
  MODEL_TIERS,
  MODEL_TIER_AUTO_GLOSS,
  MODEL_TIER_RUNS_ON_HELPER,
  modelTierLabel,
  modelTierGloss,
  type ModelTierMap,
} from "@/lib/constants";

// Radix Select can't use "" as an item value, so Auto (null) uses this sentinel.
const AUTO_VALUE = "__auto__";

interface TierOption {
  value: string;
  label: React.ReactNode;
  gloss: string;
}

/**
 * Tier options with viewer-resolved glosses (Design-Review CONDITION 3) — a
 * user mapped frontier→opus must read "Runs on Opus", never the platform
 * default. `viewerMap` is undefined while loading, which modelTierGloss
 * falls back to the platform-default display name for.
 */
function buildOptions(viewerMap: ModelTierMap | null | undefined): TierOption[] {
  return [
    {
      value: AUTO_VALUE,
      label: (
        <>
          Auto
        </>
      ),
      gloss: MODEL_TIER_AUTO_GLOSS,
    },
    ...MODEL_TIERS.map((t) => ({
      value: t.value,
      label: t.label,
      gloss: modelTierGloss(t.value, viewerMap?.[t.value]),
    })),
  ];
}

/**
 * Two-line option (name + gloss). Only the name sits inside ItemText, so the
 * closed trigger shows the name alone while the listbox shows name + gloss.
 */
function TierItem({ value, label, gloss }: TierOption) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default select-none flex-col items-start gap-0.5 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:justify-center",
      )}
    >
      <span className="text-sm font-medium leading-tight">
        <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
      </span>
      <span className="text-[11px] text-muted-foreground leading-tight">{gloss}</span>
      <span className="absolute right-2 top-1.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export interface ModelTierSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** "compact" = inline template-editor row; "full" = stacked dialog field. */
  variant?: "compact" | "full";
  id?: string;
  className?: string;
}

/**
 * Shared model-tier control. Auto = null (stored as absent/NULL). Steps with a
 * tier now run on that tier's mapped model (P2b — mandatory, not advisory);
 * same four options, viewer-resolved glosses, and always-visible helper in
 * every mount; only the layout differs between the compact template-editor
 * row and the full dialog field.
 */
export function ModelTierSelect({
  value,
  onChange,
  disabled,
  variant = "compact",
  id,
  className,
}: ModelTierSelectProps) {
  const reactId = React.useId();
  const triggerId = id ?? `model-tier-${reactId}`;
  const helperId = `${triggerId}-helper`;
  const viewerMap = useViewerModelTierMap();
  const options = React.useMemo(() => buildOptions(viewerMap), [viewerMap]);

  const selectValue = value ?? AUTO_VALUE;
  const handleChange = (v: string) => onChange(v === AUTO_VALUE ? null : v);

  const displayLabel =
    value === null || value === undefined ? (
      <>
        Auto
      </>
    ) : (
      modelTierLabel(value)
    );

  const listbox = (
    <SelectContent aria-label="Model tier" className="min-w-[16rem]">
      {options.map((opt) => (
        <TierItem key={opt.value} {...opt} />
      ))}
    </SelectContent>
  );

  // Shared trigger chrome (mirrors shadcn SelectTrigger) with a coarse-pointer
  // 44px min height for touch.
  const triggerClass = cn(
    "border-input dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 flex items-center justify-between gap-2 rounded-md border bg-transparent text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11",
    "[&>span]:line-clamp-1 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  );

  if (variant === "full") {
    return (
      <div className={cn("space-y-1.5", className)}>
        <Label htmlFor={triggerId} className="text-xs">
          Model tier
        </Label>
        <SelectPrimitive.Root value={selectValue} onValueChange={handleChange} disabled={disabled}>
          <SelectPrimitive.Trigger
            id={triggerId}
            aria-describedby={helperId}
            className={cn(triggerClass, "h-8 w-full px-3 text-sm")}
          >
            <SelectPrimitive.Value>{displayLabel}</SelectPrimitive.Value>
            <SelectPrimitive.Icon asChild>
              <ChevronDownIcon className="size-4 opacity-50" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          {listbox}
        </SelectPrimitive.Root>
        <p id={helperId} className="text-[11px] text-muted-foreground">
          {MODEL_TIER_RUNS_ON_HELPER}
        </p>
      </div>
    );
  }

  // Compact inline row — matches the sibling Title/Role/Deliverables rows.
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-7", className)}>
      <Label htmlFor={triggerId} className="text-[10px] text-muted-foreground whitespace-nowrap">
        Model tier
      </Label>
      <SelectPrimitive.Root value={selectValue} onValueChange={handleChange} disabled={disabled}>
        <SelectPrimitive.Trigger
          id={triggerId}
          aria-describedby={helperId}
          className={cn(triggerClass, "h-7 w-[150px] px-2 text-xs")}
        >
          <SelectPrimitive.Value>{displayLabel}</SelectPrimitive.Value>
          <SelectPrimitive.Icon asChild>
            <ChevronDownIcon className="size-3.5 opacity-50" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        {listbox}
      </SelectPrimitive.Root>
      <span id={helperId} className="min-w-0 flex-1 text-[10px] text-muted-foreground">
        {MODEL_TIER_RUNS_ON_HELPER}
      </span>
    </div>
  );
}

/**
 * Read-only tier badge for step cards and dialog headers. Renders nothing for
 * Auto (null) — silence is the default. Monochrome outline so it never competes
 * with the colour-coded role/status badges.
 */
export function ModelTierBadge({
  tier,
  className,
}: {
  tier: string | null | undefined;
  className?: string;
}) {
  if (!tier) return null;
  const label = modelTierLabel(tier);
  return (
    <Badge
      variant="outline"
      aria-label={`Model tier: ${label}`}
      className={cn(
        "shrink-0 gap-0.5 text-[10px] font-normal border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200",
        className,
      )}
    >
      <span className="text-muted-foreground">tier:</span>
      {label}
    </Badge>
  );
}
