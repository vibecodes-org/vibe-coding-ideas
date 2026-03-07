"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRIORITY_CONFIG, PRIORITY_OPTIONS } from "@/lib/priority";
import type { TaskPriority } from "@/types";

interface PrioritySelectProps {
  value: TaskPriority;
  onValueChange: (value: TaskPriority) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

export function PrioritySelect({ value, onValueChange, disabled, triggerClassName }: PrioritySelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as TaskPriority)} disabled={disabled}>
      <SelectTrigger className={triggerClassName ?? "h-8 w-36 text-xs"} data-testid="priority-select">
        <SelectValue>
          <span className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${PRIORITY_CONFIG[value].dotColor}`} />
            {PRIORITY_CONFIG[value].label}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PRIORITY_OPTIONS.map((p) => (
          <SelectItem key={p} value={p}>
            <span className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${PRIORITY_CONFIG[p].dotColor}`} />
              {PRIORITY_CONFIG[p].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
