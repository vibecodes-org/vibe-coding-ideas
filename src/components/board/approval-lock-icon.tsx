"use client";

import { Lock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ApprovalLockIconProps {
  /** Icon size class — defaults to "h-3.5 w-3.5" */
  className?: string;
}

/**
 * Lock icon with tooltip indicating the step requires human approval.
 * Used across workflow step displays (templates, task workflows, dialogs).
 */
export function ApprovalLockIcon({ className }: ApprovalLockIconProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex shrink-0 cursor-help">
            <Lock
              className={cn("h-3.5 w-3.5 shrink-0 text-amber-400", className)}
              aria-label="Requires human approval"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          Requires human approval
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
