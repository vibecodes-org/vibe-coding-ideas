import type { TaskPriority } from "@/types";

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; dotColor: string }> = {
  urgent: { label: "Urgent", color: "text-red-400", dotColor: "bg-red-400" },
  high: { label: "High", color: "text-orange-400", dotColor: "bg-orange-400" },
  medium: { label: "Medium", color: "text-yellow-400", dotColor: "bg-yellow-400" },
  low: { label: "Low", color: "text-zinc-400", dotColor: "bg-zinc-400" },
};

export const PRIORITY_OPTIONS: TaskPriority[] = ["urgent", "high", "medium", "low"];
