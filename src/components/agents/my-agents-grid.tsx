"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { AgentCard } from "./agent-card";
import { EmptyState } from "./empty-state";
import { EditAgentDialog } from "./edit-agent-dialog";
import { FeaturedTeams } from "./featured-teams";
import type { BotProfile, FeaturedTeamWithAgents } from "@/types";
import type { UserIdea } from "./allocate-to-idea-dialog";

interface MyAgentsGridProps {
  bots: BotProfile[];
  botStats: Record<string, { taskCount: number; ideaCount: number; assignedCount: number }>;
  onCreateAgent: () => void;
  onSwitchToCommunity: () => void;
  featuredTeams: FeaturedTeamWithAgents[];
  userExistingRoles: string[];
  userIdeas?: UserIdea[];
}

export function MyAgentsGrid({ bots, botStats, onCreateAgent, onSwitchToCommunity, featuredTeams, userExistingRoles, userIdeas = [] }: MyAgentsGridProps) {
  const [editingBot, setEditingBot] = useState<BotProfile | null>(null);

  if (bots.length === 0) {
    return (
      <EmptyState
        onCreateAgent={onCreateAgent}
        onBrowseCommunity={onSwitchToCommunity}
        featuredTeams={featuredTeams}
        userExistingRoles={userExistingRoles}
        userIdeas={userIdeas}
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        {bots.map((bot) => (
          <AgentCard
            key={bot.id}
            bot={bot}
            variant="owned"
            stats={botStats[bot.id] ?? { taskCount: 0, ideaCount: 0, assignedCount: 0 }}
            onEdit={() => setEditingBot(bot)}
          />
        ))}
      </div>

      {/* Featured Teams cross-promotion */}
      {featuredTeams.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
            <Star className="h-4 w-4" />
            Featured Teams
            <span className="font-normal text-xs">&mdash; clone a complete team in one click</span>
            <div className="flex-1 h-px bg-border/50" />
          </div>
          <FeaturedTeams
            teams={featuredTeams}
            userExistingRoles={userExistingRoles}
            userIdeas={userIdeas}
          />
        </div>
      )}

      {editingBot && (
        <EditAgentDialog
          bot={editingBot}
          open={!!editingBot}
          onOpenChange={(open) => {
            if (!open) setEditingBot(null);
          }}
        />
      )}
    </>
  );
}
