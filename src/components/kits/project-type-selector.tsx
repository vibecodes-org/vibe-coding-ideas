"use client";

import { useRef, useCallback } from "react";
import { usePostHog } from "posthog-js/react";
import { cn } from "@/lib/utils";
import type { KitWithSteps } from "@/actions/kits";

interface ProjectTypeSelectorProps {
  kits: KitWithSteps[];
  selectedKitId: string | null;
  onSelect: (kitId: string | null) => void;
  compact?: boolean;
  /** Analytics surface this picker is shown on (e.g. "onboarding",
   *  "apply_kit_dialog"). When set, selecting a kit fires a `kit_selected`
   *  PostHog event. Omit to stay silent (the create form fires its own events). */
  surface?: string;
}

export function ProjectTypeSelector({
  kits,
  selectedKitId,
  onSelect,
  compact = false,
  surface,
}: ProjectTypeSelectorProps) {
  const posthog = usePostHog();
  const groupRef = useRef<HTMLDivElement>(null);

  // Per-surface selection event — only when a surface is provided.
  const handleSelect = useCallback(
    (kitId: string | null) => {
      if (surface && kitId) {
        const kit = kits.find((k) => k.id === kitId);
        posthog?.capture("kit_selected", {
          surface,
          kit: kit?.name ?? "unknown",
          is_custom: kit?.name === "Custom",
        });
      }
      onSelect(kitId);
    },
    [surface, kits, onSelect, posthog]
  );

  // Sort: Custom always last
  const sorted = [...kits].sort((a, b) => {
    if (a.name === "Custom") return 1;
    if (b.name === "Custom") return -1;
    return a.display_order - b.display_order;
  });

  // Arrow key navigation for radiogroup
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role='radio']");
      if (!buttons || buttons.length === 0) return;

      const currentIndex = Array.from(buttons).findIndex(
        (btn) => btn === document.activeElement
      );
      let next = currentIndex;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (currentIndex + 1) % buttons.length;
      } else {
        next = (currentIndex - 1 + buttons.length) % buttons.length;
      }
      buttons[next].focus();
      handleSelect(sorted[next].id);
    },
    [sorted, handleSelect]
  );

  return (
    <div
      ref={groupRef}
      className={cn(
        // grid-auto-rows:1fr → every row is the same height, so the Custom card's
        // "Your choice" badge can't make its row taller than the others.
        "grid gap-2 [grid-auto-rows:1fr]",
        compact
          ? "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]"
          : "grid-cols-2 sm:grid-cols-3"
      )}
      role="radiogroup"
      aria-label="Project type"
      onKeyDown={handleKeyDown}
    >
      {sorted.map((kit, i) => {
        const isCustom = kit.name === "Custom";
        const isSelected = selectedKitId === kit.id;
        // Option D — "promote & recede": once something is picked, the other cards
        // recede so the chosen one (and its preview below) clearly owns the focus.
        const dimmed = selectedKitId !== null && !isSelected;

        return (
          <button
            key={kit.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected || (!selectedKitId && i === 0) ? 0 : -1}
            onClick={() => handleSelect(isSelected ? null : kit.id)}
            className={cn(
              // flex + justify-center keeps content vertically centred now that all
              // rows are equalised to the same height.
              "flex flex-col items-center justify-center rounded-xl border-2 text-center transition-all duration-200",
              compact ? "px-2 py-1.5" : "px-3 py-2",
              isSelected
                ? "border-violet-500 bg-violet-500/[0.12] hover:-translate-y-0.5"
                : "border-border bg-zinc-900 hover:border-muted-foreground/25 hover:-translate-y-0.5",
              // Receded state restores on hover/focus so it still reads as clickable.
              dimmed && "opacity-60 saturate-50 hover:opacity-100 hover:saturate-100 focus-visible:opacity-100 focus-visible:saturate-100"
            )}
          >
            <div className={cn("leading-none mb-1", compact ? "text-base" : "text-lg")}>
              {kit.icon}
            </div>
            <div
              className={cn(
                "font-bold leading-tight",
                compact ? "text-xs" : "text-[0.8rem]"
              )}
            >
              {kit.name}
            </div>
            {kit.description && (
              <p
                className={cn(
                  "mt-0.5 text-balance leading-snug text-muted-foreground",
                  compact ? "text-[0.65rem]" : "text-[0.7rem]"
                )}
              >
                {kit.description}
              </p>
            )}
            {isCustom && (
              <div className="mt-1 flex justify-center">
                <span className="rounded-full bg-muted px-1.5 py-0 text-[0.6rem] font-semibold text-muted-foreground">
                  Your choice
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
