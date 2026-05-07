"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { RecentBoard } from "@/actions/board";

export interface BoardPickerProps {
  boards: RecentBoard[];
  currentIdeaId: string | null;
  onSelect: () => void;
}

export function BoardPicker({ boards, currentIdeaId, onSelect }: BoardPickerProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      trimmed
        ? boards.filter((b) => b.title.toLowerCase().includes(trimmed))
        : boards,
    [boards, trimmed]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clamp on render — activeIndex may exceed the (newly filtered) list length,
  // but we never trust it directly; this keeps it in bounds without a setState
  // in useEffect (which would cause cascading renders).
  const clampedActive = Math.min(activeIndex, Math.max(0, filtered.length - 1));

  function navigate(ideaId: string) {
    router.push(`/ideas/${ideaId}/board`);
    onSelect();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(filtered.length - 1, clampedActive + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(0, clampedActive - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const board = filtered[clampedActive];
      if (board) navigate(board.ideaId);
    }
  }

  if (boards.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <LayoutGrid className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">No boards yet</p>
        <p className="mt-1 text-xs text-muted-foreground">Create one to get started.</p>
        <Link
          href="/dashboard"
          onClick={onSelect}
          className="mt-4 inline-block rounded-md border border-violet-500/25 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-400 transition-colors hover:bg-violet-500/20"
        >
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="p-1.5">
      <div className="relative px-1 pb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find a board…"
          className="h-8 pl-7 text-xs"
          aria-label="Find a board"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          No boards match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <>
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {trimmed ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}` : "Recent"}
          </p>
          <div className="max-h-[240px] space-y-0.5 overflow-y-auto">
            {filtered.map((board, i) => {
              const isCurrent = board.ideaId === currentIdeaId;
              const isActive = i === clampedActive;
              return (
                <button
                  type="button"
                  key={board.ideaId}
                  onClick={() => navigate(board.ideaId)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-xs transition-colors text-left",
                    isCurrent && "bg-violet-500/10 text-foreground",
                    !isCurrent && isActive && "bg-muted text-foreground",
                    !isCurrent && !isActive && "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      isCurrent ? "bg-violet-400" : "bg-muted-foreground/30"
                    )}
                  />
                  <span className="flex-1 truncate font-medium">
                    {trimmed ? <HighlightMatch text={board.title} query={trimmed} /> : board.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {isCurrent ? "Current" : formatRelativeTime(board.lastActivity)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-1 border-t border-border pt-1">
        <Link
          href="/dashboard"
          onClick={onSelect}
          className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          All boards…
        </Link>
      </div>
    </div>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-violet-500/25 text-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
