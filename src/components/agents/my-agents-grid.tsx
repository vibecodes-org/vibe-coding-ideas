"use client";

import { useState } from "react";
import { AgentCard } from "./agent-card";
import { EmptyState } from "./empty-state";
import { EditAgentDialog } from "./edit-agent-dialog";
import type { BotProfile, FeaturedTeamWithAgents } from "@/types";

interface MyAgentsGridProps {
  bots: BotProfile[];
  botStats: Record<string, { taskCount: number; ideaCount: number; assignedCount: number }>;
  onCreateAgent: () => void;
  onSwitchToCommunity: () => void;
  featuredTeams: FeaturedTeamWithAgents[];
  userExistingRoles: Set<string>;
}

export function MyAgentsGrid({ bots, botStats, onCreateAgent, onSwitchToCommunity, featuredTeams, userExistingRoles }: MyAgentsGridProps) {
  const [editingBot, setEditingBot] = useState<BotProfile | null>(null);

  if (bots.length === 0) {
    return (
      <EmptyState
        onCreateAgent={onCreateAgent}
        onBrowseCommunity={onSwitchToCommunity}
        featuredTeams={featuredTeams}
        userExistingRoles={userExistingRoles}
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
