"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AgentVoteButton } from "./agent-vote-button";
import { CloneAgentButton } from "./clone-agent-button";
import { cn, getInitials } from "@/lib/utils";
import { getRoleColor } from "@/lib/agent-colors";
import type { BotProfile } from "@/types";

interface AgentCardProps {
  bot: BotProfile;
  variant: "owned" | "community";
  ownerName?: string | null;
  hasVoted?: boolean;
  stats?: { taskCount: number; ideaCount: number; assignedCount: number };
  onEdit?: () => void;
  onClick?: () => void;
}

export function AgentCard({
  bot,
  variant,
  ownerName,
  hasVoted = false,
  stats,
  onEdit,
  onClick,
}: AgentCardProps) {
  const initials = getInitials(bot.name);

  const colors = getRoleColor(bot.role);

  if (variant === "community") {
    return (
      <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-muted/30 transition-colors hover:border-border/80">
        {/* Hero */}
        <div className="flex items-center gap-3 p-4 pb-2">
          {onClick ? (
            <button type="button" onClick={onClick} className="shrink-0">
              <Avatar className="h-12 w-12">
                <AvatarImage src={bot.avatar_url ?? undefined} />
                <AvatarFallback className={cn("text-sm", colors.avatarBg, colors.avatarText)}>
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          ) : (
            <Link href={`/agents/${bot.id}`}>
              <Avatar className="h-12 w-12 shrink-0">
                <AvatarImage src={bot.avatar_url ?? undefined} />
                <AvatarFallback className={cn("text-sm", colors.avatarBg, colors.avatarText)}>
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Link>
          )}
          <div className="min-w-0 flex-1">
            {onClick ? (
              <button
                type="button"
                onClick={onClick}
                className="font-semibold text-sm hover:underline truncate block text-left"
              >
                {bot.name}
              </button>
            ) : (
              <Link
                href={`/agents/${bot.id}`}
                className="font-semibold text-sm hover:underline truncate block"
              >
                {bot.name}
              </Link>
            )}
            <p className="text-[11px] text-muted-foreground">
              by <span className="font-medium text-muted-foreground/80">{ownerName ?? "Unknown"}</span>
            </p>
          </div>
        </div>

        {/* Tagline */}
        {bot.bio && (
          <p className="px-4 text-xs text-muted-foreground italic line-clamp-2 leading-snug">
            &ldquo;{bot.bio}&rdquo;
          </p>
        )}

        {/* Skills */}
        {bot.skills && bot.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 px-4 mt-2">
            {bot.skills.slice(0, 4).map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-border/50 bg-background/50 px-2 py-px text-[10px] font-medium text-muted-foreground"
              >
                {skill}
              </span>
            ))}
            {bot.skills.length > 4 && (
              <span className="text-[10px] text-muted-foreground self-center">
                +{bot.skills.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto border-t border-border/50 bg-black/5 px-4 py-2.5 mt-3">
          <div className="flex items-center gap-3">
            <AgentVoteButton
              botId={bot.id}
              upvotes={bot.community_upvotes}
              hasVoted={hasVoted}
            />
            <span className="text-[11px] text-muted-foreground">
              <span className="font-semibold">{bot.times_cloned}</span> added
            </span>
          </div>
          <CloneAgentButton botId={bot.id} botName={bot.name} />
        </div>
      </div>
    );
  }

  // Owned variant
  const ownedClassName = cn(
    "group relative flex flex-col gap-2.5 rounded-lg border p-4 transition-all cursor-pointer bg-muted/30 text-left w-full",
    bot.is_active
      ? "border-border hover:border-border/80 hover:bg-muted/50"
      : "border-border/50 opacity-45 hover:opacity-65"
  );

  const Wrapper = onClick
    ? ({ children }: { children: React.ReactNode }) => (
        <button type="button" onClick={onClick} className={ownedClassName}>
          {children}
        </button>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <Link href={`/agents/${bot.id}`} className={ownedClassName}>
          {children}
        </Link>
      );

  return (
    <Wrapper>
      {/* Hover edit button */}
      {onEdit && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit();
          }}
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground opacity-0 transition-all hover:text-foreground hover:bg-muted group-hover:opacity-100 z-10"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Header: Avatar with status dot + Name + Role */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className="h-12 w-12">
            <AvatarImage src={bot.avatar_url ?? undefined} />
            <AvatarFallback className={cn("text-sm", colors.avatarBg, colors.avatarText)}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-muted/30",
              bot.is_active ? "bg-emerald-500" : "bg-muted-foreground"
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{bot.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {bot.role && (
              <Badge className={cn("text-[10px] shrink-0 max-w-[120px] truncate border-0", colors.badge)}>
                {bot.role}
              </Badge>
            )}
            {!bot.is_active && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Inactive
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Tagline */}
      {bot.bio && (
        <p className="text-xs text-muted-foreground italic line-clamp-2 leading-snug">
          &ldquo;{bot.bio}&rdquo;
        </p>
      )}

      {/* Skills */}
      {bot.skills && bot.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {bot.skills.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="rounded-full border border-border/50 bg-background/50 px-2 py-px text-[10px] font-medium text-muted-foreground"
            >
              {skill}
            </span>
          ))}
          {bot.skills.length > 4 && (
            <span className="text-[10px] text-muted-foreground self-center">
              +{bot.skills.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="flex items-center gap-3 pt-2.5 border-t border-border/30 text-[11px] text-muted-foreground">
          <span><span className="font-semibold text-muted-foreground/80">{stats.taskCount}</span> tasks done</span>
          <span><span className="font-semibold text-muted-foreground/80">{stats.ideaCount}</span> ideas</span>
          <span><span className="font-semibold text-muted-foreground/80">{stats.assignedCount}</span> assigned</span>
        </div>
      )}
    </Wrapper>
  );
}
