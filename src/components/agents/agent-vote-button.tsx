"use client";

import { useOptimistic, useTransition } from "react";
import { toggleAgentVote } from "@/actions/bots";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface AgentVoteButtonProps {
  botId: string;
  upvotes: number;
  hasVoted: boolean;
}

export function AgentVoteButton({
  botId,
  upvotes,
  hasVoted,
}: AgentVoteButtonProps) {
  const [, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useOptimistic(
    { upvotes, hasVoted },
    (state) => ({
      upvotes: state.hasVoted ? state.upvotes - 1 : state.upvotes + 1,
      hasVoted: !state.hasVoted,
    })
  );

  const handleVote = () => {
    startTransition(async () => {
      setOptimisticState(optimisticState);
      try {
        await toggleAgentVote(botId);
      } catch {
        toast.error("Failed to vote");
      }
    });
  };

  return (
    <button
      onClick={handleVote}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
        optimisticState.hasVoted
          ? "border-violet-500/30 bg-violet-500/15 text-violet-400"
          : "border-border text-muted-foreground hover:border-violet-500/30 hover:bg-violet-500/15 hover:text-violet-400"
      )}
    >
      <span className="text-xs">&#x25B2;</span>
      <span className="font-semibold">{optimisticState.upvotes}</span>
    </button>
  );
}
