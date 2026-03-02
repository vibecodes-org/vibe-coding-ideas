"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  MessageSquare,
  CheckCircle2,
  Lightbulb,
  ExternalLink,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentVoteButton } from "./agent-vote-button";
import { CloneAgentButton } from "./clone-agent-button";
import { EditAgentDialog } from "./edit-agent-dialog";
import { parsePromptToFields } from "@/lib/prompt-builder";
import { cn, getInitials } from "@/lib/utils";
import { getRoleColor } from "@/lib/agent-colors";
import type { BotProfile } from "@/types";

interface ActivityItem {
  id: string;
  action: string;
  details: Record<string, string> | null;
  created_at: string;
  taskTitle: string;
}

interface AgentProfileProps {
  bot: BotProfile & {
    owner: { id: string; full_name: string | null; avatar_url: string | null };
  };
  isOwner: boolean;
  hasVoted: boolean;
  tasks: Array<{
    id: string;
    title: string;
    archived: boolean;
    board_columns: { title: string; is_done_column: boolean; idea_id: string };
  }>;
  completedTaskCount: number;
  contributingIdeas: Array<{ id: string; title: string; assignedCount: number }>;
  recentActivity: ActivityItem[];
  clonedFromBot: { id: string; name: string } | null;
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function getActivityIcon(action: string) {
  if (action === "moved") return { icon: ArrowRight, className: "bg-blue-500/15 text-blue-500" };
  if (action === "comment_added") return { icon: MessageSquare, className: "bg-emerald-500/15 text-emerald-500" };
  return { icon: CheckCircle2, className: "bg-violet-500/15 text-violet-400" };
}

export function AgentProfile({
  bot,
  isOwner,
  hasVoted,
  tasks,
  completedTaskCount,
  contributingIdeas,
  recentActivity,
  clonedFromBot,
}: AgentProfileProps) {
  const [editOpen, setEditOpen] = useState(false);

  const initials = getInitials(bot.name);

  const colors = getRoleColor(bot.role);

  const promptFields =
    bot.is_published || isOwner
      ? parsePromptToFields(bot.system_prompt ?? "")
      : null;

  const createdDate = new Date(bot.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link
          href="/agents"
          className="text-violet-400 hover:underline"
        >
          Agents Hub
        </Link>
        <span>/</span>
        <span>{bot.name}</span>
      </div>

      {/* Hero */}
      <div className="flex gap-6 pb-6 border-b border-border">
        {/* Avatar + status */}
        <div className="shrink-0 text-center">
          <Avatar className="h-20 w-20 mb-2">
            <AvatarImage src={bot.avatar_url ?? undefined} />
            <AvatarFallback className={cn("text-2xl", colors.avatarBg, colors.avatarText)}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center justify-center gap-1">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                bot.is_active ? "bg-emerald-500" : "bg-muted-foreground"
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium",
                bot.is_active ? "text-emerald-400" : "text-muted-foreground"
              )}
            >
              {bot.is_active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold truncate">{bot.name}</h1>
            {bot.role && (
              <Badge className={cn("text-xs shrink-0 border-0", colors.badge)}>
                {bot.role}
              </Badge>
            )}
          </div>

          {bot.bio && (
            <p className="text-sm text-muted-foreground italic mb-2">
              &ldquo;{bot.bio}&rdquo;
            </p>
          )}

          {/* Metadata line */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-2">
            <span>
              Owned by{" "}
              <Link
                href={`/profile/${bot.owner.id}`}
                className="font-medium text-muted-foreground/80 hover:underline"
              >
                {bot.owner.full_name ?? "Unknown"}
              </Link>
            </span>
            <span className="text-[8px]">&#x2022;</span>
            <span>Created {createdDate}</span>
            {bot.is_published && (
              <>
                <span className="text-[8px]">&#x2022;</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-500">
                  &#x1F310; Published
                </span>
              </>
            )}
          </div>

          {clonedFromBot && (
            <p className="text-xs text-muted-foreground mb-2">
              Cloned from{" "}
              <Link
                href={`/agents/${clonedFromBot.id}`}
                className="text-primary hover:underline"
              >
                {clonedFromBot.name}
              </Link>
            </p>
          )}

          {/* Skills */}
          {bot.skills && bot.skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {bot.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-border/50 bg-background/50 px-2 py-px text-[10px] font-medium text-muted-foreground"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex gap-2 self-start">
          {isOwner ? (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setEditOpen(true)}
            >
              Edit Profile
            </Button>
          ) : (
            <>
              <AgentVoteButton
                botId={bot.id}
                upvotes={bot.community_upvotes}
                hasVoted={hasVoted}
              />
              <CloneAgentButton botId={bot.id} botName={bot.name} />
            </>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-violet-400">{completedTaskCount}</p>
          <p className="text-[10px] text-muted-foreground">Tasks Completed</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-blue-500">{tasks.length}</p>
          <p className="text-[10px] text-muted-foreground">Currently Assigned</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-emerald-500">{contributingIdeas.length}</p>
          <p className="text-[10px] text-muted-foreground">Active Ideas</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-amber-500">{bot.community_upvotes}</p>
          <p className="text-[10px] text-muted-foreground">Community Upvotes</p>
        </div>
      </div>

      {/* Personality & Instructions */}
      {promptFields && (promptFields.goal || promptFields.constraints || promptFields.approach) && (
        <>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            &#x1F9E0; Personality & Instructions
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {promptFields.goal && (
              <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50 text-xs font-semibold text-emerald-500">
                  &#x1F3AF; Goal
                </div>
                <div className="px-3.5 py-3 text-xs text-muted-foreground leading-relaxed">
                  {promptFields.goal}
                </div>
              </div>
            )}
            {promptFields.constraints && (
              <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50 text-xs font-semibold text-red-500">
                  &#x1F6AB; Constraints
                </div>
                <div className="px-3.5 py-3 text-xs text-muted-foreground leading-relaxed">
                  {promptFields.constraints}
                </div>
              </div>
            )}
            {promptFields.approach && (
              <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50 text-xs font-semibold text-blue-500">
                  &#x1F4CB; Approach
                </div>
                <div className="px-3.5 py-3 text-xs text-muted-foreground leading-relaxed">
                  {promptFields.approach}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Raw prompt for non-structured prompts */}
      {(bot.is_published || isOwner) &&
        bot.system_prompt &&
        !promptFields && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              &#x1F9E0; Personality & Instructions
            </h2>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {bot.system_prompt}
              </p>
            </div>
          </div>
        )}

      {/* Two-column: Activity + Contributing Ideas */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              &#x1F4C8; Recent Activity
            </h2>
            <div className="flex flex-col gap-1.5">
              {recentActivity.map((activity) => {
                const { icon: Icon, className: iconClass } = getActivityIcon(activity.action);
                const actionLabel = activity.action === "moved"
                  ? `Moved "${activity.taskTitle}" ${activity.details?.to ? `to ${activity.details.to}` : ""}`
                  : activity.action === "comment_added"
                    ? `Commented on "${activity.taskTitle}"`
                    : `${activity.action.replace(/_/g, " ")} "${activity.taskTitle}"`;

                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-2.5 rounded-md border border-border/50 bg-muted/30 p-2.5"
                  >
                    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", iconClass)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{actionLabel}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {formatRelativeTime(activity.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contributing To */}
        {contributingIdeas.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Contributing To
            </h2>
            <div className="flex flex-col gap-1.5">
              {contributingIdeas.map((idea) => (
                <Link
                  key={idea.id}
                  href={`/ideas/${idea.id}`}
                  className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-2.5 transition-colors hover:bg-muted/50"
                >
                  <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium flex-1 truncate">{idea.title}</span>
                  {idea.assignedCount > 0 ? (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-emerald-500/15 text-emerald-500 border-0 shrink-0"
                    >
                      {idea.assignedCount} assigned
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground shrink-0">Available</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active Tasks */}
      {tasks.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Active Tasks</h2>
          <div className="flex flex-col gap-1.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 p-2.5"
              >
                <span className="text-sm truncate">{task.title}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {task.board_columns.title}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {isOwner && (
        <EditAgentDialog
          bot={bot}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </div>
  );
}
