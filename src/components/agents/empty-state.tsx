"use client";

import { Plus } from "lucide-react";
import { AgentAnimation } from "./agent-animation";
import { Button } from "@/components/ui/button";
import { FeaturedTeams } from "./featured-teams";
import type { FeaturedTeamWithAgents } from "@/types";
import type { UserIdea } from "./allocate-to-idea-dialog";

interface EmptyStateProps {
  onCreateAgent: () => void;
  onBrowseCommunity: () => void;
  featuredTeams: FeaturedTeamWithAgents[];
  userExistingRoles: string[];
  userIdeas?: UserIdea[];
}

export function EmptyState({
  onCreateAgent,
  onBrowseCommunity,
  featuredTeams,
  userExistingRoles,
  userIdeas = [],
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-5 py-12 text-center">
      {/* Animation */}
      <AgentAnimation />

      {/* Title & description */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Build your first agent</h2>
        <p className="max-w-md text-sm text-muted-foreground leading-relaxed">
          Agents are like AI team members &mdash; give them a role, personality,
          and tool access, then assign them to tasks on your idea boards. Start from
          scratch or pick a team below.
        </p>
      </div>

      {/* Dual CTAs */}
      <div className="flex items-center gap-3">
        <Button onClick={onCreateAgent} className="gap-2 px-5">
          <Plus className="h-4 w-4" />
          Create Agent
        </Button>
        <Button variant="outline" onClick={onBrowseCommunity} className="px-5">
          Browse Agents
        </Button>
      </div>

      {/* Divider */}
      {featuredTeams.length > 0 && (
        <div className="flex items-center gap-3 w-full max-w-2xl">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or quick-start with a team</span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {/* Featured teams */}
      {featuredTeams.length > 0 && (
        <div className="w-full max-w-2xl text-left">
          <FeaturedTeams
            teams={featuredTeams}
            userExistingRoles={userExistingRoles}
            userIdeas={userIdeas}
          />
        </div>
      )}
    </div>
  );
}
