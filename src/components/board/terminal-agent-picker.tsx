"use client";

// Codex support (docs/codex-terminal-ux-design.html §1, implementation slice
// 2) — the two-option segmented control ("Claude Code" | "Codex") shown on
// every FRESH-session surface (chooser, Ready panel, per-task launch dialog).
// Never shown on Resume/Reconnect — those keep whatever agent the session
// already had (design §1c, §5). A native ARIA radiogroup so ←/→ switch and
// Tab lands on the selected option (design §9 keyboard rules).

import { AGENT_LABEL } from "@/lib/terminal/agent-copy";
import type { LaunchAgent } from "@/lib/terminal/agent-launch";
import { cn } from "@/lib/utils";

const AGENTS: LaunchAgent[] = ["claude", "codex"];

export interface TerminalAgentPickerProps {
  value: LaunchAgent;
  onChange: (agent: LaunchAgent) => void;
  /** Design §1a: "Run it with" (chooser/Ready panel) vs. "Start fresh with" (task dialog). */
  label: string;
  disabled?: boolean;
  className?: string;
}

export function TerminalAgentPicker({
  value,
  onChange,
  label,
  disabled = false,
  className,
}: TerminalAgentPickerProps) {
  return (
    <div className={cn("mt-2", className)}>
      <div className="mb-1 text-[11px] text-zinc-500">{label}</div>
      <div
        role="radiogroup"
        aria-label="Which agent runs this session"
        className="inline-flex overflow-hidden rounded-md border border-zinc-700 bg-[#111114]"
      >
        {AGENTS.map((agent, i) => {
          const selected = value === agent;
          return (
            <button
              key={agent}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(agent)}
              className={cn(
                "min-w-[104px] px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50",
                i > 0 && "border-l border-zinc-700",
                selected
                  ? "bg-sky-500/15 font-semibold text-zinc-100 shadow-[inset_0_-2px_0_0_theme(colors.sky.500)]"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
              )}
            >
              {selected && <span aria-hidden="true">✓ </span>}
              {AGENT_LABEL[agent]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
