"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentCard } from "./agent-card";
import { AgentProfileDialog } from "./agent-profile-dialog";
import { FeaturedTeams } from "./featured-teams";
import type { BotProfileWithOwner, FeaturedTeamWithAgents } from "@/types";

interface CommunityTabProps {
  bots: BotProfileWithOwner[];
  userVotedBotIds: Set<string>;
  userExistingRoles: Set<string>;
  featuredTeams: FeaturedTeamWithAgents[];
}

type SortOption = "popular" | "newest" | "most-added";

export function CommunityTab({ bots, userVotedBotIds, userExistingRoles, featuredTeams }: CommunityTabProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [sort, setSort] = useState<SortOption>("popular");
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  // Build role filter options dynamically from actual community bots
  const roleFilters = useMemo(() => {
    const roles = new Set<string>();
    for (const b of bots) {
      if (b.role) roles.add(b.role);
    }
    return ["All Roles", ...Array.from(roles).sort()];
  }, [bots]);

  const filteredBots = useMemo(() => {
    let filtered = bots;

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.bio?.toLowerCase().includes(q) ||
          b.role?.toLowerCase().includes(q) ||
          b.skills?.some((s) => s.toLowerCase().includes(q))
      );
    }

    // Role filter
    if (roleFilter !== "All Roles") {
      filtered = filtered.filter(
        (b) => b.role?.toLowerCase() === roleFilter.toLowerCase()
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      switch (sort) {
        case "popular":
          return b.community_upvotes - a.community_upvotes;
        case "newest":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "most-added":
          return b.times_cloned - a.times_cloned;
        default:
          return 0;
      }
    });

    return filtered;
  }, [bots, search, roleFilter, sort]);

  return (
    <div className="space-y-6">
      {/* Featured Teams */}
      <FeaturedTeams teams={featuredTeams} userExistingRoles={userExistingRoles} />

      {/* Individual Agents separator */}
      <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
        Individual Agents
        <div className="flex-1 h-px bg-border/50" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents by name, role, or skill..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[180px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleFilters.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
            <SelectTrigger className="w-[130px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Most Popular</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="most-added">Most Added</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid */}
      {filteredBots.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {search || roleFilter !== "All Roles"
              ? "No agents match your filters."
              : "No published agents yet. Be the first to publish!"}
          </p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {filteredBots.map((bot) => (
            <AgentCard
              key={bot.id}
              bot={bot}
              variant="community"
              ownerName={bot.owner?.full_name}
              hasVoted={userVotedBotIds.has(bot.id)}
              onClick={() => setSelectedBotId(bot.id)}
            />
          ))}
        </div>
      )}
      <AgentProfileDialog
        botId={selectedBotId}
        open={selectedBotId !== null}
        onOpenChange={(open) => { if (!open) setSelectedBotId(null); }}
      />
    </div>
  );
}
