"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Check,
  ArrowRightLeft,
  ClipboardCheck,
  Pin,
  Search,
  Star,
  Bot,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatRelativeTime, getInitials } from "@/lib/utils";
import type { IdeaDiscussionWithAuthor } from "@/types";

/** Strip markdown syntax to produce a clean plain-text preview */
export function stripMarkdown(md: string): string {
  return md
    // Remove fenced code blocks (``` ... ```)
    .replace(/```[\s\S]*?```/g, "")
    // Remove inline code
    .replace(/`([^`]*)`/g, "$1")
    // Remove images ![alt](url)
    .replace(/!\[.*?\]\(.*?\)/g, "")
    // Convert links [text](url) → text
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
    // Remove headings (# ... )
    .replace(/^#{1,6}\s+/gm, "")
    // Remove bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Remove strikethrough
    .replace(/~~(.*?)~~/g, "$1")
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, "")
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Collapse whitespace
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type FilterStatus = "all" | "open" | "resolved" | "ready_to_convert" | "converted";

const STATUS_CONFIG = {
  open: {
    label: "Open",
    icon: MessageSquare,
    iconClassName: "text-emerald-400",
    badgeClassName: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  resolved: {
    label: "Resolved",
    icon: Check,
    iconClassName: "text-violet-400",
    badgeClassName: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  ready_to_convert: {
    label: "Ready to Convert",
    icon: ClipboardCheck,
    iconClassName: "text-amber-400",
    badgeClassName: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  converted: {
    label: "Converted to task",
    icon: ArrowRightLeft,
    iconClassName: "text-blue-400",
    badgeClassName: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
} as const;

interface DiscussionListProps {
  discussions: IdeaDiscussionWithAuthor[];
  ideaId: string;
}

export function DiscussionList({ discussions, ideaId }: DiscussionListProps) {
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");

  const filtered = discussions.filter((d) => {
    if (filter !== "all" && d.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q);
    }
    return true;
  });

  // Sort: pinned first, then by last_activity_at
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime();
  });

  const filterTabs: { value: FilterStatus; label: string; count: number }[] = [
    { value: "all", label: "All", count: discussions.length },
    { value: "open", label: "Open", count: discussions.filter((d) => d.status === "open").length },
    { value: "resolved", label: "Resolved", count: discussions.filter((d) => d.status === "resolved").length },
    { value: "ready_to_convert", label: "Ready", count: discussions.filter((d) => d.status === "ready_to_convert").length },
  ];

  return (
    <div className="space-y-4">
      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search discussions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 sm:ml-auto">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === tab.value
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Discussion items */}
      {sorted.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {search || filter !== "all"
            ? "No discussions match your filters."
            : null}
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((discussion) => {
            const config = STATUS_CONFIG[discussion.status];
            const StatusIcon = config.icon;

            return (
              <Link
                key={discussion.id}
                href={`/ideas/${ideaId}/discussions/${discussion.id}`}
                className={`group flex gap-4 rounded-lg border p-4 sm:p-5 transition-colors hover:border-foreground/20 hover:bg-accent/30 ${
                  discussion.pinned ? "border-amber-500/30 bg-amber-500/5" : ""
                }`}
              >
                {/* Status icon */}
                <div className="shrink-0 pt-0.5">
                  <StatusIcon className={`h-5 w-5 ${config.iconClassName}`} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold group-hover:text-foreground">
                      {discussion.title}
                    </h3>
                    {discussion.author.is_bot && (
                      <Badge variant="outline" className="shrink-0 text-[10px] gap-0.5">
                        <Bot className="h-2.5 w-2.5" />
                        Bot
                      </Badge>
                    )}
                    {discussion.pinned && (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-400 gap-0.5"
                      >
                        <Star className="h-2.5 w-2.5" />
                        Pinned
                      </Badge>
                    )}
                    <Badge variant="outline" className={`shrink-0 text-[10px] ${config.badgeClassName}`}>
                      {config.label}
                    </Badge>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                    {stripMarkdown(discussion.body)}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={discussion.author.avatar_url ?? undefined} />
                        <AvatarFallback className="text-[8px]">
                          {getInitials(discussion.author.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span>{discussion.author.full_name ?? "Anonymous"}</span>
                    </div>
                    <span className="text-muted-foreground/50">&middot;</span>
                    <span>Updated {formatRelativeTime(discussion.last_activity_at)}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {discussion.reply_count} {discussion.reply_count === 1 ? "reply" : "replies"}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
