"use client";

import { useState, useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleTools({
  title,
  toolCount,
  children,
}: {
  title: string;
  toolCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="flex-1">{title}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {toolCount} tools
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={title}
        hidden={!open}
        className="border-t border-border px-4 pt-3 pb-3"
      >
        {children}
      </div>
    </div>
  );
}
