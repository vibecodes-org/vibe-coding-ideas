"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, formatRelativeTime } from "@/lib/utils";
import { getUserRecentBoards, type RecentBoard } from "@/actions/board";

export function BoardSwitcher() {
  const [boards, setBoards] = useState<RecentBoard[]>([]);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    getUserRecentBoards().then((result) => {
      if (!cancelled) setBoards(result);
    });
    return () => { cancelled = true; };
  }, [pathname]); // refetch when navigating

  // Determine current board from URL (/ideas/{id}/*)
  const ideaIdMatch = pathname.match(/\/ideas\/([^/]+)/);
  const currentIdeaId = ideaIdMatch?.[1] ?? null;
  const currentBoard = boards.find((b) => b.ideaId === currentIdeaId);

  // Don't render if no boards
  if (boards.length === 0) return null;

  const displayName = currentBoard?.title ?? boards[0].title;
  const displayHref = currentBoard
    ? `/ideas/${currentBoard.ideaId}/board`
    : `/ideas/${boards[0].ideaId}/board`;

  return (
    <div className="hidden items-center md:flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-1.5 rounded-md border border-violet-500/20 bg-violet-500/8 px-2.5 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-violet-500/15"
          >
            <LayoutGrid className="h-3.5 w-3.5 text-violet-400" />
            <span className="max-w-[180px] truncate">{displayName}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-1.5" align="start">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recent Boards
          </p>
          <div className="max-h-[240px] space-y-0.5 overflow-y-auto">
            {boards.map((board) => {
              const isCurrent = board.ideaId === currentIdeaId;
              return (
                <Link
                  key={board.ideaId}
                  href={`/ideas/${board.ideaId}/board`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2 text-xs transition-colors",
                    isCurrent
                      ? "bg-violet-500/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      isCurrent ? "bg-violet-400" : "bg-muted-foreground/30"
                    )}
                  />
                  <span className="flex-1 truncate font-medium">{board.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {isCurrent ? "Current" : formatRelativeTime(board.lastActivity)}
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              All boards…
            </Link>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
