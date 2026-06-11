"use client";

import { useRef, useCallback } from "react";
import { Globe, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type Visibility = "public" | "private";

interface VisibilityOption {
  value: Visibility;
  label: string;
  description: string;
  icon: typeof Globe;
}

const OPTIONS: VisibilityOption[] = [
  {
    value: "public",
    label: "Public",
    description: "Discoverable in the community feed. Anyone can find & star it.",
    icon: Globe,
  },
  {
    value: "private",
    label: "Private",
    description: "Only you and invited collaborators can see this project.",
    icon: Lock,
  },
];

interface VisibilitySelectorProps {
  value: Visibility;
  onChange: (value: Visibility) => void;
  /** Optional id prefix for the radiogroup label association. */
  idPrefix?: string;
  className?: string;
}

/**
 * Shared segmented Public/Private control used by both the New Idea form and the
 * onboarding project step. Renders an accessible radiogroup (icon + one-line
 * description per option, no colour-only meaning), defaults to Public, and
 * supports full keyboard navigation (arrows + Space/Enter).
 */
export function VisibilitySelector({
  value,
  onChange,
  idPrefix = "visibility",
  className,
}: VisibilitySelectorProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)
      )
        return;
      e.preventDefault();
      const currentIndex = OPTIONS.findIndex((o) => o.value === value);
      let next = currentIndex;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (currentIndex + 1) % OPTIONS.length;
      } else {
        next = (currentIndex - 1 + OPTIONS.length) % OPTIONS.length;
      }
      const nextValue = OPTIONS[next].value;
      onChange(nextValue);
      groupRef.current
        ?.querySelector<HTMLButtonElement>(`#${idPrefix}-${nextValue}`)
        ?.focus();
    },
    [value, onChange, idPrefix]
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Visibility"
      className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", className)}
      onKeyDown={handleKeyDown}
    >
      {OPTIONS.map((option) => {
        const isSelected = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isSelected
                ? "border-violet-500 bg-violet-500/[0.08]"
                : "border-border bg-card/50 hover:border-muted-foreground/40"
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                isSelected
                  ? "bg-violet-500/[0.18] text-violet-300"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-foreground">
                {option.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                {option.description}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                isSelected ? "border-violet-400" : "border-border"
              )}
            >
              {isSelected && (
                <span className="h-[7px] w-[7px] rounded-full bg-violet-400" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
