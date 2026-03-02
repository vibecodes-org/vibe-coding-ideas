"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowRight,
  MessageSquare,
  CheckCircle2,
  Lightbulb,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentVoteButton } from "./agent-vote-button";
import { CloneAgentButton } from "./clone-agent-button";
import { parsePromptToFields } from "@/lib/prompt-builder";
import { cn, formatRelativeTime, getInitials } from "@/lib/utils";
import { getRoleColor } from "@/lib/agent-colors";
import { getAgentProfile, type AgentProfileData } from "@/actions/bots";

interface AgentProfileDialogProps {
  botId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getActivityIcon(action: string) {
  if (action === "moved") return { icon: ArrowRight, className: "bg-blue-500/15 text-blue-500" };
  if (action === "comment_added") return { icon: MessageSquare, className: "bg-emerald-500/15 text-emerald-500" };
  return { icon: CheckCircle2, className: "bg-violet-500/15 text-violet-400" };
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5 p-6">
      {/* Hero skeleton */}
      <div className="flex gap-4">
        <Skeleton className="h-16 w-16 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      {/* Content skeleton */}
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
    </div>
  );
}

export function AgentProfileDialog({ botId, open, onOpenChange }: AgentProfileDialogProps) {
  const [data, setData] = useState<AgentProfileData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchProfile = useCallback(async (id: string) => {
    setLoading(true);
    setData(null);
    try {
      const result = await getAgentProfile(id);
      setData(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && botId) {
      fetchProfile(botId);
    } else if (!open) {
      setData(null);
    }
  }, [open, botId, fetchProfile]);

  const bot = data?.bot;
  const colors = bot ? getRoleColor(bot.role) : null;
  const initials = bot ? getInitials(bot.name) : "";

  const promptFields =
    bot && (bot.is_published || data?.isOwner)
      ? parsePromptToFields(bot.system_prompt ?? "")
      : null;

  const createdDate = bot
    ? new Date(bot.created_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">
          {bot ? `${bot.name} Profile` : "Agent Profile"}
        </DialogTitle>

        {loading || !data || !bot || !colors ? (
          <ProfileSkeleton />
        ) : (
          <div className="space-y-5 p-6">
            {/* Hero */}
            <div className="flex gap-4">
              {/* Avatar + status */}
              <div className="shrink-0 text-center">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={bot.avatar_url ?? undefined} />
                  <AvatarFallback className={cn("text-xl", colors.avatarBg, colors.avatarText)}>
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-bold truncate">{bot.name}</h2>
                  {bot.role && (
                    <Badge className={cn("text-xs shrink-0 border-0", colors.badge)}>
                      {bot.role}
                    </Badge>
                  )}
                </div>

                {bot.bio && (
                  <p className="text-sm text-muted-foreground italic mb-1.5">
                    &ldquo;{bot.bio}&rdquo;
                  </p>
                )}

                <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                  <span>
                    Owned by{" "}
                    <span className="font-medium text-muted-foreground/80">
                      {bot.owner.full_name ?? "Unknown"}
                    </span>
                  </span>
                  <span className="text-[8px]">&#x2022;</span>
                  <span>Created {createdDate}</span>
                </div>

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
              {!data.isOwner && (
                <div className="shrink-0 flex gap-2 self-start">
                  <AgentVoteButton
                    botId={bot.id}
                    upvotes={bot.community_upvotes}
                    hasVoted={data.hasVoted}
                  />
                  <CloneAgentButton botId={bot.id} botName={bot.name} />
                </div>
              )}
            </div>

            {/* Personality & Instructions */}
            {promptFields && (promptFields.goal || promptFields.constraints || promptFields.approach) && (
              <>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  &#x1F9E0; Personality & Instructions
                </h3>
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
            {(bot.is_published || data.isOwner) &&
              bot.system_prompt &&
              !promptFields && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    &#x1F9E0; Personality & Instructions
                  </h3>
                  <div className="rounded-lg border border-border bg-muted/30 p-4">
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {bot.system_prompt}
                    </p>
                  </div>
                </div>
              )}

            {/* Two-column: Active Tasks + Contributing Ideas */}
            {(data.tasks.length > 0 || data.contributingIdeas.length > 0) && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Active Tasks */}
                {data.tasks.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Active Tasks</h3>
                    <div className="flex flex-col gap-1.5">
                      {data.tasks.map((task) => (
                        <Link
                          key={task.id}
                          href={`/ideas/${task.board_columns.idea_id}/board?taskId=${task.id}`}
                          onClick={() => onOpenChange(false)}
                          className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 p-2 transition-colors hover:bg-muted/50"
                        >
                          <span className="text-xs truncate">{task.title}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0 ml-2">
                            {task.board_columns.title}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Contributing To */}
                {data.contributingIdeas.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Lightbulb className="h-3.5 w-3.5" />
                      Contributing To
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      {data.contributingIdeas.map((idea) => (
                        <Link
                          key={idea.id}
                          href={`/ideas/${idea.id}`}
                          onClick={() => onOpenChange(false)}
                          className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-2 transition-colors hover:bg-muted/50"
                        >
                          <Lightbulb className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="text-xs font-medium flex-1 truncate">{idea.title}</span>
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
            )}

            {/* Recent Activity */}
            {data.recentActivity.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Recent Activity</h3>
                <div className="flex flex-col gap-1.5">
                  {data.recentActivity.map((activity) => {
                    const { icon: Icon, className: iconClass } = getActivityIcon(activity.action);
                    const actionLabel = activity.action === "moved"
                      ? `Moved "${activity.taskTitle}" ${activity.details?.to ? `to ${activity.details.to}` : ""}`
                      : activity.action === "comment_added"
                        ? `Commented on "${activity.taskTitle}"`
                        : `${activity.action.replace(/_/g, " ")} "${activity.taskTitle}"`;

                    return (
                      <div
                        key={activity.id}
                        className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/30 p-2"
                      >
                        <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", iconClass)}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{actionLabel}</p>
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

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
