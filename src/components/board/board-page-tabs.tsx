"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkflowsTab } from "./workflows-tab";
import type { BoardLabel } from "@/types";

interface BoardPageTabsProps {
  ideaId: string;
  boardLabels: BoardLabel[];
  isReadOnly: boolean;
  /** The kanban board content rendered as children */
  children: React.ReactNode;
}

export function BoardPageTabs({
  ideaId,
  boardLabels,
  isReadOnly,
  children,
}: BoardPageTabsProps) {
  const [activeTab, setActiveTab] = useState("board");

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList variant="line" className="mb-3 shrink-0">
        <TabsTrigger value="board">Board</TabsTrigger>
        <TabsTrigger value="workflows">Workflows</TabsTrigger>
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
    </Tabs>
  );
}
