"use client";

import { useState, useTransition } from "react";
import { Bot, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { allocateAgent, removeIdeaAgent } from "@/actions/idea-agents";
import type { IdeaAgentWithDetails, BotProfile } from "@/types";

interface IdeaAgentsSectionProps {
  ideaId: string;
  ideaAgents: IdeaAgentWithDetails[];
  currentUserId: string;
  isAuthor: boolean;
  isTeamMember: boolean;
  userBots: BotProfile[];
}

export function IdeaAgentsSection({
  ideaId,
  ideaAgents,
  currentUserId,
  isAuthor,
  isTeamMember,
  userBots,
}: IdeaAgentsSectionProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Bots the current user owns that are NOT already in the pool
  const allocatedBotIds = new Set(ideaAgents.map((a) => a.bot_id));
  const unallocatedBots = userBots.filter((b) => !allocatedBotIds.has(b.id));

  function handleAllocate(botId: string) {
    startTransition(async () => {
      try {
        await allocateAgent(ideaId, botId);
        toast.success("Agent added to pool");
        setAddOpen(false);
      } catch {
        toast.error("Failed to add agent");
      }
    });
  }

  function handleRemove(botId: string) {
    startTransition(async () => {
      try {
        await removeIdeaAgent(ideaId, botId);
        toast.success("Agent removed from pool");
      } catch {
        toast.error("Failed to remove agent");
      }
    });
  }

  // Don't show anything to non-team members if pool is empty
  if (!isTeamMember && ideaAgents.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Bot className="h-4 w-4" />
        Agent Pool ({ideaAgents.length})
        {isTeamMember && unallocatedBots.length > 0 && (
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="h-5 w-5 rounded-full">
                <Plus className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Add your agent</p>
              <div className="space-y-1">
                {unallocatedBots.map((bot) => (
                  <button
                    key={bot.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                    onClick={() => handleAllocate(bot.id)}
                    disabled={pending}
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={bot.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">
                        <Bot className="h-3 w-3" />
                      </AvatarFallback>
                    </Avatar>
                    {bot.name}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </h3>
      {ideaAgents.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No agents allocated yet. Team members can add their agents to the shared pool.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {ideaAgents.map((agent) => {
            const canRemove = isAuthor || agent.added_by === currentUserId;
            return (
              <div
                key={agent.id}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm transition-colors hover:border-primary"
              >
                <div className="relative">
                  <Avatar className="h-5 w-5">
                    <AvatarImage src={agent.bot.avatar_url ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      <Bot className="h-3 w-3" />
                    </AvatarFallback>
                  </Avatar>
                  <Bot className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-primary" />
                </div>
                <span>{agent.bot.name}</span>
                <span className="text-xs text-muted-foreground">({agent.bot.owner?.full_name ?? "Unknown"})</span>
                {canRemove && (
                  <button
                    onClick={() => handleRemove(agent.bot_id)}
                    disabled={pending}
                    className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
