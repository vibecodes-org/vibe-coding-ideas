"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Bot, Plus, Loader2 } from "lucide-react";
import { NudgeBanner } from "@/components/shared/nudge-banner";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AgentProfileDialog } from "@/components/agents/agent-profile-dialog";
import { getRoleColor } from "@/lib/agent-colors";
import { allocateAllAgents, removeIdeaAgent } from "@/actions/idea-agents";
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
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [selectedBotIds, setSelectedBotIds] = useState<Set<string>>(new Set());

  // Bots the current user owns that are NOT already in the pool
  const allocatedBotIds = new Set(ideaAgents.map((a) => a.bot_id));
  const unallocatedBots = userBots.filter((b) => !allocatedBotIds.has(b.id));

  // Reset selection when popover closes
  useEffect(() => {
    if (!addOpen) setSelectedBotIds(new Set());
  }, [addOpen]);

  function toggleBotSelection(botId: string) {
    setSelectedBotIds((prev) => {
      const next = new Set(prev);
      if (next.has(botId)) next.delete(botId);
      else next.add(botId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedBotIds.size === unallocatedBots.length) {
      setSelectedBotIds(new Set());
    } else {
      setSelectedBotIds(new Set(unallocatedBots.map((b) => b.id)));
    }
  }

  const allSelected = unallocatedBots.length > 0 && selectedBotIds.size === unallocatedBots.length;

  function handleAllocateSelected() {
    if (selectedBotIds.size === 0) return;
    startTransition(async () => {
      try {
        const ids = Array.from(selectedBotIds);
        const result = await allocateAllAgents(ideaId, ids);
        toast.success(`Added ${result.added} agent${result.added !== 1 ? "s" : ""} to pool`);
        setAddOpen(false);
      } catch {
        toast.error("Failed to add agents");
      }
    });
  }

  function handleRemove(botId: string) {
    startTransition(async () => {
      try {
        await removeIdeaAgent(ideaId, botId);
        toast.success("Agent removed from team");
      } catch {
        toast.error("Failed to remove agent");
      }
    });
  }

  // Don't show anything to non-team members if pool is empty
  if (!isTeamMember && ideaAgents.length === 0) return null;

  // No bots at all — show full NudgeBanner (matches design doc mockup #3)
  if (ideaAgents.length === 0 && isTeamMember && unallocatedBots.length === 0) {
    return (
      <NudgeBanner
        icon={<span>💡</span>}
        title="Add AI agents to this idea"
        description={
          <>
            Agents can automatically work on your board tasks — reviewing designs, writing code, running tests.{" "}
            <Link href="/agents" className="font-medium text-emerald-400 hover:text-emerald-300">Create agents</Link>
            {" or "}
            <Link href="/agents?tab=community" className="font-medium text-emerald-400 hover:text-emerald-300">browse the community</Link>.
          </>
        }
        variant="default"
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">Agents</span>
      {/* Has bots but none allocated — compact inline hint with + Add button */}
      {ideaAgents.length === 0 && isTeamMember && unallocatedBots.length > 0 && (
        <>
          <span className="text-xs text-muted-foreground">
            Add agents so they can work on your board tasks
          </span>
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <button className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                + Add
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-2" align="start">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-medium text-muted-foreground">Your agents</p>
                {unallocatedBots.length > 1 && (
                  <button className="text-xs text-primary hover:underline" onClick={toggleSelectAll} type="button">
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
              <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
                {unallocatedBots.map((bot) => {
                  const colors = getRoleColor(bot.role);
                  const isChecked = selectedBotIds.has(bot.id);
                  return (
                    <button key={bot.id} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50" onClick={() => toggleBotSelection(bot.id)} disabled={pending} type="button">
                      <Checkbox checked={isChecked} tabIndex={-1} className="pointer-events-none" aria-hidden />
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={bot.avatar_url ?? undefined} />
                        <AvatarFallback className={`text-[10px] ${colors.avatarBg} ${colors.avatarText}`}>{bot.name?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col leading-tight text-left">
                        <span>{bot.name}</span>
                        {bot.role && <span className="text-[11px] text-muted-foreground">{bot.role}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 border-t pt-2">
                <Button size="sm" className="w-full gap-2" onClick={handleAllocateSelected} disabled={pending || selectedBotIds.size === 0}>
                  {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {selectedBotIds.size === 0 ? "Select agents" : `Add ${selectedBotIds.size} Agent${selectedBotIds.size !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
      {/* Avatar stack */}
      {ideaAgents.length > 0 && (
        <div className="flex items-center">
          {ideaAgents.map((agent, i) => {
            const colors = getRoleColor(agent.bot.role);
            return (
              <Tooltip key={agent.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setSelectedBotId(agent.bot_id)}
                    className={`cursor-pointer ${i > 0 ? "-ml-1.5" : ""}`}
                  >
                    <Avatar className="h-6 w-6 border-2 border-card">
                      <AvatarImage src={agent.bot.avatar_url ?? undefined} />
                      <AvatarFallback className={`text-[9px] ${colors.avatarBg} ${colors.avatarText}`}>
                        {agent.bot.name?.[0]?.toUpperCase() ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {agent.bot.name}{agent.bot.role ? ` · ${agent.bot.role}` : ""}
                  {(isAuthor || agent.added_by === currentUserId) && " (click to manage)"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
      {/* Add agent popover */}
      {isTeamMember && ideaAgents.length > 0 && unallocatedBots.length > 0 && (
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="h-5 w-5 rounded-full">
              <Plus className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-2" align="start">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-xs font-medium text-muted-foreground">Your agents</p>
              {unallocatedBots.length > 1 && (
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={toggleSelectAll}
                  type="button"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>
            <div className="space-y-0.5">
              {unallocatedBots.map((bot) => {
                const colors = getRoleColor(bot.role);
                const isChecked = selectedBotIds.has(bot.id);
                return (
                  <button
                    key={bot.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                    onClick={() => toggleBotSelection(bot.id)}
                    disabled={pending}
                    type="button"
                  >
                    <Checkbox
                      checked={isChecked}
                      tabIndex={-1}
                      className="pointer-events-none"
                      aria-hidden
                    />
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
            <div className="mt-2 border-t pt-2">
              <Button
                size="sm"
                className="w-full gap-2"
                onClick={handleAllocateSelected}
                disabled={pending || selectedBotIds.size === 0}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                {selectedBotIds.size === 0
                  ? "Select agents"
                  : `Add ${selectedBotIds.size} Agent${selectedBotIds.size !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
      <AgentProfileDialog
        botId={selectedBotId}
        open={selectedBotId !== null}
        onOpenChange={(open) => { if (!open) setSelectedBotId(null); }}
        onRemove={
          selectedBotId && (() => {
            const agent = ideaAgents.find((a) => a.bot_id === selectedBotId);
            return agent && (isAuthor || agent.added_by === currentUserId);
          })()
            ? handleRemove
            : undefined
        }
      />
    </div>
  );
}
