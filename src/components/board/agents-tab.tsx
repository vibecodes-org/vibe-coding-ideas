"use client";

import { useState, useEffect, useTransition } from "react";
import { HelpLink } from "@/components/shared/help-link";
import Link from "next/link";
import {
  Bot,
  Plus,
  ExternalLink,
  Trash2,
  Check,
  Loader2,
  Users,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getRoleColor } from "@/lib/agent-colors";
import { allocateAllAgents, removeIdeaAgent, getRoleCoverage, setManualRoleMatch, clearManualRoleMatch, type RoleCoverageResult } from "@/actions/idea-agents";
import { AgentAnimation } from "@/components/agents/agent-animation";
import { createClient } from "@/lib/supabase/client";
import type { IdeaAgentWithDetails, BotProfile } from "@/types";

interface AgentsTabProps {
  ideaId: string;
  ideaAgentDetails: IdeaAgentWithDetails[];
  userBotProfiles: BotProfile[];
  currentUserId: string;
  isAuthor: boolean;
  isTeamMember: boolean;
  isReadOnly: boolean;
}

interface AgentStats {
  tasksAssigned: number;
  pendingSteps: number;
  completedSteps: number;
}

type RoleCoverage = RoleCoverageResult;

export function AgentsTab({
  ideaId,
  ideaAgentDetails,
  userBotProfiles,
  currentUserId,
  isAuthor,
  isTeamMember,
  isReadOnly,
}: AgentsTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [agentStats, setAgentStats] = useState<Record<string, AgentStats>>({});
  const [roleCoverage, setRoleCoverage] = useState<RoleCoverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBotIds, setSelectedBotIds] = useState<Set<string>>(new Set());
  const [openRolePopover, setOpenRolePopover] = useState<string | null>(null);

  // Bots the current user owns that are NOT already in the pool
  const allocatedBotIds = new Set(ideaAgentDetails.map((a) => a.bot_id));
  const unallocatedBots = userBotProfiles.filter(
    (b) => !allocatedBotIds.has(b.id)
  );

  // Reset selection when popover closes or unallocated list changes
  useEffect(() => {
    if (!addOpen) setSelectedBotIds(new Set());
  }, [addOpen]);

  // Fetch task counts, step counts, and template roles client-side
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      const supabase = createClient();

      const [taskResult, stepResult, templateResult] = await Promise.all([
        supabase
          .from("board_tasks")
          .select("assignee_id")
          .eq("idea_id", ideaId)
          .not("assignee_id", "is", null),
        supabase
          .from("task_workflow_steps")
          .select("bot_id, status")
          .eq("idea_id", ideaId)
          .not("bot_id", "is", null),
        supabase
          .from("workflow_templates")
          .select("id, steps")
          .eq("idea_id", ideaId),
      ]);

      if (cancelled) return;

      // Build agent stats
      const stats: Record<string, AgentStats> = {};

      // Count tasks per assignee
      for (const row of taskResult.data ?? []) {
        const id = row.assignee_id as string;
        if (!stats[id])
          stats[id] = { tasksAssigned: 0, pendingSteps: 0, completedSteps: 0 };
        stats[id].tasksAssigned++;
      }

      // Count steps per bot_id
      for (const row of stepResult.data ?? []) {
        const id = row.bot_id as string;
        if (!stats[id])
          stats[id] = { tasksAssigned: 0, pendingSteps: 0, completedSteps: 0 };
        if (row.status === "pending" || row.status === "in_progress") {
          stats[id].pendingSteps++;
        } else if (row.status === "completed") {
          stats[id].completedSteps++;
        }
      }

      setAgentStats(stats);

      // Build role coverage using AI-powered matching (same algorithm as workflow steps)
      const agentPool = ideaAgentDetails
        .filter((a) => a.bot?.role)
        .map((a) => ({ botId: a.bot_id, name: a.bot?.name ?? "Unknown", role: a.bot.role! }));

      try {
        const coverage = await getRoleCoverage(ideaId, agentPool);
        if (!cancelled) setRoleCoverage(coverage);
      } catch {
        // Silently fall through — coverage panel just won't show
      }

      setLoading(false);
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [ideaId, ideaAgentDetails]);

  function handleAllocateAll() {
    startTransition(async () => {
      try {
        const result = await allocateAllAgents(ideaId);
        toast.success(`Added ${result.added} agent${result.added !== 1 ? "s" : ""} to pool`);
      } catch {
        toast.error("Failed to add agents");
      }
    });
  }

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

  function toggleBotSelection(botId: string) {
    setSelectedBotIds((prev) => {
      const next = new Set(prev);
      if (next.has(botId)) {
        next.delete(botId);
      } else {
        next.add(botId);
      }
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

  // Shared popover content for multi-select
  function renderAddAgentPopover(align: "center" | "end" = "end") {
    return (
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Agent
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-2" align={align}>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-medium text-muted-foreground">
              Your agents
            </p>
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
          <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
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
                    <AvatarFallback
                      className={`text-[10px] ${colors.avatarBg} ${colors.avatarText}`}
                    >
                      {bot.name?.[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col text-left leading-tight">
                    <span>{bot.name}</span>
                    {bot.role && (
                      <span className="text-[11px] text-muted-foreground">
                        {bot.role}
                      </span>
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
    );
  }

  // Empty state
  if (ideaAgentDetails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-16 text-center">
        <AgentAnimation />
        <div>
          <h3 className="text-lg font-semibold">Build your AI team</h3>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
            Add agents to this idea to automate workflow steps. Agents are like
            AI team members — they pick up tasks, follow workflows, and ship work.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {isTeamMember && unallocatedBots.length >= 2 && (
            <Button
              size="lg"
              className="gap-2"
              onClick={handleAllocateAll}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Users className="h-4 w-4" />
              )}
              Add All My Agents ({unallocatedBots.length})
            </Button>
          )}
          {isTeamMember && unallocatedBots.length > 0 && (
            renderAddAgentPopover("center")
          )}
          <Link href="/agents">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Browse Agents
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-y-auto pb-4">
      {/* Header with Add Agent button */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold">Your AI Team <HelpLink href="/guide/ai-agent-teams" tooltip="How agents work" /></h2>
        {isTeamMember && !isReadOnly && unallocatedBots.length > 0 && (
          <div className="flex gap-2">
            {unallocatedBots.length >= 2 && (
              <Button
                size="sm"
                className="gap-2"
                onClick={handleAllocateAll}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Users className="h-3.5 w-3.5" />
                )}
                Add All ({unallocatedBots.length})
              </Button>
            )}
            {renderAddAgentPopover("end")}
          </div>
        )}
      </div>

      {/* Workflow Roles Panel */}
      {roleCoverage.length > 0 && (() => {
        const coveredCount = roleCoverage.filter((rc) => rc.covered).length;
        const totalCount = roleCoverage.length;

        // Tier dot colour helper
        const tierDotColor = (tier: string | null, covered: boolean) => {
          if (!covered) return "bg-red-400";
          switch (tier) {
            case "manual": return "bg-blue-400";
            case "ai": return "bg-violet-400";
            case "exact": return "bg-emerald-400";
            default: return "bg-amber-400"; // substring, word-overlap
          }
        };

        return (
          <div className="rounded-lg border bg-card p-4">
            {/* Header */}
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold text-foreground">Workflow Roles</h3>
                <p className="text-[11px] text-muted-foreground">Which of your agents handle each workflow role</p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {coveredCount} / {totalCount}
              </span>
            </div>

            {/* Legend */}
            <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 border-b border-border pb-2.5">
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> Matched
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-400" /> AI matched
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" /> Manual
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" /> Unmatched
              </span>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
              {roleCoverage.map((rc) => {
                const dotColor = tierDotColor(rc.matchTier, rc.covered);

                // Find the agent details for avatar rendering
                const matchedAgent = rc.covered && rc.matchedAgentName
                  ? ideaAgentDetails.find((a) => a.bot.name === rc.matchedAgentName)
                  : null;
                const agentColors = matchedAgent ? getRoleColor(matchedAgent.bot.role) : null;

                // Two-tone badge content
                const badgeInner = (
                  <span
                    className={`inline-flex items-center overflow-hidden rounded-full border text-xs transition-all ${
                      rc.covered
                        ? "border-border"
                        : "border-dashed border-red-400/30"
                    } ${(!isReadOnly && isTeamMember) ? "cursor-pointer hover:border-muted-foreground/40" : ""}`}
                  >
                    {/* Left zone — role + tier dot */}
                    <span className={`flex items-center gap-1.5 py-1 pl-2.5 pr-2 ${!rc.covered ? "text-red-400" : "text-muted-foreground"}`}
                      style={{ background: "rgba(255,255,255,0.02)" }}
                    >
                      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
                      <span className="max-w-[160px] truncate">{rc.role}</span>
                    </span>
                    {/* Right zone — agent avatar + name + chevron */}
                    <span className={`flex items-center gap-1.5 border-l py-1 pl-2 pr-2 ${
                      rc.covered ? "border-border" : "border-red-400/15"
                    }`}>
                      {rc.covered && matchedAgent ? (
                        <>
                          <Avatar className="h-4 w-4">
                            <AvatarImage src={matchedAgent.bot.avatar_url ?? undefined} />
                            <AvatarFallback className={`text-[7px] font-bold ${agentColors?.avatarBg} ${agentColors?.avatarText}`}>
                              {matchedAgent.bot.name?.[0]?.toUpperCase() ?? "?"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="max-w-[100px] truncate font-medium text-foreground">
                            {rc.matchedAgentName}
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-red-400">assign</span>
                      )}
                      {!isReadOnly && isTeamMember && (
                        <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                      )}
                    </span>
                  </span>
                );

                // Read-only: static badge with tooltip for uncovered
                if (isReadOnly || !isTeamMember) {
                  if (!rc.covered) {
                    return (
                      <Tooltip key={rc.role}>
                        <TooltipTrigger asChild>{badgeInner}</TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Unmatched — assign to ensure the right agent handles this role</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  return <span key={rc.role}>{badgeInner}</span>;
                }

                // Editable: clickable badge with popover
                return (
                  <Popover key={rc.role} open={openRolePopover === rc.role} onOpenChange={(open) => setOpenRolePopover(open ? rc.role : null)}>
                    <PopoverTrigger asChild>
                      {!rc.covered ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="focus:outline-none">{badgeInner}</button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Unmatched — assign to ensure the right agent handles this role</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <button type="button" className="focus:outline-none">{badgeInner}</button>
                      )}
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-2" align="start">
                      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Assign agent to {rc.role}
                      </p>
                      <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
                        {ideaAgentDetails.map((agent) => {
                          const colors = getRoleColor(agent.bot.role);
                          const isSelected = rc.covered && rc.matchedAgentName === agent.bot.name;
                          return (
                            <button
                              key={agent.bot_id}
                              type="button"
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                              onClick={async () => {
                                setOpenRolePopover(null);
                                const prevCoverage = roleCoverage;
                                setRoleCoverage((prev) =>
                                  prev.map((r) =>
                                    r.role === rc.role
                                      ? { ...r, covered: true, matchedAgentName: agent.bot.name ?? null, matchedAgentRole: agent.bot.role ?? null, matchTier: "manual" }
                                      : r
                                  )
                                );
                                try {
                                  await setManualRoleMatch(ideaId, rc.role, agent.bot_id);
                                  toast.success(`Assigned "${agent.bot.name}" to ${rc.role}`);
                                } catch {
                                  setRoleCoverage(prevCoverage);
                                  toast.error("Failed to assign agent");
                                }
                              }}
                            >
                              <Avatar className="h-5 w-5">
                                <AvatarImage src={agent.bot.avatar_url ?? undefined} />
                                <AvatarFallback className={`text-[10px] ${colors.avatarBg} ${colors.avatarText}`}>
                                  {agent.bot.name?.[0]?.toUpperCase() ?? "?"}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col text-left leading-tight">
                                <span>{agent.bot.name}</span>
                                {agent.bot.role && (
                                  <span className="text-[11px] text-muted-foreground">{agent.bot.role}</span>
                                )}
                              </div>
                              {isSelected && <Check className="ml-auto h-3.5 w-3.5 text-emerald-400" />}
                            </button>
                          );
                        })}
                      </div>
                      {rc.covered && (
                        <>
                          <div className="my-1 border-t border-border" />
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                            onClick={async () => {
                              setOpenRolePopover(null);
                              const prevCoverage = roleCoverage;
                              try {
                                await clearManualRoleMatch(ideaId, rc.role);
                                const pool = ideaAgentDetails.map((a) => ({ botId: a.bot_id, name: a.bot.name ?? "", role: a.bot.role ?? "" }));
                                const updated = await getRoleCoverage(ideaId, pool);
                                setRoleCoverage(updated);
                                toast.success(`Reverted "${rc.role}" to auto-match`);
                              } catch {
                                setRoleCoverage(prevCoverage);
                                toast.error("Failed to revert");
                              }
                            }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <div className="flex flex-col text-left leading-tight">
                              <span>Auto-match</span>
                              <span className="text-[11px] text-muted-foreground">Let the system decide</span>
                            </div>
                          </button>
                        </>
                      )}
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Loading state for stats */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Agent Pool Grid */}
      {!loading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {ideaAgentDetails.map((agent) => {
            const colors = getRoleColor(agent.bot?.role);
            const stats = agentStats[agent.bot_id] ?? {
              tasksAssigned: 0,
              pendingSteps: 0,
              completedSteps: 0,
            };
            const canRemove =
              !isReadOnly &&
              (isAuthor || agent.added_by === currentUserId);

            return (
              <div
                key={agent.id}
                className="flex flex-col gap-3 rounded-lg border bg-card p-4"
              >
                {/* Agent header */}
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={agent.bot?.avatar_url ?? undefined} />
                    <AvatarFallback
                      className={`text-sm ${colors.avatarBg} ${colors.avatarText}`}
                    >
                      {agent.bot?.name?.[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{agent.bot?.name}</p>
                    {agent.bot?.role && (
                      <Badge
                        variant="outline"
                        className={`mt-0.5 text-xs ${colors.badge}`}
                      >
                        {agent.bot.role}
                      </Badge>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Owner: {agent.bot?.owner?.full_name ?? "Unknown"}
                    </p>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted/50 px-2 py-1.5">
                    <p className="text-lg font-semibold">
                      {stats.tasksAssigned}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Tasks</p>
                  </div>
                  <div className="rounded-md bg-muted/50 px-2 py-1.5">
                    <p className="text-lg font-semibold">
                      {stats.pendingSteps}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Pending</p>
                  </div>
                  <div className="rounded-md bg-muted/50 px-2 py-1.5">
                    <p className="text-lg font-semibold">
                      {stats.completedSteps}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Done</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Link
                    href={`/agents/${agent.bot_id}`}
                    className="flex-1"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View Profile
                    </Button>
                  </Link>
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleRemove(agent.bot_id)}
                      disabled={pending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
