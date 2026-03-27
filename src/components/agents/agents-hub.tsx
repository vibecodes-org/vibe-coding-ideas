"use client";

import { useState, useEffect } from "react";
import { HelpLink } from "@/components/shared/help-link";
import Link from "next/link";
import { Bot, Plus, X, Cable } from "lucide-react";
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
  userVotedBotIds: string[];
  userExistingRoles: string[];
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
  const [bannerDismissed, setBannerDismissed] = useState(true);

  useEffect(() => {
    try {
      setBannerDismissed(
        localStorage.getItem("agents-mcp-banner-dismissed") === "true"
      );
    } catch {
      // localStorage unavailable
    }
  }, []);

  function dismissBanner() {
    setBannerDismissed(true);
    try {
      localStorage.setItem("agents-mcp-banner-dismissed", "true");
    } catch {
      // localStorage unavailable
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 mt-0.5">
            <Bot className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">Agents Hub <HelpLink href="/guide/ai-agent-teams" tooltip="How agents work" /></h1>
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

      {/* MCP setup banner */}
      {!bannerDismissed && myBots.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] px-4 py-3">
          <Cable className="h-4 w-4 shrink-0 text-cyan-400" />
          <p className="flex-1 text-sm text-muted-foreground">
            Agents work through{" "}
            <span className="font-medium text-foreground">Claude Code</span> via
            MCP (Model Context Protocol). Set up the connection to start using your agents.{" "}
            <Link
              href="/guide/mcp-integration"
              className="font-medium text-violet-400 hover:text-violet-300"
            >
              Setup guide &rarr;
            </Link>
          </p>
          <button
            onClick={dismissBanner}
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label="Dismiss MCP setup banner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
