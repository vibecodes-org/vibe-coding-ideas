import Link from "next/link";
import { LayoutDashboard, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { HealthStatus } from "@/lib/idea-health";

export interface ActiveBoard {
  ideaId: string;
  ideaTitle: string;
  totalTasks: number;
  columnSummary: { title: string; count: number; isDone: boolean }[];
  lastActivity: string;
  healthStatus?: HealthStatus;
  healthLabel?: string;
  agentCount?: number;
  workflowCount?: number;
}

interface ActiveBoardsProps {
  boards: ActiveBoard[];
}

export function ActiveBoards({ boards }: ActiveBoardsProps) {
  if (boards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <LayoutDashboard className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">No active boards</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create an idea and AI will generate a task board. Your agents can then work on tasks automatically.
        </p>
        <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2">
          <Link href="/ideas/new">
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Create an idea
            </Button>
          </Link>
          <Link href="/ideas">
            <Button variant="outline" size="sm">
              Browse the feed
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {boards.map((board) => {
        const dotColor =
          board.healthStatus === "complete" || board.healthStatus === "ready"
            ? "bg-emerald-500"
            : board.healthStatus === "partial"
              ? "bg-amber-400"
              : "bg-rose-400";
        const badgeColor =
          board.healthStatus === "complete" || board.healthStatus === "ready"
            ? "bg-emerald-500/10 text-emerald-500"
            : board.healthStatus === "partial"
              ? "bg-amber-400/10 text-amber-400"
              : "bg-rose-400/10 text-rose-400";

        return (
          <Link
            key={board.ideaId}
            href={`/ideas/${board.ideaId}/board`}
            className="flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted"
          >
            {/* Health dot */}
            {board.healthStatus && (
              <div
                className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dotColor)}
                title={board.healthLabel ?? ""}
              />
            )}

            {/* Idea info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium truncate">
                  {board.ideaTitle}
                </p>
                {/* Health badge */}
                {board.healthStatus && board.healthLabel && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      badgeColor
                    )}
                  >
                    {board.healthLabel}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {board.totalTasks} task{board.totalTasks !== 1 ? "s" : ""}
                {board.agentCount !== undefined && ` \u00B7 ${board.agentCount} agent${board.agentCount !== 1 ? "s" : ""}`}
                {board.workflowCount !== undefined && ` \u00B7 ${board.workflowCount} workflow${board.workflowCount !== 1 ? "s" : ""}`}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {board.columnSummary.map((col) => (
                  <Badge
                    key={col.title}
                    variant={col.isDone ? "default" : "outline"}
                    className="text-[10px] max-w-[150px] sm:max-w-none truncate"
                  >
                    {col.count} {col.title}
                  </Badge>
                ))}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {formatRelativeTime(board.lastActivity)}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
