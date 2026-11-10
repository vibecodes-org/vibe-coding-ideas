"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { HelperAgents } from "@/lib/agent-tool-access";

interface HelperAgentsPickerProps {
  value: HelperAgents;
  onChange: (value: HelperAgents) => void;
  /** Prefix so two pickers on one page keep distinct ids. */
  idPrefix?: string;
}

const OPTIONS: { value: HelperAgents; title: string; description: string }[] = [
  {
    value: "allowed",
    title: "Can start helpers",
    description: "Can hand parts of the job to helper agents of its own. For planning and research.",
  },
  {
    value: "blocked",
    title: "Works alone",
    description: "Does the whole job itself and can't start helper agents. For building, reviewing and testing.",
  },
];

export function HelperAgentsPicker({ value, onChange, idPrefix = "helper-agents" }: HelperAgentsPickerProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" id={`${idPrefix}-label`}>
        Helper agents
      </Label>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v === "blocked" ? "blocked" : "allowed")}
        aria-labelledby={`${idPrefix}-label`}
        className="grid gap-2 sm:grid-cols-2"
      >
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            htmlFor={`${idPrefix}-${o.value}`}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
              value === o.value ? "border-violet-500 bg-violet-500/[0.08]" : "border-border hover:border-violet-500/30"
            )}
          >
            <RadioGroupItem id={`${idPrefix}-${o.value}`} value={o.value} className="mt-0.5" />
            <span>
              <span className="block text-[13px] font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{o.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="text-[10.5px] text-muted-foreground">
        In Claude Code this is enforced: the agent&apos;s helper-starting tool is switched off. Codex isn&apos;t
        affected.
      </p>
    </div>
  );
}
