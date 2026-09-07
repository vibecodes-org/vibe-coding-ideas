"use client";

import { cn } from "@/lib/utils";
import { REASONING_EFFORT_LEVELS, type ReasoningEffort } from "@/lib/codex-models";
import type { AgentKind } from "@/lib/platform-model-defaults";

const AGENT_LABELS: Record<AgentKind, string> = { claude: "Claude", codex: "Codex" };

/**
 * Reasoning-effort segmented control (Codex model-tier task FR-7 design,
 * docs/codex-model-tiers-ux-design.html §1: "three fixed values, all
 * visible, one tap each — no menu to open"). Shared by the Profile "Model
 * tier mapping" dialog and the admin "Platform" tab's agent-aware grid, so
 * the control and its accessibility contract never drift between the two
 * surfaces (both name the agent in the group label per the state matrix's
 * accessibility floor).
 *
 * `value` undefined = nothing pressed yet (the AC-3 in-progress state: a
 * model was chosen but no effort yet, or — on the admin surface, which has
 * no "unset" state — simply not reached here). `showDefaultPressed` renders
 * a given level pressed but greyed while `disabled` (the platform-default
 * fall-through state), so the reader always sees what will run.
 */
export function EffortSegmentedControl({
  agent,
  value,
  showDefaultPressed,
  disabled,
  onChange,
  describedById,
  invalid,
}: {
  agent: AgentKind;
  value: ReasoningEffort | undefined;
  showDefaultPressed?: ReasoningEffort;
  disabled: boolean;
  onChange: (effort: ReasoningEffort) => void;
  describedById?: string;
  invalid?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={`${AGENT_LABELS[agent]} reasoning effort`}
      aria-disabled={disabled || undefined}
      aria-describedby={describedById}
      className={cn(
        "flex overflow-hidden rounded-md border border-input",
        invalid && "border-rose-500 ring-2 ring-rose-500/30"
      )}
    >
      {REASONING_EFFORT_LEVELS.map((level) => {
        const pressed = disabled ? level === showDefaultPressed : level === value;
        return (
          <button
            key={level}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            onClick={() => onChange(level)}
            className={cn(
              "min-h-9 flex-1 border-r border-input px-2 text-xs font-medium capitalize transition-colors last:border-r-0 disabled:cursor-not-allowed disabled:opacity-60 [@media(pointer:coarse)]:min-h-11",
              pressed ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-accent"
            )}
          >
            {level}
          </button>
        );
      })}
    </div>
  );
}
