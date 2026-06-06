"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, usePathname } from "next/navigation";
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
  const pathname = usePathname();

  // Tab state is purely CLIENT-SIDE. The board page is `force-dynamic`, so using
  // router.replace(?tab=…) re-ran the entire server component on every tab click
  // (re-fetching all board data + regenerating cover-image signed URLs) — a
  // multi-second cost for a view the server doesn't even branch on. We keep the
  // active tab in local state and sync the URL via the History API (no RSC
  // refetch). The board data is already loaded as props.
  const initialTab =
    searchParams.get("tab") === "workflows"
      ? "workflows"
      : searchParams.get("tab") === "agents"
        ? "agents"
        : "board";
  const [activeTab, setActiveTabState] = useState<string>(initialTab);

  // Once a tab has been opened we keep it MOUNTED (rendered but hidden when
  // inactive) so its data fetch runs once, not on every reopen. The Workflows /
  // Agents tabs each fetch templates+steps, auto-rules, role coverage and role
  // suggestions on mount, so re-mounting on every switch was the remaining cost.
  const [openedTabs, setOpenedTabs] = useState<Set<string>>(() => new Set([initialTab]));

  // Stay in sync with back/forward and with the programmatic popstate events the
  // Workflows/Agents tabs dispatch when they cross-link to each other.
  useEffect(() => {
    const syncFromUrl = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      const next = t === "workflows" ? "workflows" : t === "agents" ? "agents" : "board";
      setActiveTabState(next);
      setOpenedTabs((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const setActiveTab = useCallback(
    (tab: string) => {
      setActiveTabState(tab);
      setOpenedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
      const params = new URLSearchParams(window.location.search);
      if (tab === "board") params.delete("tab");
      else params.set("tab", tab);
      const qs = params.toString();
      window.history.replaceState(null, "", `${pathname}${qs ? `?${qs}` : ""}`);
    },
    [pathname]
  );

  // Stable reference so the kept-mounted WorkflowsTab doesn't re-run its
  // role-coverage effect on every parent re-render.
  const agentCandidates = useMemo(
    () => ideaAgentDetails.map((a) => ({ botId: a.bot.id, name: a.bot.name ?? "", role: a.bot.role ?? "" })),
    [ideaAgentDetails]
  );

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
            AI Team
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

      <TabsContent
        value="board"
        forceMount
        className={`min-h-0 flex-1 ${activeTab === "board" ? "" : "hidden"}`}
      >
        {children}
      </TabsContent>

      <TabsContent
        value="workflows"
        forceMount
        className={`min-h-0 flex-1 ${activeTab === "workflows" ? "" : "hidden"}`}
      >
        {openedTabs.has("workflows") && (
          <WorkflowsTab
            ideaId={ideaId}
            boardLabels={boardLabels}
            isReadOnly={isReadOnly}
            hasAgents={ideaAgentDetails.length > 0}
            kitName={kitName}
            agentCandidates={agentCandidates}
          />
        )}
      </TabsContent>

      <TabsContent
        value="agents"
        forceMount
        className={`min-h-0 flex-1 ${activeTab === "agents" ? "" : "hidden"}`}
      >
        {openedTabs.has("agents") && (
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
