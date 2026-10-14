"use client";

import { cn } from "@/lib/utils";
import { EFFORT_LABELS } from "@/lib/terminal/claude-effort";
import { EFFORT_LEVELS_BY_AGENT, type AgentKind, type ReasoningEffort } from "@/lib/platform-model-defaults";

const AGENT_LABELS: Record<AgentKind, string> = { claude: "Claude", codex: "Codex" };


/**
 * Reasoning-effort segmented control (Codex model-tier task FR-7 design,
 * docs/codex-model-tiers-ux-design.html §1: "fixed values, all visible,
 * one tap each — no menu to open"). Shows the given agent's own ladder —
 * Claude low…max, Codex minimal…xhigh (Nick, 8 Oct 2026: all levels, not
 * the original 3-level placeholder). Shared by the Profile "Model
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
 *
 * `defaultOption` (task 18a37612, Claude "Starting effort" row) adds a leading
 * two-line "Default" segment that says what it falls back to (`subLabel`, e.g.
 * "site: High" or "Claude's own"; null hides the second line while that is
 * loading). It is pressed when `value` is null and calls `onSelect`.
 * With it present every segment uses tighter side padding so all six fit on a
 * 375px phone. Without it the control renders exactly as before.
 */
type EffortSegmentedControlProps = {
  agent: AgentKind;
  /** null (only meaningful with `defaultOption`) = the Default segment is chosen. */
  value: ReasoningEffort | null | undefined;
  showDefaultPressed?: ReasoningEffort;
  disabled: boolean;
  onChange: (effort: ReasoningEffort) => void;
  describedById?: string;
  invalid?: boolean;
  /** Overrides the group's accessible name (default "<Agent> reasoning effort"). */
  groupLabel?: string;
  /** Adds the leading Default segment; `onSelect` fires when it is clicked. */
  defaultOption?: { subLabel: string | null; ariaLabel?: string; onSelect: () => void };
};

export function EffortSegmentedControl({
  agent,
  value,
  showDefaultPressed,
  disabled,
  onChange,
  describedById,
  invalid,
  groupLabel,
  defaultOption,
}: EffortSegmentedControlProps) {
  const segmentPadding = defaultOption ? "px-0.5" : "px-1";
  return (
    <div
      role="group"
      aria-label={groupLabel ?? `${AGENT_LABELS[agent]} reasoning effort`}
      aria-disabled={disabled || undefined}
      aria-describedby={describedById}
      className={cn(
        "flex overflow-hidden rounded-md border border-input",
        invalid && "border-rose-500 ring-2 ring-rose-500/30"
      )}
    >
      {defaultOption && (
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!disabled && value === null}
          aria-label={defaultOption.ariaLabel}
          onClick={defaultOption.onSelect}
          className={cn(
            "flex min-h-9 min-w-0 flex-[1.5_1_0%] flex-col items-center justify-center whitespace-nowrap border-r border-input py-[3px] text-[11px] font-medium leading-[1.15] transition-colors disabled:cursor-not-allowed disabled:opacity-60 [@media(pointer:coarse)]:min-h-11",
            segmentPadding,
            !disabled && value === null ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-accent"
          )}
        >
          Default
          {defaultOption.subLabel && (
            <span
              className={cn(
                "text-[10px] font-normal",
                !disabled && value === null ? "text-background/75" : "text-muted-foreground"
              )}
            >
              {defaultOption.subLabel}
            </span>
          )}
        </button>
      )}
      {EFFORT_LEVELS_BY_AGENT[agent].map((level) => {
        const pressed = disabled ? level === showDefaultPressed : level === value;
        return (
          <button
            key={level}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            onClick={() => onChange(level)}
            className={cn(
              "min-h-9 min-w-0 flex-1 basis-0 whitespace-nowrap border-r border-input text-[11px] font-medium transition-colors last:border-r-0 disabled:cursor-not-allowed disabled:opacity-60 [@media(pointer:coarse)]:min-h-11",
              segmentPadding,
              pressed ? "bg-foreground text-background" : "bg-transparent text-foreground hover:bg-accent"
            )}
          >
            {EFFORT_LABELS[level]}
          </button>
        );
      })}
    </div>
  );
}
