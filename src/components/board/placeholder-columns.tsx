"use client";

import { CircleCheckBig } from "lucide-react";
import { DEFAULT_BOARD_COLUMNS } from "@/lib/board-defaults";

/**
 * Read-only placeholder columns shown when a board has no columns yet.
 * Visually identical to real BoardColumn shells but without any interactivity
 * (no drag, no Add Task, no menu) — purely for spatial orientation.
 */
export function PlaceholderColumns() {
  return (
    <div
      className="flex h-full items-start gap-4 overflow-x-auto pb-4"
      data-testid="placeholder-columns"
      aria-hidden
    >
      {DEFAULT_BOARD_COLUMNS.map((col) => (
        <div
          key={col.title}
          className="flex max-h-full min-w-[280px] max-w-[320px] shrink-0 flex-col rounded-lg border border-border bg-muted/50"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="flex items-center gap-1 text-sm font-semibold">
              {col.title}
              {col.is_done_column && (
                <CircleCheckBig className="h-3.5 w-3.5 text-emerald-500" />
              )}
              <span className="text-muted-foreground">(0)</span>
            </h3>
          </div>
          <div className="min-h-[60px] flex-1 p-2">
            <div className="flex items-center justify-center rounded-md border border-dashed border-border py-8 text-center">
              <p className="text-xs text-muted-foreground">Tasks will appear here</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
