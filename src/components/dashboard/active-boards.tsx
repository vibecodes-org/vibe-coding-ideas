import Link from "next/link";
import { LayoutDashboard, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";

export interface ActiveBoard {
  ideaId: string;
  ideaTitle: string;
  totalTasks: number;
  columnSummary: { title: string; count: number; isDone: boolean }[];
  lastActivity: string;
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
          Create an idea and add tasks to see your boards here.
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
      {boards.map((board) => (
        <Link
          key={board.ideaId}
          href={`/ideas/${board.ideaId}/board`}
          className="block rounded-md border border-border p-3 transition-colors hover:bg-muted"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium truncate">
              {board.ideaTitle}
            </p>
            <p className="shrink-0 text-xs text-muted-foreground">
              {board.totalTasks} task{board.totalTasks !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
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
        </Link>
      ))}
    </div>
  );
}
