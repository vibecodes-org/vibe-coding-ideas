"use client";

import { useState } from "react";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MyAgentsGrid } from "./my-agents-grid";
import { CommunityTab } from "./community-tab";
import { CreateAgentDialog } from "./create-agent-dialog";
import { cn } from "@/lib/utils";
import type { BotProfile, BotProfileWithOwner, FeaturedTeamWithAgents } from "@/types";

interface AgentsHubProps {
  myBots: BotProfile[];
  botStats: Record<string, { taskCount: number; ideaCount: number; assignedCount: number }>;
  communityBots: BotProfileWithOwner[];
  userVotedBotIds: Set<string>;
  userExistingRoles: Set<string>;
  featuredTeams: FeaturedTeamWithAgents[];
}

type Tab = "my-agents" | "community";

export function AgentsHub({
  myBots,
  botStats,
  communityBots,
  userVotedBotIds,
  userExistingRoles,
  featuredTeams,
}: AgentsHubProps) {
  const [activeTab, setActiveTab] = useState<Tab>("my-agents");
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Agents Hub</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-xl leading-relaxed">
              Agents are AI-powered team members you can create, customise, and assign to tasks
              across your ideas. Give them distinct roles, personalities, and tool access &mdash;
              then allocate them to your idea boards where they collaborate alongside human team
              members via MCP.
            </p>
          </div>
        </div>
        <Button
          className="shrink-0 gap-2"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Create Agent
        </Button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1 w-fit">
        <button
          onClick={() => setActiveTab("my-agents")}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "my-agents"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          My Agents
        </button>
        <button
          onClick={() => setActiveTab("community")}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            activeTab === "community"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Browse
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "my-agents" ? (
        <MyAgentsGrid
          bots={myBots}
          botStats={botStats}
          onCreateAgent={() => setCreateOpen(true)}
          onSwitchToCommunity={() => setActiveTab("community")}
          featuredTeams={featuredTeams}
          userExistingRoles={userExistingRoles}
        />
      ) : (
        <CommunityTab
          bots={communityBots}
          userVotedBotIds={userVotedBotIds}
          userExistingRoles={userExistingRoles}
          featuredTeams={featuredTeams}
        />
      )}

      <CreateAgentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
