"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Sparkles, LayoutDashboard, Users, Check, Info, ArrowRight } from "lucide-react";
import type { BotProfile } from "@/types";

const EnhanceIdeaDialog = dynamic(
  () => import("./enhance-idea-dialog").then((m) => m.EnhanceIdeaDialog),
  { ssr: false }
);

interface IdeaActionCardsProps {
  ideaId: string;
  ideaTitle: string;
  currentDescription: string;
  isAuthor: boolean;
  taskCount: number;
  agentCount: number;
  hasDescription: boolean;
  userCanUseAi: boolean;
  hasByokKey: boolean;
  starterCredits: number;
  bots: BotProfile[];
}

export function IdeaActionCards({
  ideaId,
  ideaTitle,
  currentDescription,
  isAuthor,
  taskCount,
  agentCount,
  hasDescription,
  userCanUseAi,
  hasByokKey,
  starterCredits,
  bots,
}: IdeaActionCardsProps) {
  const router = useRouter();
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(starterCredits);

  const handleCreditUsed = useCallback(() => {
    setCreditsRemaining((prev) => Math.max(0, prev - 1));
  }, []);

  const handleEnhanceClose = useCallback(
    (value: boolean) => {
      setEnhanceOpen(value);
      if (!value) {
        router.refresh();
      }
    },
    [router]
  );

  const disabled = !userCanUseAi;
  const hasBoard = taskCount > 0;

  // ── Board exists ──────────────────────────────────
  if (hasBoard) {
    return (
      <div className={`mt-4 grid gap-3 ${isAuthor ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
        {isAuthor && (
          <button
            onClick={() => !disabled && setEnhanceOpen(true)}
            className={`rounded-xl border border-zinc-800 bg-card p-5 text-left transition-all group hover:border-violet-500/30 hover:bg-violet-500/[0.04] ${disabled ? "pointer-events-none opacity-50" : ""}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 group-hover:bg-violet-500/10 group-hover:border-violet-500/20 transition-colors">
                <Sparkles className="h-5 w-5 text-zinc-400 group-hover:text-violet-400 transition-colors" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground group-hover:text-violet-300 transition-colors">Enhance with AI</p>
                <p className="text-[11px] text-muted-foreground">Re-enhance your description</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground group-hover:text-violet-400 font-medium transition-colors">
              <span>Re-enhance</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </button>
        )}

        <Link
          href={`/ideas/${ideaId}/board`}
          className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] p-5 text-left transition-all group hover:border-violet-500/40 hover:bg-violet-500/[0.06]"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20 transition-colors">
              <LayoutDashboard className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground group-hover:text-violet-300 transition-colors">Board</p>
              <p className="text-[11px] text-muted-foreground">{taskCount} task{taskCount !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-violet-400 font-medium">
            <span>Open board</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </Link>

        {isAuthor && (
          <EnhanceIdeaDialog
            open={enhanceOpen}
            onOpenChange={handleEnhanceClose}
            ideaId={ideaId}
            ideaTitle={ideaTitle}
            currentDescription={currentDescription}
            bots={bots}
            onCreditUsed={handleCreditUsed}
          />
        )}
      </div>
    );
  }

  // ── No board yet ──────────────────────────────────
  return (
    <div className="mt-4 space-y-3">
      <div className={`grid gap-3 ${isAuthor ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
        {isAuthor && (
          <button
            onClick={() => !disabled && setEnhanceOpen(true)}
            className={`rounded-xl border bg-card p-5 text-left transition-all group hover:border-violet-500/40 hover:bg-violet-500/[0.04] ${
              !hasDescription
                ? "animate-pulse-glow border-violet-500/30"
                : "border-zinc-800"
            } ${disabled ? "pointer-events-none opacity-50" : ""}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 border border-violet-500/20 group-hover:bg-violet-500/15 transition-colors">
                <Sparkles className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground group-hover:text-violet-300 transition-colors">Enhance with AI</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasDescription ? "Re-enhance your description" : "Refine your description for better AI results"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {hasDescription ? (
                <span className="flex items-center gap-1 text-emerald-400/70">
                  <Check className="h-3 w-3" />
                  Enhanced
                </span>
              ) : (
                <>
                  {!hasByokKey && creditsRemaining > 0 && (
                    <span className="text-violet-400">{creditsRemaining} free credit{creditsRemaining !== 1 ? "s" : ""}</span>
                  )}
                  {(hasByokKey || creditsRemaining === 0) && (
                    <span className="text-violet-400">Enhance</span>
                  )}
                  <ArrowRight className="h-3 w-3 text-violet-400" />
                </>
              )}
            </div>
          </button>
        )}

        <Link
          href={`/ideas/${ideaId}/board`}
          className="rounded-xl border border-zinc-800 bg-card p-5 text-left transition-all group hover:border-violet-500/30 hover:bg-violet-500/[0.04]"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 group-hover:bg-violet-500/10 group-hover:border-violet-500/20 transition-colors">
              <LayoutDashboard className="h-5 w-5 text-zinc-400 group-hover:text-violet-400 transition-colors" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground group-hover:text-violet-300 transition-colors">Generate Board</p>
              <p className="text-[11px] text-muted-foreground">Create a kanban board from your idea</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground group-hover:text-violet-400 font-medium transition-colors">
            <span>Create tasks</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </Link>
      </div>

      {/* Contextual tip + agent link */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] text-muted-foreground">
          {!hasDescription ? (
            <>
              <Info className="inline h-3 w-3 mr-1 text-amber-400/70 align-[-2px]" />
              Tip: A detailed description and AI agents improve board quality
            </>
          ) : agentCount === 0 ? (
            <>
              <Check className="inline h-3 w-3 mr-1 text-emerald-400/70 align-[-2px]" />
              Good description — add agents for even better results
            </>
          ) : (
            <>
              <Check className="inline h-3 w-3 mr-1 text-emerald-400/70 align-[-2px]" />
              Description and agents ready — your board will be high quality
            </>
          )}
        </p>
        <a
          href="#agents-section"
          className="text-[11px] text-violet-400/70 hover:text-violet-400 font-medium transition-colors flex items-center gap-1 shrink-0 ml-3"
        >
          <Users className="h-3 w-3" />
          {agentCount > 0 ? `${agentCount} agent${agentCount !== 1 ? "s" : ""}` : "Add AI agents"}
        </a>
      </div>

      {isAuthor && (
        <EnhanceIdeaDialog
          open={enhanceOpen}
          onOpenChange={handleEnhanceClose}
          ideaId={ideaId}
          ideaTitle={ideaTitle}
          currentDescription={currentDescription}
          bots={bots}
          onCreditUsed={handleCreditUsed}
        />
      )}
    </div>
  );
}
