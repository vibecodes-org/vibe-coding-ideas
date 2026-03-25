"use client";

import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { KitWithSteps } from "@/actions/kits";

interface ProjectTypeSelectorProps {
  kits: KitWithSteps[];
  selectedKitId: string | null;
  onSelect: (kitId: string | null) => void;
  compact?: boolean;
}

export function ProjectTypeSelector({
  kits,
  selectedKitId,
  onSelect,
  compact = false,
}: ProjectTypeSelectorProps) {
  const groupRef = useRef<HTMLDivElement>(null);

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
      onSelect(sorted[next].id);
    },
    [sorted, onSelect]
  );

  return (
    <div
      ref={groupRef}
      className={cn(
        "grid gap-2",
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
        const agentCount = (kit.agent_roles as unknown[])?.length ?? 0;
        const stepCount = kit.workflow_steps?.length ?? 0;

        return (
          <button
            key={kit.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected || (!selectedKitId && i === 0) ? 0 : -1}
            onClick={() => onSelect(isSelected ? null : kit.id)}
            className={cn(
              "rounded-xl border-2 text-center transition-all duration-200",
              compact ? "p-2.5" : "p-3",
              isSelected
                ? "border-violet-500 bg-violet-500/[0.12] hover:-translate-y-0.5"
                : "border-border bg-zinc-900 hover:border-muted-foreground/25 hover:-translate-y-0.5"
            )}
          >
            <div className={compact ? "text-xl mb-0.5" : "text-2xl mb-1"}>
              {kit.icon}
            </div>
            <div
              className={cn(
                "font-bold",
                compact ? "text-xs" : "text-sm"
              )}
            >
              {kit.name}
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {isCustom ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                  Your choice
                </span>
              ) : (
                <>
                  {stepCount > 0 && (
                    <span className="rounded-full bg-violet-500/[0.12] px-[0.45rem] py-[0.15rem] text-[0.65rem] font-semibold text-violet-400">
                      {stepCount} step{stepCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {agentCount > 0 && (
                    <span className="rounded-full bg-emerald-500/[0.12] px-[0.45rem] py-[0.15rem] text-[0.65rem] font-semibold text-emerald-400">
                      {agentCount} role{agentCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
