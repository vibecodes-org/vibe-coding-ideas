"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Star, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { addFeaturedTeam } from "@/actions/bots";
import { toast } from "sonner";
import { getRoleColor } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";
import type { FeaturedTeamWithAgents } from "@/types";

interface FeaturedTeamsProps {
  teams: FeaturedTeamWithAgents[];
  userExistingRoles: Set<string>;
}

export function FeaturedTeams({ teams, userExistingRoles }: FeaturedTeamsProps) {
  const [loadingTeamId, setLoadingTeamId] = useState<string | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateScrollState, teams]);

  function scroll(direction: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = 340 + 12; // card max-width + gap
    el.scrollBy({ left: direction === "left" ? -cardWidth : cardWidth, behavior: "smooth" });
  }

  if (teams.length === 0) return null;

  async function handleAddTeam(teamId: string) {
    setLoadingTeamId(teamId);
    try {
      const { created, skipped } = await addFeaturedTeam(teamId);
      if (created.length > 0) {
        toast.success(
          `Created ${created.length} agent${created.length > 1 ? "s" : ""}: ${created.join(", ")}`
        );
      }
      if (created.length === 0 && skipped.length > 0) {
        toast.info("All agents from this team already exist");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add team");
    } finally {
      setLoadingTeamId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Star className="h-4 w-4" />
        Featured Teams
      </div>
      <div className="relative">
        <button
          onClick={() => scroll("left")}
          disabled={!canScrollLeft}
          className="absolute -left-5 top-1/2 z-10 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-md transition-colors hover:bg-muted disabled:opacity-0 disabled:pointer-events-none"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => scroll("right")}
          disabled={!canScrollRight}
          className="absolute -right-5 top-1/2 z-10 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-md transition-colors hover:bg-muted disabled:opacity-0 disabled:pointer-events-none"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
        {teams.map((team) => {
          const sortedAgents = [...team.agents].sort(
            (a, b) => a.display_order - b.display_order
          );
          const existingCount = sortedAgents.filter((a) =>
            userExistingRoles.has((a.bot.role ?? "").toLowerCase())
          ).length;
          const remainingCount = sortedAgents.length - existingCount;
          const maxVisible = 3;
          const hasMore = sortedAgents.length > maxVisible;
          const isExpanded = expandedTeam === team.id;
          const visibleAgents = isExpanded
            ? sortedAgents
            : sortedAgents.slice(0, maxVisible);

          return (
            <div
              key={team.id}
              className="flex min-w-[320px] max-w-[340px] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-muted/30 transition-colors hover:border-border/80"
            >
              {/* Header */}
              <div className="flex items-start gap-3 p-3.5 pb-2.5">
                <span className="text-xl shrink-0 mt-0.5">{team.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{team.name}</div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {team.description}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {sortedAgents.length} agents
                </span>
              </div>

              {/* Agent rows */}
              <div className="flex flex-col gap-1 px-3.5 pb-1">
                {visibleAgents.map((entry) => {
                  const bot = entry.bot;
                  const initial = (bot.role ?? bot.name)?.[0]?.toUpperCase() ?? "?";
                  const description =
                    entry.display_description ?? bot.bio ?? bot.role ?? "";
                  const agentColors = getRoleColor(bot.role);

                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2 rounded-md bg-background/50 px-2 py-1.5 text-xs"
                    >
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={bot.avatar_url ?? undefined} />
                        <AvatarFallback className={cn("text-[10px]", agentColors.avatarBg, agentColors.avatarText)}>
                          {initial}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{bot.role ?? bot.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[120px]">
                        {description}
                      </span>
                    </div>
                  );
                })}
                {hasMore && !isExpanded && (
                  <button
                    onClick={() => setExpandedTeam(team.id)}
                    className="flex items-center justify-center gap-1 w-full py-1 mt-0.5 text-[10px] font-medium text-muted-foreground border border-dashed border-border/50 rounded-md hover:text-violet-400 hover:border-violet-500/30 hover:bg-violet-500/10 transition-colors"
                  >
                    <ChevronDown className="h-3 w-3" />
                    Show {sortedAgents.length - maxVisible} more agents
                  </button>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-3.5 py-2.5 mt-auto">
                {existingCount > 0 ? (
                  <span className="text-[11px] font-medium text-emerald-500">
                    &#x2714; {existingCount} of {sortedAgents.length} already added
                  </span>
                ) : (
                  <div />
                )}
                {remainingCount > 0 ? (
                  <Button
                    size="sm"
                    variant={existingCount > 0 ? "outline" : "default"}
                    className={`h-7 text-xs ${existingCount > 0 ? "border-violet-500/30 bg-violet-500/15 text-violet-400 hover:bg-violet-500/25" : ""}`}
                    onClick={() => handleAddTeam(team.id)}
                    disabled={loadingTeamId !== null}
                  >
                    {loadingTeamId === team.id
                      ? "Creating..."
                      : existingCount > 0
                        ? `Add ${remainingCount} Remaining`
                        : "Add Team"}
                  </Button>
                ) : (
                  <span className="text-[11px] font-medium text-emerald-500">
                    &#x2714; All added
                  </span>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
