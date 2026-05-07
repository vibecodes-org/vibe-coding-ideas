"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Plus, Loader2, Bell, AlertTriangle, Clock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, formatRelativeTime } from "@/lib/utils";
import { ACTIVITY_ACTIONS } from "@/lib/constants";
import { BotActivityDialog } from "@/components/dashboard/bot-activity-dialog";
import type { DashboardBot } from "@/types";
import type { AgentStatus } from "@/lib/agent-status";

interface MyBotsProps {
  bots: DashboardBot[];
}

export function MyBots({ bots }: MyBotsProps) {
  const [selectedBot, setSelectedBot] = useState<DashboardBot | null>(null);

  if (bots.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <Bot className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium">Your AI agents</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Create AI agents to automate workflow steps on your boards.
        </p>
        <div className="mt-4">
          <Link href="/agents">
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Create your first agent
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {bots.map((bot) => (
          <button
            key={bot.id}
            type="button"
            onClick={() => setSelectedBot(bot)}
            className={cn(
              "w-full text-left rounded-md border border-border p-3 hover:bg-muted/50 transition-colors cursor-pointer",
              !bot.is_active && "opacity-50"
            )}
          >
            <div className="flex items-start gap-3">
              <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                {bot.avatar_url && <AvatarImage src={bot.avatar_url} alt={bot.name} />}
                <AvatarFallback className="text-xs">
                  {bot.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{bot.name}</span>
                  {bot.role && (
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {bot.role}
                    </Badge>
                  )}
                  {bot.isActiveMcpBot && (
                    <Badge className="text-[10px] shrink-0 bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30">
                      MCP Active
                    </Badge>
                  )}
                  {!bot.is_active && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      Inactive
                    </Badge>
                  )}
                </div>
                <AgentStatusLine status={bot.currentStatus} />
                {bot.lastActivity && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {ACTIVITY_ACTIONS[bot.lastActivity.action]?.label ?? bot.lastActivity.action}{" "}
                    {formatRelativeTime(bot.lastActivity.created_at)}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      <BotActivityDialog
        bot={selectedBot}
        open={selectedBot !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedBot(null);
        }}
      />
    </>
  );
}

function AgentStatusLine({ status }: { status: AgentStatus }) {
  if (status.type === "none") {
    return <p className="mt-1 text-xs text-muted-foreground">No current task</p>;
  }

  if (status.type === "assigned") {
    return (
      <Link
        href={`/ideas/${status.ideaId}/board?taskId=${status.taskId}`}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="truncate flex-1 min-w-0">{status.taskTitle}</span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {status.columnTitle}
        </Badge>
        <ChevronRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    );
  }

  // All workflow-step states share the same skeleton: pill + fraction + step · task
  const href = `/ideas/${status.ideaId}/board?taskId=${status.taskId}&stepId=${status.stepId}`;

  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="mt-1 flex flex-wrap items-center gap-1.5 text-xs group"
    >
      <StatusPill status={status} />
      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
        {status.fraction.completed}/{status.fraction.total}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground group-hover:text-foreground transition-colors">
        <span className="font-semibold text-foreground shrink-0">{status.stepTitle}</span>
        <span className="opacity-50">·</span>
        <span className="truncate min-w-0">{status.taskTitle}</span>
      </span>
    </Link>
  );
}

function StatusPill({ status }: { status: Exclude<AgentStatus, { type: "none" } | { type: "assigned" }> }) {
  const className = "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold shrink-0";

  switch (status.type) {
    case "active":
      return (
        <span className={cn(className, "border-blue-500/25 bg-blue-500/15 text-blue-400")}>
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          Active
        </span>
      );
    case "approval":
      return (
        <span className={cn(className, "border-amber-500/25 bg-amber-500/15 text-amber-400")}>
          <Bell className="h-2.5 w-2.5" />
          Needs approval
        </span>
      );
    case "failed":
      return (
        <span className={cn(className, "border-red-500/20 bg-red-500/10 text-red-400")}>
          <AlertTriangle className="h-2.5 w-2.5" />
          Failed
        </span>
      );
    case "stale":
      return (
        <span className={cn(className, "border-amber-500/20 bg-amber-500/10 text-amber-400")}>
          <Clock className="h-2.5 w-2.5" />
          Stale · {status.ageHours}h
        </span>
      );
    case "pending":
      return (
        <span className={cn(className, "border-border bg-muted/30 text-muted-foreground")}>
          Up next
        </span>
      );
  }
}
