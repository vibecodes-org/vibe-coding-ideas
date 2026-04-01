"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { LayoutDashboard, Workflow, Bot } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkflowsTab } from "./workflows-tab";
import { AgentsTab } from "./agents-tab";
import { HelpLink } from "@/components/shared/help-link";
import type { BoardLabel, IdeaAgentWithDetails, BotProfile } from "@/types";

interface BoardPageTabsProps {
  ideaId: string;
  boardLabels: BoardLabel[];
  isReadOnly: boolean;
  ideaAgentDetails: IdeaAgentWithDetails[];
  userBotProfiles: BotProfile[];
  currentUserId: string;
  isAuthor: boolean;
  isTeamMember: boolean;
  kitName?: string | null;
  /** The kanban board content rendered as children */
  children: React.ReactNode;
}

export function BoardPageTabs({
  ideaId,
  boardLabels,
  isReadOnly,
  ideaAgentDetails,
  userBotProfiles,
  currentUserId,
  isAuthor,
  isTeamMember,
  kitName,
  children,
}: BoardPageTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get("tab");
  const activeTab =
    tabParam === "workflows"
      ? "workflows"
      : tabParam === "agents"
        ? "agents"
        : "board";

  function setActiveTab(tab: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "board") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <TabsList variant="line">
          <TabsTrigger value="board" className="gap-1.5">
            <LayoutDashboard className="h-3.5 w-3.5 text-blue-400" />
            Board
          </TabsTrigger>
          <TabsTrigger value="workflows" className="gap-1.5">
            <Workflow className="h-3.5 w-3.5 text-amber-400" />
            Workflows
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5">
            <Bot className="h-3.5 w-3.5 text-emerald-400" />
            Agents
          </TabsTrigger>
        </TabsList>
        <HelpLink
          href={
            activeTab === "workflows"
              ? "/guide/workflows"
              : activeTab === "agents"
                ? "/guide/ai-agent-teams"
                : "/guide/kanban-boards"
          }
          tooltip={
            activeTab === "workflows"
              ? "How workflows work"
              : activeTab === "agents"
                ? "How AI agent teams work"
                : "How boards work"
          }
        />
      </div>

      <TabsContent value="board" className="min-h-0 flex-1">
        {children}
      </TabsContent>

      <TabsContent value="workflows" className="min-h-0 flex-1">
        {activeTab === "workflows" && (
          <WorkflowsTab
            ideaId={ideaId}
            boardLabels={boardLabels}
            isReadOnly={isReadOnly}
            hasAgents={ideaAgentDetails.length > 0}
            kitName={kitName}
            agentCandidates={ideaAgentDetails.map((a) => ({ botId: a.bot.id, role: a.bot.role ?? "" }))}
          />
        )}
      </TabsContent>

      <TabsContent value="agents" className="min-h-0 flex-1">
        {activeTab === "agents" && (
          <AgentsTab
            ideaId={ideaId}
            ideaAgentDetails={ideaAgentDetails}
            userBotProfiles={userBotProfiles}
            currentUserId={currentUserId}
            isAuthor={isAuthor}
            isTeamMember={isTeamMember}
            isReadOnly={isReadOnly}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
