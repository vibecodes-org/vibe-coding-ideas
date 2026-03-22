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
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getRoleColor } from "@/lib/agent-colors";
import { allocateAgent, removeIdeaAgent } from "@/actions/idea-agents";
import { createClient } from "@/lib/supabase/client";
import { buildRoleMatcher } from "@/lib/role-matching";
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

interface RoleCoverage {
  role: string;
  covered: boolean;
  matchedAgentName: string | null;
  matchedAgentRole: string | null;
}

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

  // Bots the current user owns that are NOT already in the pool
  const allocatedBotIds = new Set(ideaAgentDetails.map((a) => a.bot_id));
  const unallocatedBots = userBotProfiles.filter(
    (b) => !allocatedBotIds.has(b.id)
  );

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

      // Build role coverage
      const templateRoles = new Set<string>();
      for (const tmpl of templateResult.data ?? []) {
        const steps = tmpl.steps as { role?: string }[];
        for (const step of steps ?? []) {
          if (step.role) templateRoles.add(step.role.toLowerCase());
        }
      }

      const agentCandidates = ideaAgentDetails
        .filter((a) => a.bot?.role)
        .map((a) => ({ botId: a.bot_id, role: a.bot.role! }));
      const matcher = buildRoleMatcher(agentCandidates);

      // Build a botId → agent details lookup
      const agentLookup = new Map(
        ideaAgentDetails.map((a) => [a.bot_id, { name: a.bot?.name ?? "Unknown", role: a.bot?.role ?? "Agent" }])
      );

      const coverage: RoleCoverage[] = Array.from(templateRoles).map(
        (role) => {
          const match = matcher(role);
          const agent = match.botId ? agentLookup.get(match.botId) : null;
          return {
            role,
            covered: match.tier !== "none",
            matchedAgentName: agent?.name ?? null,
            matchedAgentRole: agent?.role ?? null,
          };
        }
      );

      // Sort: uncovered first, then alphabetical
      coverage.sort((a, b) => {
        if (a.covered !== b.covered) return a.covered ? 1 : -1;
        return a.role.localeCompare(b.role);
      });

      setRoleCoverage(coverage);
      setLoading(false);
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [ideaId, ideaAgentDetails]);

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
          {isTeamMember && unallocatedBots.length > 0 && (
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Agent
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="center">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Add your agent
                </p>
                <div className="space-y-1">
                  {unallocatedBots.map((bot) => {
                    const colors = getRoleColor(bot.role);
                    return (
                      <button
                        key={bot.id}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                        onClick={() => handleAllocate(bot.id)}
                        disabled={pending}
                      >
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
              </PopoverContent>
            </Popover>
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
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Agent
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="end">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Add your agent
              </p>
              <div className="space-y-1">
                {unallocatedBots.map((bot) => {
                  const colors = getRoleColor(bot.role);
                  return (
                    <button
                      key={bot.id}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                      onClick={() => handleAllocate(bot.id)}
                      disabled={pending}
                    >
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
            </PopoverContent>
          </Popover>
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
