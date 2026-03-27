"use client";

import { Sparkles, LayoutList, Bot, Workflow, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface BoardEmptyStateProps {
  canUseAi: boolean;
  hasByokKey: boolean;
  starterCredits: number;
  onAiGenerate: () => void;
  onDismiss: () => void;
  onImport?: () => void;
  isReadOnly: boolean;
}

export function BoardEmptyState({
  canUseAi,
  hasByokKey,
  starterCredits,
  onAiGenerate,
  onDismiss,
  onImport,
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
        {/* Dashed violet icon circle */}
        <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-dashed border-violet-500/25 bg-violet-500/[0.06]">
          <Sparkles className="h-7 w-7 text-violet-400" />
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
              size="lg"
              className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:brightness-110"
              onClick={onAiGenerate}
            >
              <Sparkles className="h-4 w-4" />
              AI Generate Tasks
            </Button>
            {!hasByokKey && starterCredits > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
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

        {/* Nudge tile cards */}
        <div className="mt-7 grid grid-cols-2 gap-3 max-w-sm mx-auto">
          <Link
            href="?tab=agents"
            className="group rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-4 text-left transition-all hover:border-emerald-500/35 hover:bg-emerald-500/[0.1]"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
              <Bot className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="mt-2.5 text-[13px] font-semibold text-emerald-400">Add AI Agents</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">Build your team to automate workflow steps</p>
            <ArrowRight className="mt-2 h-3.5 w-3.5 text-emerald-400/40 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400/70" />
          </Link>
          <Link
            href="?tab=workflows"
            className="group rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-4 text-left transition-all hover:border-amber-500/35 hover:bg-amber-500/[0.1]"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15">
              <Workflow className="h-4 w-4 text-amber-400" />
            </div>
            <p className="mt-2.5 text-[13px] font-semibold text-amber-400">Set Up Workflows</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">Define step-by-step processes for tasks</p>
            <ArrowRight className="mt-2 h-3.5 w-3.5 text-amber-400/40 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-400/70" />
          </Link>
        </div>

        <button
          type="button"
          className="mt-5 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
          onClick={onDismiss}
        >
          Show columns &amp; add tasks manually
        </button>
        {onImport && (
          <button
            type="button"
            className="mt-1.5 block text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
            onClick={onImport}
          >
            Or import tasks from another tool (CSV, JSON)
          </button>
        )}
      </div>
    </div>
  );
}
