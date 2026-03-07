import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PRIORITY_CONFIG } from "@/lib/priority";
import type { TaskPriority } from "@/types";

export function PriorityDot({ priority }: { priority: TaskPriority }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${config.dotColor}`} />
      </TooltipTrigger>
      <TooltipContent>{config.label} priority</TooltipContent>
    </Tooltip>
  );
}
