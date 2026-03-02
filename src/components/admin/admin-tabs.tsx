"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiUsageDashboard } from "./ai-usage-dashboard";
import { FeedbackDashboard } from "./feedback-dashboard";
import { AdminAgentsDashboard } from "./admin-agents-dashboard";
import { AdminTeamsDashboard } from "./admin-teams-dashboard";
import type { UsageLogWithUser, FeedbackWithUser } from "@/app/(main)/admin/page";
import type { BotProfile, FeaturedTeamWithAgents } from "@/types";

interface AdminTabsProps {
  activeTab: string;
  usageLogs: UsageLogWithUser[];
  usageFilters: { from: string; to: string; action: string; source: string };
  feedback: FeedbackWithUser[];
  feedbackFilters: { category: string; status: string };
  newFeedbackCount: number;
  adminAgents: BotProfile[];
  featuredTeams: FeaturedTeamWithAgents[];
  communityAgents: BotProfile[];
}

export function AdminTabs({
  activeTab,
  usageLogs,
  usageFilters,
  feedback,
  feedbackFilters,
  newFeedbackCount,
  adminAgents,
  featuredTeams,
  communityAgents,
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
      </TabsList>
      <TabsContent value="ai-usage" className="mt-6">
        <AiUsageDashboard usageLogs={usageLogs} filters={usageFilters} />
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
    </Tabs>
  );
}
