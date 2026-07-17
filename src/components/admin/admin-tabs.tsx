"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiUsageDashboard } from "./ai-usage-dashboard";
import { TierAdherenceDashboard } from "./tier-adherence-dashboard";
import { FeedbackDashboard } from "./feedback-dashboard";
import { AdminAgentsDashboard } from "./admin-agents-dashboard";
import { AdminTeamsDashboard } from "./admin-teams-dashboard";
import { AdminTemplatesDashboard } from "./admin-templates-dashboard";
import { AdminMcpToolsDashboard } from "./admin-mcp-tools-dashboard";
import type { McpToolLogWithUser, McpToolStatsRow } from "./admin-mcp-tools-dashboard";
import type { UsageLogWithUser, FeedbackWithUser, UserCreditInfo, PlatformStatsEntry } from "@/app/(main)/admin/page";
import type { BotProfile, FeaturedTeamWithAgents, WorkflowLibraryTemplate } from "@/types";

interface AdminTabsProps {
  activeTab: string;
  isSuperAdmin: boolean;
  usageLogs: UsageLogWithUser[];
  usageFilters: { from: string; to: string; action: string; source: string };
  feedback: FeedbackWithUser[];
  feedbackFilters: { category: string; status: string };
  newFeedbackCount: number;
  adminAgents: BotProfile[];
  featuredTeams: FeaturedTeamWithAgents[];
  communityAgents: BotProfile[];
  libraryTemplates: WorkflowLibraryTemplate[];
  userCredits: UserCreditInfo[];
  platformStats: PlatformStatsEntry[];
  mcpToolLogs: McpToolLogWithUser[];
  mcpToolStats: McpToolStatsRow[];
  allMcpToolNames: string[];
}

export function AdminTabs({
  activeTab,
  isSuperAdmin,
  usageLogs,
  usageFilters,
  feedback,
  feedbackFilters,
  newFeedbackCount,
  adminAgents,
  featuredTeams,
  communityAgents,
  libraryTemplates,
  userCredits,
  platformStats,
  mcpToolLogs,
  mcpToolStats,
  allMcpToolNames,
}: AdminTabsProps) {
  const router = useRouter();

  function handleTabChange(value: string) {
    if (value === "ai-usage") {
      router.push("/admin");
    } else {
      router.push(`/admin?tab=${value}`);
    }
  }

  function handleRefresh() {
    router.refresh();
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="ai-usage">AI Usage</TabsTrigger>
        <TabsTrigger value="feedback" className="relative">
          Feedback
          {newFeedbackCount > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {newFeedbackCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
        <TabsTrigger value="teams">Teams</TabsTrigger>
        <TabsTrigger value="templates">Workflows</TabsTrigger>
        <TabsTrigger value="mcp-tools">MCP Tools</TabsTrigger>
      </TabsList>
      <TabsContent value="ai-usage" className="mt-6 space-y-10">
        <AiUsageDashboard usageLogs={usageLogs} filters={usageFilters} userCredits={userCredits} platformStats={platformStats} isSuperAdmin={isSuperAdmin} />
        <div>
          <h2 className="mb-3 text-lg font-semibold">Tier Adherence</h2>
          <TierAdherenceDashboard />
        </div>
      </TabsContent>
      <TabsContent value="feedback" className="mt-6">
        <FeedbackDashboard feedback={feedback} filters={feedbackFilters} />
      </TabsContent>
      <TabsContent value="agents" className="mt-6">
        <AdminAgentsDashboard agents={adminAgents} onRefresh={handleRefresh} />
      </TabsContent>
      <TabsContent value="teams" className="mt-6">
        <AdminTeamsDashboard
          teams={featuredTeams}
          adminAgents={adminAgents}
          communityAgents={communityAgents}
          onRefresh={handleRefresh}
        />
      </TabsContent>
      <TabsContent value="templates" className="mt-6">
        <AdminTemplatesDashboard templates={libraryTemplates} onRefresh={handleRefresh} />
      </TabsContent>
      <TabsContent value="mcp-tools" className="mt-6">
        <AdminMcpToolsDashboard recentLogs={mcpToolLogs} stats={mcpToolStats} allToolNames={allMcpToolNames} />
      </TabsContent>
    </Tabs>
  );
}
