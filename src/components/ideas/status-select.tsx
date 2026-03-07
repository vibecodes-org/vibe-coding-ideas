"use client";

import { useState, useOptimistic, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { STATUS_CONFIG } from "@/lib/constants";
import { updateIdeaStatus } from "@/actions/ideas";
import { toast } from "sonner";
import type { IdeaStatus } from "@/types";

interface StatusSelectProps {
  ideaId: string;
  currentStatus: IdeaStatus;
}

export function StatusSelect({ ideaId, currentStatus }: StatusSelectProps) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    currentStatus,
    (_: IdeaStatus, next: IdeaStatus) => next
  );

  const config = STATUS_CONFIG[optimisticStatus];

  const handleSelect = (value: IdeaStatus) => {
    setOpen(false);
    if (value === optimisticStatus) return;
    startTransition(async () => {
      setOptimisticStatus(value);
      try {
        await updateIdeaStatus(ideaId, value);
      } catch {
        toast.error("Failed to update status");
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 text-sm font-medium hover:opacity-80 transition-opacity cursor-pointer"
          data-testid="status-select"
        >
          <span className={config.color}>{config.label}</span>
          <ChevronDown className={`h-3.5 w-3.5 ${config.color}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[140px] p-1" align="start">
        {(Object.entries(STATUS_CONFIG) as [IdeaStatus, typeof STATUS_CONFIG[IdeaStatus]][]).map(
          ([value, cfg]) => (
            <button
              key={value}
              onClick={() => handleSelect(value as IdeaStatus)}
              className={`flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors ${value === optimisticStatus ? "bg-accent" : ""}`}
            >
              <span className={cfg.color}>{cfg.label}</span>
            </button>
          )
        )}
      </PopoverContent>
    </Popover>
  );
}
