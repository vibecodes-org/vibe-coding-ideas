"use client";

import { Sparkles, LayoutList } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BoardEmptyStateProps {
  canUseAi: boolean;
  hasByokKey: boolean;
  starterCredits: number;
  onAiGenerate: () => void;
  onDismiss: () => void;
  isReadOnly: boolean;
}

export function BoardEmptyState({
  canUseAi,
  hasByokKey,
  starterCredits,
  onAiGenerate,
  onDismiss,
  isReadOnly,
}: BoardEmptyStateProps) {
  if (isReadOnly) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center max-w-sm">
          <LayoutList className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            No tasks on this board yet. The project owner hasn&apos;t added tasks yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <h3 className="mt-5 text-lg font-semibold">
          Get started with AI
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Describe your idea and let AI generate a full task board for you
          &mdash; columns, tasks, and labels, all in one click.
        </p>
        {canUseAi ? (
          <div className="mt-6">
            <Button
              className="gap-2"
              onClick={onAiGenerate}
            >
              <Sparkles className="h-4 w-4" />
              AI Generate Tasks
            </Button>
            {!hasByokKey && starterCredits > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {starterCredits} free credit{starterCredits !== 1 ? "s" : ""} available
              </p>
            )}
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-xs text-muted-foreground">
              You&apos;ve used all 10 free AI credits. Add your API key in{" "}
              <a href="/profile" className="text-primary hover:underline">
                profile settings
              </a>{" "}
              for unlimited use.
            </p>
          </div>
        )}
        <button
          type="button"
          className="mt-4 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
          onClick={onDismiss}
        >
          Show columns &amp; add tasks manually
        </button>
      </div>
    </div>
  );
}
