"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { getUserRecentBoards, type RecentBoard } from "@/actions/board";
import { useUser } from "@/hooks/use-user";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { BoardPicker } from "./board-picker";

export function BoardSwitcher() {
  const [boards, setBoards] = useState<RecentBoard[]>([]);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { user } = useUser();

  const ideaIdMatch = pathname.match(/\/ideas\/([^/]+)/);
  const currentIdeaId = ideaIdMatch?.[1] ?? null;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getUserRecentBoards().then((result) => {
      if (!cancelled) setBoards(result);
    });
    return () => { cancelled = true; };
  }, [pathname, user]);

  const currentBoard = boards.find((b) => b.ideaId === currentIdeaId);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  useKeyboardShortcut("mod+b", toggle);

  if (!user) return null;

  // First word of full_name, falling back to the email prefix.
  const fullName = (user.user_metadata?.full_name as string | undefined) ?? "";
  const firstName = fullName.trim().split(/\s+/)[0] || user.email?.split("@")[0] || "User";
  const initial = (firstName[0] ?? "U").toUpperCase();

  return (
    <div className="hidden items-center md:flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="inline-flex items-center overflow-hidden rounded-md border border-border bg-muted/30 text-sm">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
              aria-label={`Go to dashboard (${firstName})`}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-violet-500 to-blue-500 text-[10px] font-bold text-white">
                {initial}
              </span>
              <span className="hidden lg:inline">{firstName}</span>
            </Link>
            {currentBoard && (
              <>
                <span aria-hidden="true" className="select-none text-muted-foreground/40">
                  /
                </span>
                <button
                  type="button"
                  onClick={toggle}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label="Switch board"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 font-semibold text-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                >
                  <span className="max-w-[160px] truncate">{currentBoard.title}</span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-[300px] p-0"
          align="start"
          onOpenAutoFocus={(e) => {
            // Let BoardPicker manage its own focus (search input)
            e.preventDefault();
          }}
        >
          {/* Remount BoardPicker on every open so query/activeIndex reset cleanly */}
          {open && (
            <BoardPicker
              boards={boards}
              currentIdeaId={currentIdeaId}
              onSelect={() => setOpen(false)}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
