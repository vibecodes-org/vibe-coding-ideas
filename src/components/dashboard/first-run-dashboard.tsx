"use client";

import Link from "next/link";
import { Check, Plus, Bot } from "lucide-react";
import { useSwitchToStandard } from "./dashboard-mode-switch";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { McpConnectionBanner } from "@/components/shared/mcp-connection-banner";
import { getRoleColor } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";
import type { BotProfile } from "@/types";
import type { ActiveBoard } from "./active-boards";

export const FIRST_RUN_OVERRIDE_KEY = "first-run-dashboard-dismissed";

interface BoardPreviewColumn {
  columnTitle: string;
  tasks: string[];
  count: number;
}

export interface FirstRunDashboardProps {
  userName: string | null;
  hasMcpConnection: boolean;
  ideasCount: number;
  firstIdea: { id: string; title: string } | null;
  activeBoards: ActiveBoard[];
  maxBoardTaskCount: number;
  workflowCount: number;
  boardPreview: BoardPreviewColumn[];
  botProfiles: BotProfile[];
  hasTaskInProgress: boolean;
  agentCount: number;
  taskCount: number;
}

interface SetupStep {
  label: string;
  done: boolean;
}

export function FirstRunDashboard({
  userName,
  hasMcpConnection,
  ideasCount,
  firstIdea,
  activeBoards,
  maxBoardTaskCount,
  workflowCount,
  boardPreview,
  botProfiles,
  hasTaskInProgress,
  agentCount,
  taskCount,
}: FirstRunDashboardProps) {
  const switchToStandard = useSwitchToStandard();

  const handleSwitch = () => {
    try {
      localStorage.setItem(FIRST_RUN_OVERRIDE_KEY, "true");
    } catch {
      // localStorage unavailable
    }
    switchToStandard?.();
  };

  // Raw completion state for each step
  const rawDone = [
    true, // Account — always done (user is logged in)
    ideasCount > 0,
    maxBoardTaskCount > 0,
    hasMcpConnection,
    hasTaskInProgress,
  ];

  // Steps are sequential: a step is only "done" if it AND all prior steps are done
  const steps: SetupStep[] = [
    "Account",
    "Idea",
    "Board",
    "MCP",
    "First task",
  ].map((label, i) => ({
    label,
    done: rawDone.slice(0, i + 1).every(Boolean),
  }));

  const doneCount = steps.filter((s) => s.done).length;
  const currentIndex = steps.findIndex((s) => !s.done);
  const percent = Math.round((doneCount / steps.length) * 100);

  // MCP banner shows when MCP step isn't sequentially complete
  const mcpStepComplete = steps[3].done;

  const displayBots = botProfiles.slice(0, 3);
  const remainingBots = botProfiles.length - 3;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl">
            Welcome back{userName ? `, ${userName.split(" ")[0]}` : ""} 👋
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Here&apos;s where you are with getting set up.
          </p>
        </div>
        <button
          onClick={handleSwitch}
          className="rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Switch to full dashboard
        </button>
      </div>

      {/* Setup Progress */}
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold">Your Setup Progress</span>
          <span className="text-sm font-semibold text-violet-400">
            {doneCount} of {steps.length} complete
          </span>
        </div>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-violet-500 transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="grid grid-cols-5 gap-1 sm:gap-2">
          {steps.map((step, i) => (
            <div key={step.label} className="text-center">
              <div
                className={cn(
                  "mx-auto flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold",
                  step.done
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                    : i === currentIndex
                      ? "border-amber-500 bg-amber-500/10 text-amber-400"
                      : "border-border bg-muted/50 text-muted-foreground"
                )}
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div
                className={cn(
                  "mt-1 text-[11px]",
                  step.done
                    ? "text-muted-foreground"
                    : i === currentIndex
                      ? "font-semibold text-amber-400"
                      : "text-muted-foreground"
                )}
              >
                {step.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        {/* Left column */}
        <div className="space-y-4">
          {/* Project card */}
          {firstIdea ? (
            <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{firstIdea.title}</h3>
                <Link
                  href={`/ideas/${firstIdea.id}/board`}
                  className="text-sm text-violet-400 hover:text-violet-300"
                >
                  Go to board &rarr;
                </Link>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {maxBoardTaskCount > 0 && (
                  <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-400">
                    {maxBoardTaskCount} tasks
                  </span>
                )}
                {agentCount > 0 && (
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                    {agentCount} agents
                  </span>
                )}
                {workflowCount > 0 && (
                  <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
                    {workflowCount} workflow{workflowCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {/* Mini board preview with task titles */}
              {boardPreview.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {boardPreview.map((col) => (
                    <div
                      key={col.columnTitle}
                      className="min-w-[130px] flex-1 rounded-lg border border-border bg-muted/30 p-2"
                    >
                      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {col.columnTitle}
                        <span className="rounded bg-muted px-1 text-[9px]">
                          {col.count}
                        </span>
                      </div>
                      {col.tasks.map((title) => (
                        <div
                          key={title}
                          className="mb-1 rounded border border-border bg-muted/50 px-1.5 py-1 text-[11px] text-muted-foreground truncate"
                        >
                          {title}
                        </div>
                      ))}
                      {col.count > col.tasks.length && (
                        <div className="text-[10px] text-muted-foreground/60 px-1">
                          +{col.count - col.tasks.length} more
                        </div>
                      )}
                      {col.count === 0 && (
                        <div className="py-2 text-center text-[10px] text-muted-foreground/60">
                          {!hasMcpConnection ? "Waiting for MCP" : "No tasks"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
              <p className="text-sm font-medium">Create your first idea</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Describe what you want to build and AI will help you plan it.
              </p>
              <div className="mt-4">
                <Link href="/ideas/new">
                  <Button size="sm" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Create an idea
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* MCP CTA — show until MCP step is sequentially complete */}
          {!mcpStepComplete && (
            <McpConnectionBanner
              agentCount={agentCount}
              taskCount={taskCount}
              dismissable={false}
            />
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Agent Team */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Your Agent Team</h3>
              <Link
                href="/agents"
                className="text-sm text-violet-400 hover:text-violet-300"
              >
                Manage &rarr;
              </Link>
            </div>
            {botProfiles.length === 0 ? (
              <div className="py-2 text-center">
                <Bot className="mx-auto h-6 w-6 text-muted-foreground/50" />
                <p className="mt-2 text-xs text-muted-foreground">
                  No agents yet
                </p>
                <Link href="/agents">
                  <Button size="sm" variant="outline" className="mt-2 gap-1 text-xs">
                    <Plus className="h-3 w-3" />
                    Create your first agent
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {displayBots.map((bot) => {
                  const colors = getRoleColor(bot.role);
                  return (
                    <div key={bot.id} className="flex items-center gap-2 py-1">
                      <Avatar className="h-7 w-7">
                        {bot.avatar_url && <AvatarImage src={bot.avatar_url} />}
                        <AvatarFallback
                          className={cn(
                            "text-[10px]",
                            colors.avatarBg,
                            colors.avatarText
                          )}
                        >
                          {bot.name?.[0]?.toUpperCase() ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-xs font-semibold">{bot.name}</div>
                        {bot.role && (
                          <div className="text-[11px] text-muted-foreground">
                            {bot.role}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {remainingBots > 0 && (
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    +{remainingBots} more agent{remainingBots !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <h3 className="mb-2 text-sm font-semibold">Quick Links</h3>
            <div className="flex flex-col gap-1">
              <Link
                href="/guide/mcp-integration"
                className="text-xs text-violet-400 hover:text-violet-300 py-1"
              >
                &rarr; MCP Integration Guide
              </Link>
              <Link
                href="/guide/workflows"
                className="text-xs text-violet-400 hover:text-violet-300 py-1"
              >
                &rarr; How Workflows Work
              </Link>
              <Link
                href="/agents?tab=community"
                className="text-xs text-violet-400 hover:text-violet-300 py-1"
              >
                &rarr; Browse Community Agents
              </Link>
              {firstIdea && (
                <Link
                  href={`/ideas/${firstIdea.id}`}
                  className="text-xs text-violet-400 hover:text-violet-300 py-1"
                >
                  &rarr; Invite Collaborators
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
