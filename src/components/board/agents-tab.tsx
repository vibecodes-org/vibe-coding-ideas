"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  Bot,
  Plus,
  ExternalLink,
  Trash2,
  Check,
  AlertTriangle,
  Loader2,
  Users,
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
import { getRoleColor } from "@/lib/agent-colors";
import { allocateAllAgents, removeIdeaAgent, getRoleCoverage, type RoleCoverageResult } from "@/actions/idea-agents";
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
        toast.success("Agent removed from pool");
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
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Bot className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">No agents assigned</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add AI agents to this idea&apos;s pool to automate workflow steps
            and collaborate on tasks.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/agents">
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Browse Agents
            </Button>
          </Link>
          {isTeamMember && unallocatedBots.length >= 2 && (
            <Button
              size="sm"
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
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-y-auto pb-4">
      {/* Header with Add Agent button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Agent Pool</h2>
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

      {/* Role Coverage Panel */}
      {roleCoverage.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            Role Coverage
          </h3>
          <div className="flex flex-wrap gap-2">
            {roleCoverage.map((rc) => (
              <Badge
                key={rc.role}
                variant="outline"
                className={
                  rc.covered
                    ? "gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                    : "gap-1 border-amber-500/30 bg-amber-500/10 text-amber-500"
                }
              >
                {rc.covered ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {rc.role}
                {rc.covered && rc.matchedAgentName ? (
                  <span className="text-muted-foreground font-normal">
                    &rarr; {rc.matchedAgentName} ({rc.matchedAgentRole})
                    {rc.matchTier && rc.matchTier !== "exact" && (
                      <span
                        className={`ml-1 rounded px-1 py-0.5 text-[8px] font-semibold ${
                          rc.matchTier === "ai"
                            ? "bg-violet-500/10 text-violet-400"
                            : "bg-amber-500/10 text-amber-400"
                        }`}
                      >
                        {rc.matchTier === "ai" ? "AI" : "fuzzy"}
                      </span>
                    )}
                  </span>
                ) : !rc.covered ? (
                  <span className="font-normal">— no agent</span>
                ) : null}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Loading state for stats */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Agent Pool Grid */}
      {!loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
