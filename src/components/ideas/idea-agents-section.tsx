"use client";

import { useState, useTransition } from "react";
import { Bot, ChevronDown, Crown, Plus, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AgentProfileDialog } from "@/components/agents/agent-profile-dialog";
import { getRoleColor } from "@/lib/agent-colors";
import { allocateAgent, removeIdeaAgent, setOrchestrationAgent } from "@/actions/idea-agents";
import type { IdeaAgentWithDetails, BotProfile } from "@/types";

interface IdeaAgentsSectionProps {
  ideaId: string;
  ideaAgents: IdeaAgentWithDetails[];
  currentUserId: string;
  isAuthor: boolean;
  isTeamMember: boolean;
  userBots: BotProfile[];
  orchestratorBotId: string | null;
}

export function IdeaAgentsSection({
  ideaId,
  ideaAgents,
  currentUserId,
  isAuthor,
  isTeamMember,
  userBots,
  orchestratorBotId,
}: IdeaAgentsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [orchestratorAddOpen, setOrchestratorAddOpen] = useState(false);
  const [workerAddOpen, setWorkerAddOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  // Split allocated agents by type
  const orchestratorAgents = ideaAgents.filter((a) => a.bot.agent_type === "orchestrator");
  const workerAgents = ideaAgents.filter((a) => a.bot.agent_type !== "orchestrator");

  // Split unallocated user bots by type
  const allocatedBotIds = new Set(ideaAgents.map((a) => a.bot_id));
  const unallocatedOrchestrators = userBots.filter(
    (b) => !allocatedBotIds.has(b.id) && b.agent_type === "orchestrator"
  );
  const unallocatedWorkers = userBots.filter(
    (b) => !allocatedBotIds.has(b.id) && b.agent_type !== "orchestrator"
  );

  function handleAllocate(botId: string) {
    startTransition(async () => {
      try {
        await allocateAgent(ideaId, botId);
        toast.success("Agent added to pool");
        setOrchestratorAddOpen(false);
        setWorkerAddOpen(false);
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

  function handleSetDefault(botId: string) {
    startTransition(async () => {
      try {
        const newBotId = botId === orchestratorBotId ? null : botId;
        await setOrchestrationAgent(ideaId, newBotId);
        toast.success(
          newBotId ? "Default orchestrator set" : "Default orchestrator cleared"
        );
      } catch {
        toast.error("Failed to update default orchestrator");
      }
    });
  }

  // Don't show anything to non-team members if pool is empty
  if (!isTeamMember && ideaAgents.length === 0) return null;

  const totalAgents = ideaAgents.length;

  return (
    <>
      {/* Summary row — always visible */}
      <div className="border-t border-border">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-3 px-4 py-2.5 sm:px-5 text-sm transition-colors hover:bg-muted/50 cursor-pointer"
        >
          <div className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">Agents</span>
          </div>
          {totalAgents > 0 ? (
            <div className="flex items-center gap-1.5">
              {/* Stacked agent avatars */}
              <div className="flex items-center">
                {ideaAgents.slice(0, 6).map((agent, i) => {
                  const colors = getRoleColor(agent.bot.role);
                  return (
                    <Avatar key={agent.id} className={`h-5 w-5 border-2 border-card ${i > 0 ? "-ml-1.5" : ""}`}>
                      <AvatarImage src={agent.bot.avatar_url ?? undefined} />
                      <AvatarFallback className={`text-[8px] ${colors.avatarBg} ${colors.avatarText}`}>
                        {agent.bot.name?.[0]?.toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                  );
                })}
              </div>
              <span className="text-xs text-muted-foreground">{totalAgents}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Add an orchestrator and workers to automate your workflow</span>
          )}
          <ChevronDown className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>

        {/* Expanded management panel */}
        {expanded && (
          <div className="space-y-3 px-4 py-3 sm:px-5">
            {/* Orchestrator Pool */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Crown className="h-3.5 w-3.5 text-amber-500" />
                Orchestrator Pool ({orchestratorAgents.length})
                {isTeamMember && unallocatedOrchestrators.length > 0 && (
                  <AddAgentPopover
                    open={orchestratorAddOpen}
                    onOpenChange={setOrchestratorAddOpen}
                    bots={unallocatedOrchestrators}
                    onAllocate={handleAllocate}
                    pending={pending}
                    label="Add orchestrator"
                  />
                )}
              </h4>
              {orchestratorAgents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No orchestrators allocated.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {orchestratorAgents.map((agent) => {
                    const canRemove = isAuthor || agent.added_by === currentUserId;
                    const isDefault = agent.bot_id === orchestratorBotId;
                    const colors = getRoleColor(agent.bot.role);
                    return (
                      <div
                        key={agent.id}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-primary ${isDefault ? "border-amber-500/40" : "border-amber-500/20"}`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedBotId(agent.bot_id)}
                          className="flex items-center gap-1.5 cursor-pointer"
                        >
                          <div className="relative">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={agent.bot.avatar_url ?? undefined} />
                              <AvatarFallback className={`text-[10px] ${colors.avatarBg} ${colors.avatarText}`}>
                                {agent.bot.name?.[0]?.toUpperCase() ?? "?"}
                              </AvatarFallback>
                            </Avatar>
                            <Bot className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-primary" />
                          </div>
                          <div className="flex flex-col leading-tight text-left">
                            <span>{agent.bot.name}</span>
                            {agent.bot.role && (
                              <span className="text-[11px] text-muted-foreground">{agent.bot.role}</span>
                            )}
                          </div>
                        </button>
                        {isTeamMember && (
                          <button
                            onClick={() => handleSetDefault(agent.bot_id)}
                            disabled={pending}
                            title={isDefault ? "Remove as default" : "Set as default orchestrator"}
                            className={`ml-0.5 rounded-full p-0.5 transition-colors disabled:opacity-50 ${isDefault ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500/70"}`}
                          >
                            <Crown className="h-3 w-3" fill={isDefault ? "currentColor" : "none"} />
                          </button>
                        )}
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

            {/* Worker Pool */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Wrench className="h-3.5 w-3.5 text-blue-500" />
                Worker Pool ({workerAgents.length})
                {isTeamMember && unallocatedWorkers.length > 0 && (
                  <AddAgentPopover
                    open={workerAddOpen}
                    onOpenChange={setWorkerAddOpen}
                    bots={unallocatedWorkers}
                    onAllocate={handleAllocate}
                    pending={pending}
                    label="Add worker"
                  />
                )}
              </h4>
              {workerAgents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No worker agents allocated yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {workerAgents.map((agent) => {
                    const canRemove = isAuthor || agent.added_by === currentUserId;
                    const colors = getRoleColor(agent.bot.role);
                    return (
                      <div
                        key={agent.id}
                        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary"
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedBotId(agent.bot_id)}
                          className="flex items-center gap-1.5 cursor-pointer"
                        >
                          <div className="relative">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={agent.bot.avatar_url ?? undefined} />
                              <AvatarFallback className={`text-[10px] ${colors.avatarBg} ${colors.avatarText}`}>
                                {agent.bot.name?.[0]?.toUpperCase() ?? "?"}
                              </AvatarFallback>
                            </Avatar>
                            <Bot className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 text-primary" />
                          </div>
                          <div className="flex flex-col leading-tight text-left">
                            <span>{agent.bot.name}</span>
                            {agent.bot.role && (
                              <span className="text-[11px] text-muted-foreground">{agent.bot.role}</span>
                            )}
                          </div>
                        </button>
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
          </div>
        )}
      </div>

      <AgentProfileDialog
        botId={selectedBotId}
        open={selectedBotId !== null}
        onOpenChange={(open) => { if (!open) setSelectedBotId(null); }}
      />
    </>
  );
}

// --- Add agent popover ---

function AddAgentPopover({
  open,
  onOpenChange,
  bots,
  onAllocate,
  pending,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: BotProfile[];
  onAllocate: (botId: string) => void;
  pending: boolean;
  label: string;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="h-5 w-5 rounded-full">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
        <div className="space-y-1">
          {bots.map((bot) => {
            const colors = getRoleColor(bot.role);
            return (
              <button
                key={bot.id}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                onClick={() => onAllocate(bot.id)}
                disabled={pending}
              >
                <Avatar className="h-5 w-5">
                  <AvatarImage src={bot.avatar_url ?? undefined} />
                  <AvatarFallback className={`text-[10px] ${colors.avatarBg} ${colors.avatarText}`}>
                    {bot.name?.[0]?.toUpperCase() ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col leading-tight text-left">
                  <span>{bot.name}</span>
                  {bot.role && (
                    <span className="text-[11px] text-muted-foreground">{bot.role}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
