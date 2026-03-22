"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkflowsTab } from "./workflows-tab";
import { AgentsTab } from "./agents-tab";
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
      <TabsList variant="line" className="mb-3 shrink-0">
        <TabsTrigger value="board">Board</TabsTrigger>
        <TabsTrigger value="workflows">Workflows</TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
      </TabsList>

      <TabsContent value="board" className="min-h-0 flex-1">
        {children}
      </TabsContent>

      <TabsContent value="workflows" className="min-h-0 flex-1">
        {activeTab === "workflows" && (
          <WorkflowsTab
            ideaId={ideaId}
            boardLabels={boardLabels}
            isReadOnly={isReadOnly}
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
