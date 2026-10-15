"use client";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ToolAccess } from "@/lib/agent-tool-access";

interface ToolAccessPickerProps {
  value: ToolAccess;
  onChange: (value: ToolAccess) => void;
  /** Prefix so two pickers on one page keep distinct ids. */
  idPrefix?: string;
}

const OPTIONS: { value: ToolAccess; title: string; description: string }[] = [
  { value: "full", title: "Full access", description: "Can read and change code and files." },
  {
    value: "read_only",
    title: "Read-only",
    description: "Can read code and run checks, but can't create or edit files. For reviewers and checkers.",
  },
];

export function ToolAccessPicker({ value, onChange, idPrefix = "tool-access" }: ToolAccessPickerProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" id={`${idPrefix}-label`}>
        What it can do
      </Label>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v === "read_only" ? "read_only" : "full")}
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
        In the browser terminal this is enforced: the agent&apos;s file-editing tools are switched off. In other
        Claude Code sessions the agent is told.
      </p>
    </div>
  );
}
